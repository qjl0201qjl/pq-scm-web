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
  promptVersion: 'nev-absa-v2',
};

const aspectList = ['外观造型', '内饰质感', '空间表现', '动力性能', '续航与能耗', '充电体验', '智能座舱', '智能驾驶', '操控与底盘', '舒适性与NVH', '安全配置', '售后服务与交付', '其他'];
const emotionalWords = /满意|喜欢|舒服|好看|省油|性价比高|差|不好|不满|卡顿|异响|掉电|缩水|太硬|费油|投诉|可恨|反感/;
const cachePrefix = 'pq_scm_llm_absa_cache_v2:';

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

function isMojibake(text: string) {
  return /�|锟|Ã|Â|å|æ|ç/.test(text);
}

function isTooShortComment(text: string) {
  const chineseLength = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  return chineseLength > 0 && chineseLength < 5;
}

function getNeedReviewReason(commentText: string, result: Pick<LlmAbsaResult, 'aspect' | 'confidence' | 'needReview'>, conflicts: string[] = []) {
  if (result.confidence < 0.65) return '置信度低于0.65';
  if (result.aspect === '其他') return '方面被判定为其他';
  if (isMojibake(commentText)) return '评论文本疑似乱码';
  if (isTooShortComment(commentText)) return '评论少于5个中文字符';
  if (conflicts.length) return `规则与LLM存在严重冲突：${conflicts.join('、')}`;
  if (result.needReview) return 'LLM标记需要复核';
  return '';
}

function toLlmResult(payload: Record<string, unknown>, config: LlmAbsaConfig, commentText: string, rawContent: unknown): LlmAbsaResult {
  const rawAspect = String(payload.aspect || '其他').trim();
  const aspect = aspectList.includes(rawAspect) ? rawAspect : '其他';
  const sentiment = normalizeSentiment(String(payload.sentiment || '中性'));
  const confidence = Math.max(0, Math.min(1, Number(payload.confidence ?? 0.5)));
  const opinion = String(payload.opinion || '未提取观点');
  const reason = String(payload.reason || 'LLM未返回明确归因，建议人工复核。');
  const modelNeedReview = Boolean(payload.need_review ?? payload.needReview);
  const needReview = modelNeedReview || confidence < 0.65 || aspect === '其他' || isMojibake(commentText) || isTooShortComment(commentText);
  return {
    aspect,
    opinion,
    sentiment,
    reason,
    confidence,
    needReview,
    needReviewReason: getNeedReviewReason(commentText, { aspect, confidence, needReview }),
    modelName: config.modelName,
    promptVersion: config.promptVersion,
    createdAt: new Date().toISOString(),
    rawContent,
  };
}

function makePrompt(commentText: string, candidateAspect?: string) {
  const candidateLine = candidateAspect && candidateAspect !== '综合体验' ? `\n规则ABSA候选方面：${candidateAspect}\n请结合候选方面和评论原文判断最终结果；如果候选方面与原文不符，以原文为准。\n` : '';
  return {
    system: '你是新能源汽车感知质量方面级情感分析专家。你的任务是根据用户评论识别其涉及的质量方面、观点词、情感方向和归因原因。请严格依据评论内容分析，不要使用模板化解释，不要编造评论中不存在的信息。只输出合法 JSON。',
    user: `请对以下新能源汽车用户评论进行方面级情感分析。

评论文本：
${commentText}
${candidateLine}
请完成以下任务：
1. 判断评论主要涉及哪个感知质量方面。
2. 提取最核心的观点词或观点短语。
3. 判断情感方向：正面、中性、负面。
4. 用一句话说明原因，原因必须来自评论文本。
5. 给出置信度，范围0到1。
6. 判断是否需要人工复核。

方面类别必须从以下列表选择：
${aspectList.join('\n')}

输出 JSON：
{
  "aspect": "",
  "opinion": "",
  "sentiment": "",
  "reason": "",
  "confidence": 0.0,
  "need_review": false
}

判定规则：
- 出现“续航、掉电、电耗、里程、BMS、热泵、低温、冬天”等，优先考虑“续航与能耗”。
- 出现“车机、中控屏、语音、系统、OTA、卡顿、黑屏、死机”等，优先考虑“智能座舱”。
- 出现“智驾、辅助驾驶、自动泊车、AEB、雷达、误报”等，优先考虑“智能驾驶”。
- 出现“座椅、腰疼、悬架、风噪、胎噪、异响、NVH”等，优先考虑“舒适性与NVH”。
- 出现“充电、快充、慢充、充电桩、兼容、中断”等，优先考虑“充电体验”。
- 如果评论非常短但有明确情感，也必须尽量判断，不要直接归为“其他”。
- 只有在文本乱码、无意义、完全无法判断时，才输出 aspect="其他"。
- need_review 只有在 confidence < 0.65 或文本乱码时才为 true。
- 不允许统一输出“缺少明确质量关键词”。
- 不允许统一输出“该评论反映了用户体验与工程质量特征之间的潜在对应关系”。
- 不要输出解释文字，只输出JSON。`,
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function isDevRuntime() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

async function callOpenAiCompatible(commentText: string, config: LlmAbsaConfig, signal?: AbortSignal, candidateAspect?: string) {
  if (!config.apiKey?.trim()) throw new Error('浏览器直连模式需要填写 API Key。');
  const prompt = makePrompt(commentText, candidateAspect);
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

async function callOllama(commentText: string, config: LlmAbsaConfig, signal?: AbortSignal, candidateAspect?: string) {
  const prompt = makePrompt(commentText, candidateAspect);
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

async function callLlm(commentText: string, config: LlmAbsaConfig, signal?: AbortSignal, candidateAspect?: string) {
  if (config.callMode === 'browser') return callOpenAiCompatible(commentText, config, signal, candidateAspect);
  if (config.callMode === 'ollama') return callOllama(commentText, config, signal, candidateAspect);
  const response = await fetch('/api/llm-absa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commentText, candidateAspect, config }),
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
  const severeConflict = conflict.length > 0 && result.confidence < 0.75;
  const adjustedConfidence = source === 'hybrid' && !conflict.length && ruleInsight.aspect !== '综合体验'
    ? Math.min(1, result.confidence + 0.08)
    : result.confidence;
  const needReview = Boolean(result.error) || result.needReview || result.aspect === '其他' || severeConflict || (result.sentiment === 'neutral' && emotionalWords.test(review.text));
  const needReviewReason = getNeedReviewReason(review.text, { ...result, confidence: adjustedConfidence, needReview }, severeConflict ? conflict : []);
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
    confidence: adjustedConfidence,
    needReview,
    source,
    conflict: severeConflict ? conflict : [],
    needReviewReason,
  };
}

export async function analyzeWithLlm(review: ReviewRecord, config: LlmAbsaConfig, signal?: AbortSignal, candidateAspect?: string): Promise<LlmAbsaResult> {
  const cached = await getCached(review.text, config);
  if (cached) return cached;

  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (isDevRuntime()) console.debug('[PQ-SCM LLM-ABSA] comment_text:', review.text.slice(0, 100));
      const content = await callLlm(review.text, config, signal, candidateAspect);
      if (isDevRuntime()) console.debug('[PQ-SCM LLM-ABSA] raw:', content);
      const parsed = typeof content === 'string' ? extractJson(content) : content;
      const result = toLlmResult(parsed, config, review.text, content);
      if (isDevRuntime()) {
        console.debug('[PQ-SCM LLM-ABSA] parsed:', parsed);
        console.debug('[PQ-SCM LLM-ABSA] need_review:', result.needReview, result.needReviewReason);
      }
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
    needReviewReason: 'API失败或JSON解析失败',
    modelName: config.modelName,
    promptVersion: config.promptVersion,
    createdAt: new Date().toISOString(),
    error: lastError,
  };
}

export function shouldUseRuleOnly(ruleInsight: ReviewInsight, mode: AbsaMode) {
  if (mode === 'rule') return true;
  if (mode === 'llm') return false;
  return false;
}

export function ruleInsightFor(review: ReviewRecord) {
  return extractReviewInsight(review);
}
