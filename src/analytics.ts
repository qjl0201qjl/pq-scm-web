import { EngineeringFeature, QfdRelation, QualityProblem, ReviewRecord, Sentiment } from './types';

export function sentimentLabel(sentiment: Sentiment) {
  return sentiment === 'positive' ? '正面积极' : sentiment === 'neutral' ? '中性客观' : '负面问题';
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
