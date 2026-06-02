import { extractReviewInsight } from './absa';
import { AbsaMode, LlmAbsaConfig, LlmAbsaResult, ReviewInsight, ReviewRecord, Sentiment } from './types';

export const defaultLlmConfig: LlmAbsaConfig = {
  provider: 'DeepSeek',
  callMode: 'server',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  ollamaEndpoint: 'http://127.0.0.1:11434',
  modelName: 'deepseek-chat',
  temperature: 0.2,
  maxTokens: 500,
  batchSize: 20,
  promptVersion: 'nev-absa-v1',
};

const aspectList = ['外观造型', '内饰质感', '空间表现', '动力性能', '续航与能耗', '充电体验', '智能座舱', '智能驾驶', '操控与底盘', '舒适性与NVH', '安全配置', '售后服务与交付', '其他'];
const emotionalWords = /满意|喜欢|舒服|好看|省油|性价比高|差|不好|不满|卡顿|异响|掉电|缩水|太硬|费油|投诉|可恨|反感/;
const cachePrefix = 'pq_scm_llm_absa_cache_v1:';

export interface LlmProgress {
  total: number;
  analyzed: number;
  success: number;
  failed: number;
  needReview: number;
  etaSeconds: number;
  running: boolean;
  paused: boolean;
  stopped: boolean;
}

export function makeInitialProgress(total: number): LlmProgress {
  return { total, analyzed: 0, success: 0, failed: 0, needReview: 0, etaSeconds: 0, running: false, paused: false, stopped: false };
}

export async function hashComment(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSentiment(input: string): Sentiment {
  if (/正|positive/i.test(input)) return 'positive';
  if (/负|negative/i.test(input)) return 'negative';
  return 'neutral';
}

function cacheKey(hash: string, config: LlmAbsaConfig) {
  return `${cachePrefix}${config.promptVersion}:${config.callMode}:${config.modelName}:${hash}`;
}

async function getCached(text: string, config: LlmAbsaConfig) {
  const hash = await hashComment(text);
  const raw = localStorage.getItem(cacheKey(hash, config));
  return raw ? JSON.parse(raw) as LlmAbsaResult : null;
}

async function setCached(text: string, config: LlmAbsaConfig, result: LlmAbsaResult) {
  const hash = await hashComment(text);
  localStorage.setItem(cacheKey(hash, config), JSON.stringify(result));
}

function extractJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('LLM输出不是合法JSON');
  }
}

function toLlmResult(payload: Record<string, unknown>, config: LlmAbsaConfig): LlmAbsaResult {
  const aspect = String(payload.aspect || '其他');
  const sentiment = normalizeSentiment(String(payload.sentiment || '中性'));
  const confidence = Math.max(0, Math.min(1, Number(payload.confidence ?? 0.5)));
  const opinion = String(payload.opinion || '未提取观点');
  const reason = String(payload.reason || 'LLM未返回明确归因，建议人工复核。');
  const baseNeedReview = Boolean(payload.need_review ?? payload.needReview);
  return {
    aspect: aspectList.includes(aspect) ? aspect : '其他',
    opinion,
    sentiment,
    reason,
    confidence,
    needReview: baseNeedReview || confidence < 0.7 || aspect === '其他',
    modelName: config.modelName,
    promptVersion: config.promptVersion,
    createdAt: new Date().toISOString(),
  };
}

function makePrompt(commentText: string) {
  return {
    system: '你是新能源汽车感知质量分析助手。你的任务是对用户评论进行方面级情感分析。请严格根据评论文本判断，不要编造不存在的信息。输出必须是合法JSON。',
    user: `请分析以下新能源汽车用户评论，并输出方面级情感分析结果。

评论文本：
${commentText}

分析要求：
1. 识别评论涉及的主要方面类别。
2. 提取对应观点词或观点短语。
3. 判断情感方向：正面、中性、负面。
4. 用一句话说明情感归因。
5. 给出置信度，范围0到1。
6. 判断是否需要人工复核。

方面类别只能从以下列表中选择：
${aspectList.join('、')}。

输出JSON格式如下：
{
  "aspect": "",
  "opinion": "",
  "sentiment": "",
  "reason": "",
  "confidence": 0.0,
  "need_review": false
}

判定规则：
- 如果评论涉及多个方面，选择最主要的方面。
- 如果情感不明确，sentiment填“中性”，confidence低于0.6，need_review为true。
- 如果评论过短、乱码、无意义，aspect填“其他”，sentiment填“中性”，need_review为true。
- 不要输出解释文字，只输出JSON。`,
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function callOpenAiCompatible(commentText: string, config: LlmAbsaConfig, signal?: AbortSignal) {
  if (!config.apiKey?.trim()) throw new Error('浏览器直连模式需要填写 API Key。');
  const prompt = makePrompt(commentText);
  const response = await fetch(joinUrl(config.baseUrl, '/v1/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.modelName,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
    signal,
  });
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || payload.content || payload.result || payload;
}

async function callOllama(commentText: string, config: LlmAbsaConfig, signal?: AbortSignal) {
  const prompt = makePrompt(commentText);
  const response = await fetch(joinUrl(config.ollamaEndpoint || config.baseUrl || 'http://127.0.0.1:11434', '/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.modelName,
      stream: false,
      format: 'json',
      options: {
        temperature: config.temperature,
        num_predict: config.maxTokens,
      },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
    signal,
  });
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  return payload.message?.content || payload.response || payload;
}

async function callLlm(commentText: string, config: LlmAbsaConfig, signal?: AbortSignal) {
  if (config.callMode === 'browser') return callOpenAiCompatible(commentText, config, signal);
  if (config.callMode === 'ollama') return callOllama(commentText, config, signal);
  const response = await fetch('/api/llm-absa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commentText, config }),
    signal,
  });
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  return payload.content || payload.result || payload;
}

export function conflictsBetween(rule: ReviewInsight, llm: LlmAbsaResult) {
  const conflicts: string[] = [];
  if (rule.aspect !== '综合体验' && rule.aspect !== llm.aspect) conflicts.push('方面冲突');
  if (rule.sentiment !== 'neutral' && llm.sentiment !== 'neutral' && rule.sentiment !== llm.sentiment) conflicts.push('情感冲突');
  return conflicts;
}

export function resultToInsight(review: ReviewRecord, result: LlmAbsaResult, ruleInsight: ReviewInsight, source: 'llm' | 'hybrid'): ReviewInsight {
  const conflict = source === 'hybrid' ? conflictsBetween(ruleInsight, result) : [];
  const needReview = result.needReview || result.confidence < 0.7 || result.aspect === '其他' || conflict.length > 0 || (result.sentiment === 'neutral' && emotionalWords.test(review.text));
  return {
    id: review.id,
    rawText: review.text,
    aspect: result.aspect,
    opinion: result.opinion,
    sentiment: result.sentiment,
    keywords: result.opinion ? [result.opinion] : ['需人工复核'],
    reason: result.reason,
    model: review.model,
    platform: review.platform,
    date: review.date,
    confidence: result.confidence,
    needReview,
    source,
    conflict,
  };
}

export async function analyzeWithLlm(review: ReviewRecord, config: LlmAbsaConfig, signal?: AbortSignal): Promise<LlmAbsaResult> {
  const cached = await getCached(review.text, config);
  if (cached) return cached;

  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const content = await callLlm(review.text, config, signal);
      const parsed = typeof content === 'string' ? extractJson(content) : content;
      const result = toLlmResult(parsed, config);
      await setCached(review.text, config, result);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
  }

  return {
    aspect: '其他',
    opinion: '解析失败',
    sentiment: 'neutral',
    reason: `API调用或JSON解析失败：${lastError}`,
    confidence: 0,
    needReview: true,
    modelName: config.modelName,
    promptVersion: config.promptVersion,
    createdAt: new Date().toISOString(),
    error: lastError,
  };
}

export function shouldUseRuleOnly(ruleInsight: ReviewInsight, mode: AbsaMode) {
  if (mode === 'rule') return true;
  if (mode === 'llm') return false;
  return !ruleInsight.needReview && (ruleInsight.confidence || 0) >= 0.82 && ruleInsight.aspect !== '综合体验';
}

export function ruleInsightFor(review: ReviewRecord) {
  return extractReviewInsight(review);
}
