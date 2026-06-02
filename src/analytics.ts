import { EngineeringFeature, KanoCategory, QfdRelation, QualityProblem, ReviewRecord, Sentiment } from './types';

export function sentimentLabel(sentiment: Sentiment) {
  return sentiment === 'positive' ? '正面积极' : sentiment === 'neutral' ? '中性客观' : '负面问题';
}

export function getKanoCoefficient(kano: KanoCategory) {
  if (kano === 'Must-be') return 1.2;
  if (kano === 'One-dimensional') return 1.0;
  if (kano === 'Attractive') return 0.8;
  return 0.7;
}

export function getFdaScore(problem: QualityProblem) {
  return Number((problem.pi / getKanoCoefficient(problem.kano)).toFixed(1));
}

export function getKanoLabel(kano: KanoCategory) {
  if (kano === 'Must-be') return 'Must-be 基本型需求';
  if (kano === 'One-dimensional') return 'One-dimensional 期望型需求';
  if (kano === 'Attractive') return 'Attractive 魅力型需求';
  return 'Indifferent 无差异需求';
}

export function getKanoColor(kano: KanoCategory) {
  if (kano === 'Must-be') return '#fb7185';
  if (kano === 'One-dimensional') return '#38bdf8';
  if (kano === 'Attractive') return '#34d399';
  return '#94a3b8';
}

export function getPriorityExplanation(kano: KanoCategory) {
  if (kano === 'Must-be') return '基本型需求，经Kano修正后优先级上调。';
  if (kano === 'One-dimensional') return '期望型需求，按FDA严重程度确定改进顺序。';
  if (kano === 'Attractive') return '魅力型需求，可作为体验增益项但修正系数较低。';
  return '无差异需求，建议保持监测并结合样本规模复核。';
}

export function getKpis(reviews: ReviewRecord[], problems: QualityProblem[], collaboratorCount: number) {
  const negative = reviews.filter((item) => item.sentiment === 'negative').length;
  return {
    totalComments: reviews.length,
    negativeRatio: reviews.length ? Number(((negative / reviews.length) * 100).toFixed(1)) : 0,
    highPriorityIssues: problems.filter((item) => item.pi >= 40).length,
    collaborators: collaboratorCount,
    recommendations: 34,
    pqIndex: 78.4,
  };
}

export function countBy<T extends string>(items: T[]) {
  return items.reduce<Record<string, number>>((acc, key) => {
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function toPieData(reviews: ReviewRecord[]) {
  const counts = countBy(reviews.map((item) => sentimentLabel(item.sentiment)));
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}

export function toAspectBars(reviews: ReviewRecord[]) {
  const aspects = Array.from(new Set(reviews.map((item) => item.aspect)));
  return aspects.map((aspect) => ({
    aspect,
    total: reviews.filter((item) => item.aspect === aspect).length,
    negative: reviews.filter((item) => item.aspect === aspect && item.sentiment === 'negative').length,
  }));
}

export function toTimeline(reviews: ReviewRecord[]) {
  const months = countBy(reviews.map((item) => item.date.slice(0, 7)));
  return Object.entries(months)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));
}

export function featurePriority(features: EngineeringFeature[], relations: QfdRelation[], problems: QualityProblem[]) {
  return features
    .map((feature) => {
      const score = relations
        .filter((relation) => relation.featureId === feature.id)
        .reduce((sum, relation) => {
          const problem = problems.find((item) => item.id === relation.problemId);
          return sum + (problem?.pi || 0) * relation.weight;
        }, 0);
      return { ...feature, score: Number(score.toFixed(1)) };
    })
    .sort((a, b) => b.score - a.score);
}

export function makeDownload(content: string, filename: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
