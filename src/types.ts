export type Sentiment = 'positive' | 'neutral' | 'negative';
export type KanoCategory = 'Must-be' | 'One-dimensional' | 'Attractive' | 'Indifferent';

export interface ReviewRecord {
  id: string;
  model: string;
  platform: string;
  date: string;
  aspect: string;
  subAspect: string;
  text: string;
  sentiment: Sentiment;
  score: number;
}

export interface ReviewInsight {
  id: string;
  rawText: string;
  aspect: string;
  opinion?: string;
  sentiment: Sentiment;
  keywords: string[];
  reason: string;
  model: string;
  platform: string;
  date: string;
  confidence?: number;
  needReview?: boolean;
  needReviewReason?: string;
  source?: 'rule' | 'llm' | 'hybrid';
  conflict?: string[];
}

export interface ReviewImportResult {
  fileName: string;
  rows: Record<string, unknown>[];
  columns: string[];
  reviews: ReviewRecord[];
  detectedTextColumn?: string;
  needsColumnSelection: boolean;
}

export type AbsaMode = 'rule' | 'llm' | 'hybrid';

export type LlmCallMode = 'server' | 'browser' | 'ollama';

export interface LlmAbsaConfig {
  provider: 'DeepSeek' | 'OpenAI compatible' | 'Qwen' | 'Custom' | 'Ollama';
  callMode: LlmCallMode;
  apiKey?: string;
  baseUrl: string;
  ollamaEndpoint?: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  batchSize: number;
  promptVersion: string;
}

export interface LlmAbsaResult {
  aspect: string;
  opinion: string;
  sentiment: Sentiment;
  reason: string;
  confidence: number;
  needReview: boolean;
  needReviewReason?: string;
  modelName: string;
  promptVersion: string;
  createdAt: string;
  error?: string;
  rawContent?: unknown;
}

export interface QualityProblem {
  id: string;
  name: string;
  aspect: string;
  attention: number;
  dissatisfaction: number;
  intensity: number;
  pi: number;
  kano: KanoCategory;
  typicalComments: string[];
  attribution: string;
}

export interface EngineeringFeature {
  id: string;
  name: string;
  unit: string;
  current: string;
  target: string;
}

export interface QfdRelation {
  problemId: string;
  featureId: string;
  weight: 0 | 1 | 3 | 9;
}

export interface ScmRecommendation {
  featureId: string;
  module: string;
  collaborators: string[];
  internalTeams: string[];
  method: string;
  suggestion: string;
  urgency: '高' | '中' | '低';
  cost: '高' | '中' | '低';
}

export interface AnalysisResult {
  comment_id: string;
  raw_text: string;
  source: string;
  vehicle_model: string;
  time: string;
  aspect: string;
  opinion: string;
  sentiment: Sentiment;
  reason: string;
  confidence: number;
  need_review: boolean;
  analysis_source: 'rule' | 'llm' | 'hybrid';
}

export interface IssueSummary extends QualityProblem {
  issueType: string;
  count: number;
  positiveRatio: number;
  negativeRatio: number;
  avgConfidence: number;
  fda: number;
  normalizedAttention: number;
  normalizedDissatisfaction: number;
  normalizedIntensity: number;
  evidenceResults: AnalysisResult[];
}

export interface EngineeringFeatureScore extends EngineeringFeature {
  score: number;
  relatedIssues: string[];
}

export interface QfdResult {
  issueId: string;
  issueName: string;
  aspect: string;
  featureId: string;
  featureName: string;
  baseRelation: 0 | 1 | 3 | 9;
  keywordMatch: number;
  confidence: number;
  piFactor: number;
  relationScore: number;
  evidenceKeywords: string[];
  module: string;
  description: string;
}

export interface EnterpriseProfile {
  enterprise_name: string;
  module: string;
  role_type: string;
  main_products: string;
  typical_customers: string;
  collaboration_capability: string;
  notes: string;
}

export interface SupplyChainResult {
  enterpriseName: string;
  module: string;
  roleType: string;
  score: number;
  roleWeight: number;
  matchScore: number;
  relatedFeatures: string[];
  collaborationMethod: string;
  reason: string;
  profile: EnterpriseProfile;
}
