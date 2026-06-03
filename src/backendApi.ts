import { AnalysisResult, EngineeringFeatureScore, IssueSummary, QfdResult, Sentiment, SupplyChainResult } from './types';

const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: options?.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export const backendApi = {
  getState() {
    return request<BackendState>('/api/state');
  },
  runPipeline(payload: { mode: string; provider: string; batch_size: number; top_n: number; generate_report?: boolean }) {
    return request<BackendState>('/api/pipeline/run', { method: 'POST', body: JSON.stringify(payload) });
  },
  uploadComments(file: File, textColumn?: string) {
    const form = new FormData();
    form.append('file', file);
    if (textColumn) form.append('text_column', textColumn);
    return request<{ needs_column_selection: boolean; columns?: string[]; detected_text_column?: string; count?: number; preview?: unknown[] }>('/api/comments/upload', { method: 'POST', body: form });
  },
  runAbsa(payload: { mode: string; provider: string; batch_size: number; text_column?: string }) {
    return request<{ total: number; success: number; need_review: number }>('/api/absa/run', { method: 'POST', body: JSON.stringify(payload) });
  },
  getAbsaResults() {
    return request<{ items: Array<Record<string, unknown>> }>('/api/absa/results?limit=5000');
  },
  generateDiagnosis(topN = 10) {
    return request<{ items: Array<Record<string, unknown>> }>('/api/diagnosis/generate', { method: 'POST', body: JSON.stringify({ top_n: topN }) });
  },
  getDiagnosis() {
    return request<{ items: Array<Record<string, unknown>> }>('/api/diagnosis/results');
  },
  generateQfd(topN = 10) {
    return request<{ items: Array<Record<string, unknown>>; feature_importance: Array<Record<string, unknown>> }>('/api/qfd/generate', { method: 'POST', body: JSON.stringify({ top_n: topN, allow_llm_enhance: false }) });
  },
  getQfd() {
    return request<{ items: Array<Record<string, unknown>>; feature_importance: Array<Record<string, unknown>> }>('/api/qfd/results');
  },
  generateSupplyChain() {
    return request<{ items: Array<Record<string, unknown>> }>('/api/supply-chain/generate', { method: 'POST', body: JSON.stringify({ allow_llm_enhance: false }) });
  },
  getSupplyChain() {
    return request<{ items: Array<Record<string, unknown>> }>('/api/supply-chain/results');
  },
  getCaseFullChain() {
    return request<Record<string, unknown>>('/api/case/full-chain');
  },
  generateReport(payload: { report_type: string; top_n: number; output_format: 'excel' | 'word' | 'pdf' }) {
    return request<{ report_id: string; download_url: string }>('/api/reports/generate', { method: 'POST', body: JSON.stringify(payload) });
  },
  downloadUrl(path: string) {
    return `${API_BASE}${path}`;
  },
};

export interface BackendState {
  stage: string;
  counts: Record<string, number>;
  data_source: Record<string, unknown>;
  meta: Record<string, unknown>;
  comments: Array<Record<string, unknown>>;
  analysis_results: Array<Record<string, unknown>>;
  issue_summary: Array<Record<string, unknown>>;
  qfd_results: Array<Record<string, unknown>>;
  engineering_feature_importance: Array<Record<string, unknown>>;
  supply_chain_results: Array<Record<string, unknown>>;
  report_records: Array<Record<string, unknown>>;
}

function toSentiment(value: unknown): Sentiment {
  const raw = String(value || '');
  if (raw === 'positive' || raw.includes('正')) return 'positive';
  if (raw === 'negative' || raw.includes('负')) return 'negative';
  return 'neutral';
}

export function mapAbsaRows(rows: Array<Record<string, unknown>>): AnalysisResult[] {
  return rows.map((item) => ({
    comment_id: String(item.comment_id || ''),
    raw_text: String(item.raw_text || ''),
    source: String(item.source || ''),
    vehicle_model: String(item.vehicle_model || ''),
    time: String(item.time || ''),
    aspect: String(item.aspect || '其他'),
    opinion: String(item.opinion || ''),
    sentiment: toSentiment(item.sentiment),
    reason: String(item.reason || ''),
    confidence: Number(item.confidence ?? 0.8),
    need_review: Boolean(Number(item.need_review || 0)),
    analysis_source: String(item.analysis_source || 'rule') as AnalysisResult['analysis_source'],
  }));
}

export function mapIssueRows(rows: Array<Record<string, unknown>>): IssueSummary[] {
  return rows.map((item) => ({
    id: String(item.issue_id),
    name: String(item.issue_name),
    issueType: String(item.issue_name),
    aspect: String(item.aspect),
    attention: Number(item.attention_A || 0),
    dissatisfaction: Number(item.dissatisfaction_D || 0),
    intensity: Number(item.intensity_I || 0),
    pi: Number(item.final_PI || 0),
    kano: String(item.kano_type || 'One-dimensional') as IssueSummary['kano'],
    typicalComments: JSON.parse(String(item.evidence_json || '[]')),
    attribution: `由后端 issue_summary 聚合得到，Final PI=${item.final_PI}，用于辅助决策。`,
    count: Number(item.total_count || 0),
    positiveRatio: Number(item.total_count) ? Number(item.positive_count || 0) / Number(item.total_count) * 100 : 0,
    negativeRatio: Number(item.total_count) ? Number(item.negative_count || 0) / Number(item.total_count) * 100 : 0,
    avgConfidence: 0.8,
    fda: Number(item.fda_score || 0),
    normalizedAttention: 0,
    normalizedDissatisfaction: 0,
    normalizedIntensity: 0,
    evidenceResults: [],
  }));
}

export function mapQfdRows(rows: Array<Record<string, unknown>>): QfdResult[] {
  return rows.map((item) => ({
    issueId: String(item.issue_id),
    issueName: String(item.issue_name || item.issue_id),
    aspect: String(item.aspect || ''),
    featureId: `ect-${item.engineering_feature}`,
    featureName: String(item.engineering_feature),
    baseRelation: Number(item.base_relation || 0) as QfdResult['baseRelation'],
    keywordMatch: Number(item.keyword_match || 0),
    confidence: Number(item.confidence_factor || 0.8),
    piFactor: Number(item.pi_factor || 0),
    relationScore: Number(item.relation_score || 0),
    evidenceKeywords: String(item.explanation || '').split(',').slice(0, 3),
    module: String(item.module || ''),
    description: String(item.explanation || ''),
  }));
}

export function mapFeatureRows(rows: Array<Record<string, unknown>>): EngineeringFeatureScore[] {
  return rows.map((item) => ({
    id: `ect-${item.engineering_feature}`,
    name: String(item.engineering_feature),
    unit: '综合分',
    current: '-',
    target: '优先优化',
    score: Number(item.importance || 0),
    relatedIssues: [],
  }));
}

export function mapSupplyRows(rows: Array<Record<string, unknown>>): SupplyChainResult[] {
  return rows.map((item) => ({
    enterpriseName: String(item.enterprise_name),
    module: String(item.module),
    roleType: String(item.role_type),
    score: Number(item.collaboration_score || 0),
    roleWeight: 1,
    matchScore: 1,
    relatedFeatures: [String(item.engineering_feature)],
    collaborationMethod: String(item.collaboration_method),
    reason: String(item.recommendation_reason),
    profile: {
      enterprise_name: String(item.enterprise_name),
      module: String(item.module),
      role_type: String(item.role_type),
      main_products: '',
      typical_customers: '',
      collaboration_capability: String(item.collaboration_method),
      notes: '',
    },
  }));
}
