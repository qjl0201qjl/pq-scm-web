import { extractReviewInsight } from './absa';
import { AbsaMode, LlmAbsaConfig, LlmAbsaResult, ReviewInsight, ReviewRecord, Sentiment } from './types';

export const defaultLlmConfig: LlmAbsaConfig = {
  provider: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
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
  return `${cachePrefix}${config.promptVersion}:${config.modelName}:${hash}`;
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
      const response = await fetch('/api/llm-absa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentText: review.text, config }),
        signal,
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const content = payload.content || payload.result || payload;
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
