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
