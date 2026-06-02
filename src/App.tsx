import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ClipboardCheck, FileSpreadsheet, Gauge, Layers3, MessageSquareText, Radio, Share2 } from 'lucide-react';
import { ConfigProvider, theme } from 'antd';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import ReactFlow, { Background, Controls, Edge, Node, useEdgesState, useNodesState } from 'react-flow-renderer';
import ReactECharts from './ReactECharts';
import { extractReviewInsight } from './absa';
import { engineeringFeatures, problems, qfdRelations, reports, reviews as seedReviews, scmRecommendations, warnings } from './data';
import { featurePriority, getFdaScore, getKanoCoefficient, getKanoColor, getKanoLabel, getKpis, getPriorityExplanation, makeDownload, sentimentLabel, toAspectBars, toPieData } from './analytics';
import { analyzeWithLlm, defaultLlmConfig, LlmProgress, makeInitialProgress, resultToInsight, ruleInsightFor, shouldUseRuleOnly } from './llmAbsa';
import { parseReviewFile, rebuildReviewImportResult } from './upload';
import { AbsaMode, KanoCategory, LlmAbsaConfig, QualityProblem, ReviewImportResult, ReviewInsight, ReviewRecord, Sentiment } from './types';

type PageKey = 'dashboard' | 'reviews' | 'diagnosis' | 'qfd' | 'scm' | 'case' | 'reports';

const pages: Array<{ key: PageKey; name: string; icon: typeof Gauge }> = [
  { key: 'dashboard', name: '首页总览', icon: Gauge },
  { key: 'reviews', name: '评论分析', icon: MessageSquareText },
  { key: 'diagnosis', name: '感知质量诊断', icon: ClipboardCheck },
  { key: 'qfd', name: 'QFD工程转化', icon: Layers3 },
  { key: 'scm', name: '供应链协同', icon: Share2 },
  { key: 'case', name: '案例实证', icon: BookOpen },
  { key: 'reports', name: '报告中心', icon: FileSpreadsheet },
];

const chartText = { color: '#9fb3cc' };
const chartGrid = { top: 32, left: 42, right: 24, bottom: 40 };
const kanoOrder: KanoCategory[] = ['Must-be', 'One-dimensional', 'Attractive'];
const kanoDefinitions: Record<KanoCategory, { title: string; description: string; examples: string[] }> = {
  'Must-be': {
    title: '基本型需求 Must-be',
    description: '不满足会引发强烈不满，满足后用户认为理所当然。',
    examples: ['冬季续航衰减', '空气悬架异响', '雨天智驾误报'],
  },
  'One-dimensional': {
    title: '期望型需求 One-dimensional',
    description: '满足程度越高，用户满意度越高。',
    examples: ['车机卡顿', '充电体验', '空间表现'],
  },
  Attractive: {
    title: '魅力型需求 Attractive',
    description: '超出预期会显著提升满意度，不满足时用户不一定抱怨。',
    examples: ['HUD显示', '露营模式', '智能场景联动'],
  },
  Indifferent: {
    title: '无差异需求 Indifferent',
    description: '用户关注度较低，通常不作为优先改进方向。',
    examples: ['低频装饰配置'],
  },
};

export default function App() {
  const [active, setActive] = useState<PageKey>('dashboard');
  const [reviews, setReviews] = useState<ReviewRecord[]>(seedReviews);
  const [selectedProblemId, setSelectedProblemId] = useState('p1');
  const [selectedFeatureId, setSelectedFeatureId] = useState('e1');

  const uniqueCollaborators = useMemo(() => new Set(scmRecommendations.flatMap((item) => [...item.collaborators, ...item.internalTeams])).size, []);
  const kpis = useMemo(() => getKpis(reviews, problems, uniqueCollaborators), [reviews, uniqueCollaborators]);
  const selectedProblem = problems.find((item) => item.id === selectedProblemId) || problems[0];

  const jumpToQfd = (problemId: string) => {
    setSelectedProblemId(problemId);
    const relation = qfdRelations.find((item) => item.problemId === problemId && item.weight > 0);
    if (relation) setSelectedFeatureId(relation.featureId);
    setActive('qfd');
  };

  const jumpToScm = (featureId: string) => {
    setSelectedFeatureId(featureId);
    setActive('scm');
  };

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <div className="app-shell">
        <header className="header">
          <div className="topbar">
            <div className="brand">
              <div className="logo">PQ-SCM</div>
              <div>
                <h1>新能源汽车感知质量与供应链协同决策支持系统 <span className="tag">学术原型版 V1.0</span></h1>
                <p>Decision Support Prototype for EV Perceived Quality & Supply Chain Management</p>
              </div>
            </div>
            <div className="status">
              <Radio size={14} className="cyan" /> 系统态：健康监测中｜研究者：再来一碗饭
            </div>
          </div>
          <nav className="nav">
            {pages.map((page) => {
              const Icon = page.icon;
              return (
                <button key={page.key} className={active === page.key ? 'active' : ''} onClick={() => setActive(page.key)}>
                  <Icon size={16} />
                  {page.name}
                </button>
              );
            })}
          </nav>
        </header>
        <main className="main">
          <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
            {active === 'dashboard' && <Dashboard kpis={kpis} reviews={reviews} />}
            {active === 'reviews' && <ReviewAnalysis reviews={reviews} setReviews={setReviews} />}
            {active === 'diagnosis' && <Diagnosis selectedProblem={selectedProblem} setSelectedProblemId={setSelectedProblemId} onJumpToQfd={jumpToQfd} />}
            {active === 'qfd' && <Qfd selectedProblem={selectedProblem} setSelectedProblemId={setSelectedProblemId} onJumpToScm={jumpToScm} />}
            {active === 'scm' && <Scm selectedFeatureId={selectedFeatureId} setSelectedFeatureId={setSelectedFeatureId} />}
            {active === 'case' && <CaseStudy />}
            {active === 'reports' && <ReportCenter />}
          </motion.div>
        </main>
      </div>
    </ConfigProvider>
  );
}

function Dashboard({ kpis, reviews }: { kpis: ReturnType<typeof getKpis>; reviews: ReviewRecord[] }) {
  const topProblems = [...problems].sort((a, b) => b.pi - a.pi);
  const radarIndicators = ['智能座舱', '智能驾驶', '高压动力', '底盘NVH', '空间舒适'].map((name) => ({ name, max: 100 }));
  const aspectBars = toAspectBars(reviews);
  return (
    <div className="grid">
      <div className="grid cols-5">
        <Kpi title="累计感知评论数" value={kpis.totalComments.toLocaleString()} hint="多源评论样本" tone="cyan" />
        <Kpi title="负面评论占比" value={`${kpis.negativeRatio}%`} hint="体验痛点与异常反馈" tone="rose" />
        <Kpi title="高优先级质量问题" value={kpis.highPriorityIssues} hint="PI ≥ 40 的质量痛点" tone="amber" />
        <Kpi title="涉及协同主体数" value={kpis.collaborators} hint="供应商与内部团队合计" tone="cyan" />
        <Kpi title="生成改进建议数" value={kpis.recommendations} hint="支持导出诊断报告" tone="green" />
      </div>
      <div className="grid cols-2">
        <section className="hero-panel">
          <h2 className="section-title">新能源汽车感知质量健康度指数（PQ Index）</h2>
          <p className="muted">基于多源评论反馈、FDA三维诊断、Kano属性与QFD工程转化权重综合形成。</p>
          <div className="pq-overview-grid">
            <div className="panel pq-card">
              <div className="pq-gauge-wrap">
                <div className="pq-gauge" />
                <div className="pq-score">{kpis.pqIndex}</div>
              </div>
              <div><span className="tag amber">黄色：中风险预警</span></div>
              <p className="muted pq-loss-text">主要失分项：冬季续航衰减、空气悬架异响、车机高负载卡顿。</p>
            </div>
            <div className="panel radar-panel">
              <h3 className="section-title">质量健康五维雷达</h3>
              <ReactECharts
                className="radar-chart"
                option={{
                  radar: { indicator: radarIndicators, center: ['50%', '52%'], radius: '72%', splitLine: { lineStyle: { color: '#1f3b54' } }, axisName: { color: '#b7c8df', fontSize: 13 } },
                  series: [{ type: 'radar', data: [{ value: [72, 80, 63, 58, 74], areaStyle: { color: 'rgba(34,211,238,.24)' } }] }],
                }}
              />
            </div>
          </div>
        </section>
        <section className="panel">
          <h2 className="section-title">感知质量缺陷指数排行榜</h2>
          {topProblems.map((problem, index) => (
            <div className="flow-node" key={problem.id} style={{ marginBottom: 12 }}>
              <strong>{index + 1}. {problem.name}</strong>
              <span className="tag" style={{ float: 'right', borderColor: getKanoColor(problem.kano), color: getKanoColor(problem.kano) }}>Final PI: {problem.pi}</span>
              <p className="muted">Kano：{getKanoLabel(problem.kano)}｜FDA：{getFdaScore(problem)}｜Final PI：{problem.pi}</p>
              <p className="muted">{getPriorityExplanation(problem.kano)}</p>
            </div>
          ))}
        </section>
      </div>
      <section className="panel">
        <h2 className="section-title">感知领域负面评论趋势与Kano痛点分布</h2>
        <ReactECharts
          className="chart-sm"
          option={{
            tooltip: {},
            legend: { textStyle: chartText },
            grid: chartGrid,
            xAxis: { type: 'category', data: aspectBars.map((item) => item.aspect), axisLabel: chartText },
            yAxis: { type: 'value', axisLabel: chartText, splitLine: { lineStyle: { color: '#1e293b' } } },
            series: [
              { name: '总评论样本数', type: 'bar', data: aspectBars.map((item) => item.total), itemStyle: { color: '#64748b' } },
              { name: '消极样本数', type: 'bar', data: aspectBars.map((item) => item.negative), itemStyle: { color: '#fb7185' } },
            ],
          }}
        />
      </section>
    </div>
  );
}

function Kpi({ title, value, hint, tone }: { title: string; value: string | number; hint: string; tone: 'cyan' | 'rose' | 'amber' | 'green' }) {
  return (
    <section className="kpi">
      <div className="muted">{title}</div>
      <div className={`metric ${tone}`}>{value}</div>
      <div className="muted">{hint}</div>
    </section>
  );
}

function sentimentTone(sentiment: Sentiment): 'cyan' | 'rose' | 'amber' | 'green' {
  if (sentiment === 'positive') return 'green';
  if (sentiment === 'negative') return 'rose';
  return 'amber';
}

function countInsightsBySentiment(insights: ReturnType<typeof extractReviewInsight>[]) {
  return {
    positive: insights.filter((item) => item.sentiment === 'positive').length,
    neutral: insights.filter((item) => item.sentiment === 'neutral').length,
    negative: insights.filter((item) => item.sentiment === 'negative').length,
  };
}

function aspectInsightStats(insights: ReturnType<typeof extractReviewInsight>[]) {
  const total = insights.length || 1;
  return Array.from(new Set(insights.map((item) => item.aspect))).map((aspect) => {
    const items = insights.filter((item) => item.aspect === aspect);
    return {
      aspect,
      count: items.length,
      ratio: Number(((items.length / total) * 100).toFixed(1)),
      positive: items.filter((item) => item.sentiment === 'positive').length,
      neutral: items.filter((item) => item.sentiment === 'neutral').length,
      negative: items.filter((item) => item.sentiment === 'negative').length,
    };
  }).sort((a, b) => b.count - a.count);
}

function keywordStatsByAspect(insights: ReturnType<typeof extractReviewInsight>[]) {
  return aspectInsightStats(insights).slice(0, 8).map(({ aspect }) => {
    const counts = insights
      .filter((item) => item.aspect === aspect)
      .flatMap((item) => item.keywords)
      .reduce<Record<string, number>>((acc, keyword) => {
        acc[keyword] = (acc[keyword] || 0) + 1;
        return acc;
      }, {});
    return {
      aspect,
      keywords: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  });
}

function ReviewAnalysis({ reviews, setReviews }: { reviews: ReviewRecord[]; setReviews: (items: ReviewRecord[]) => void }) {
  const [model, setModel] = useState('全部车型');
  const [importResult, setImportResult] = useState<ReviewImportResult | null>(null);
  const [absaMode, setAbsaMode] = useState<AbsaMode>('rule');
  const [llmConfig, setLlmConfig] = useState<LlmAbsaConfig>(defaultLlmConfig);
  const [llmProgress, setLlmProgress] = useState<LlmProgress>(makeInitialProgress(0));
  const [llmInsights, setLlmInsights] = useState<Record<string, ReviewInsight>>({});
  const [reviewFilter, setReviewFilter] = useState<'all' | 'needReview'>('all');
  const queueControl = useRef({ paused: false, stopped: false, abort: null as AbortController | null });
  const filtered = reviews.filter((item) => model === '全部车型' || item.model === model);
  const models = ['全部车型', ...Array.from(new Set(reviews.map((item) => item.model)))];
  const insights = filtered.map((item) => llmInsights[item.id] || extractReviewInsight(item));
  const visibleInsights = reviewFilter === 'needReview' ? insights.filter((item) => item.needReview) : insights;
  const aspectStats = aspectInsightStats(insights);
  const sentimentCounts = countInsightsBySentiment(insights);
  const keywordStats = keywordStatsByAspect(insights);
  const upload = async (file: File) => {
    const parsed = await parseReviewFile(file);
    setImportResult(parsed);
    if (parsed.reviews.length) setReviews(parsed.reviews);
  };
  const selectTextColumn = (column: string) => {
    if (!importResult) return;
    const next = rebuildReviewImportResult(importResult, column);
    setImportResult(next);
    setReviews(next.reviews);
  };
  const runAnalysis = async () => {
    const targets = reviews;
    const startTime = Date.now();
    queueControl.current = { paused: false, stopped: false, abort: new AbortController() };
    setLlmProgress({ ...makeInitialProgress(targets.length), running: true });
    const nextInsights: Record<string, ReviewInsight> = {};
    let analyzed = 0;
    let success = 0;
    let failed = 0;
    let needReview = 0;

    for (let index = 0; index < targets.length; index += 1) {
      if (queueControl.current.stopped) break;
      while (queueControl.current.paused && !queueControl.current.stopped) await new Promise((resolve) => setTimeout(resolve, 300));
      const review = targets[index];
      const ruleInsight = ruleInsightFor(review);
      try {
        let insight: ReviewInsight;
        if (shouldUseRuleOnly(ruleInsight, absaMode)) {
          insight = { ...ruleInsight, source: 'rule' };
        } else {
          const result = await analyzeWithLlm(review, llmConfig, queueControl.current.abort?.signal);
          insight = resultToInsight(review, result, ruleInsight, absaMode === 'hybrid' ? 'hybrid' : 'llm');
        }
        nextInsights[review.id] = insight;
        if (insight.source !== 'rule') success += 1;
        if (insight.needReview) needReview += 1;
      } catch {
        nextInsights[review.id] = { ...ruleInsight, needReview: true, conflict: ['LLM调用失败'], source: 'hybrid' };
        failed += 1;
        needReview += 1;
      }
      analyzed += 1;
      if (analyzed % Math.max(1, llmConfig.batchSize) === 0 || analyzed === targets.length) setLlmInsights((prev) => ({ ...prev, ...nextInsights }));
      const elapsed = (Date.now() - startTime) / 1000;
      const etaSeconds = analyzed ? Math.max(0, Math.round((elapsed / analyzed) * (targets.length - analyzed))) : 0;
      setLlmProgress({ total: targets.length, analyzed, success, failed, needReview, etaSeconds, running: !queueControl.current.stopped && analyzed < targets.length, paused: queueControl.current.paused, stopped: queueControl.current.stopped });
    }
    setLlmInsights((prev) => ({ ...prev, ...nextInsights }));
    setLlmProgress((prev) => ({ ...prev, running: false, paused: false, stopped: queueControl.current.stopped }));
  };
  const pauseAnalysis = () => { queueControl.current.paused = true; setLlmProgress((prev) => ({ ...prev, paused: true })); };
  const resumeAnalysis = () => { queueControl.current.paused = false; setLlmProgress((prev) => ({ ...prev, paused: false })); };
  const stopAnalysis = () => { queueControl.current.stopped = true; queueControl.current.abort?.abort(); setLlmProgress((prev) => ({ ...prev, running: false, stopped: true })); };
  const confirmInsight = (id: string) => setLlmInsights((prev) => ({ ...prev, [id]: { ...(prev[id] || insights.find((item) => item.id === id)!), needReview: false, conflict: [] } }));
  const confirmHighConfidence = () => setLlmInsights((prev) => {
    const next = { ...prev };
    insights.filter((item) => (item.confidence || 0) >= 0.85 && !item.conflict?.length).forEach((item) => { next[item.id] = { ...item, needReview: false }; });
    return next;
  });
  return (
    <div className="grid">
      <section className="panel">
        <h2 className="section-title">评论数据导入与感知质量信息抽取</h2>
        <label className="upload">
          <input type="file" accept=".xlsx,.xls,.csv,.tsv" style={{ display: 'none' }} onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
          <div>
            <MessageSquareText className="cyan" size={34} />
            <h3>拖拽或点击导入评论表格</h3>
            <p className="muted">支持 TSV / CSV / Excel；系统先识别评论原文，再进行方面识别、情感识别和归因关键词提取。</p>
          </div>
        </label>
      </section>

      <section className="panel">
        <h2 className="section-title">导入状态与样本预览</h2>
        <div className="import-grid">
          <Kpi title="总评论数" value={reviews.length.toLocaleString()} hint={importResult?.fileName || '内置演示样本'} tone="cyan" />
          <Kpi title="识别评论列" value={importResult?.detectedTextColumn || 'text'} hint={importResult?.needsColumnSelection ? '建议手动确认评论列' : '已自动识别'} tone={importResult?.needsColumnSelection ? 'amber' : 'green'} />
          <Kpi title="当前筛选样本" value={filtered.length.toLocaleString()} hint={model} tone="cyan" />
        </div>
        {importResult?.needsColumnSelection && (
          <div className="manual-column">
            <span className="muted">未能高置信识别评论列，请手动选择：</span>
            <select className="btn secondary" value={importResult.detectedTextColumn || ''} onChange={(event) => selectTextColumn(event.target.value)}>
              <option value="">选择评论列</option>
              {importResult.columns.map((column) => <option value={column} key={column}>{column}</option>)}
            </select>
          </div>
        )}
        <div className="sample-preview">
          {filtered.slice(0, 3).map((item) => <p className="muted" key={item.id}>“{item.text}”</p>)}
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">大模型ABSA分析模块</h2>
        <p className="muted">LLM-ABSA用于减少人工标注和复核成本；规则ABSA用于快速初筛和兜底；人工复核只处理低置信度和冲突样本，最终形成高质量NEV-ABSA结构化数据。</p>
        <div className="llm-config-grid">
          <label><span className="muted">分析模式</span><select className="btn secondary" value={absaMode} onChange={(event) => setAbsaMode(event.target.value as AbsaMode)}><option value="rule">规则ABSA</option><option value="llm">LLM-ABSA</option><option value="hybrid">规则+LLM混合模式</option></select></label>
          <label><span className="muted">调用通道</span><select className="btn secondary" value={llmConfig.callMode} onChange={(event) => setLlmConfig({ ...llmConfig, callMode: event.target.value as LlmAbsaConfig['callMode'] })}><option value="server">Vercel服务端代理</option><option value="browser">网页端直连API Key</option><option value="ollama">本地Ollama</option></select></label>
          <label><span className="muted">API Provider</span><select className="btn secondary" value={llmConfig.provider} onChange={(event) => {
            const provider = event.target.value as LlmAbsaConfig['provider'];
            setLlmConfig({
              ...llmConfig,
              provider,
              callMode: provider === 'Ollama' ? 'ollama' : llmConfig.callMode,
              baseUrl: provider === 'DeepSeek' ? 'https://api.deepseek.com' : provider === 'Qwen' ? 'https://dashscope.aliyuncs.com/compatible-mode' : llmConfig.baseUrl,
              modelName: provider === 'Ollama' ? 'qwen2.5:7b' : provider === 'DeepSeek' ? 'deepseek-chat' : llmConfig.modelName,
            });
          }}><option>DeepSeek</option><option>OpenAI compatible</option><option>Qwen</option><option>Custom</option><option>Ollama</option></select></label>
          <label><span className="muted">Base URL</span><input className="input" value={llmConfig.baseUrl} onChange={(event) => setLlmConfig({ ...llmConfig, baseUrl: event.target.value })} /></label>
          <label><span className="muted">网页端 API Key</span><input className="input" type="password" placeholder="仅浏览器直连模式需要填写" value={llmConfig.apiKey || ''} onChange={(event) => setLlmConfig({ ...llmConfig, apiKey: event.target.value })} /></label>
          <label><span className="muted">Ollama 地址</span><input className="input" placeholder="http://127.0.0.1:11434" value={llmConfig.ollamaEndpoint || ''} onChange={(event) => setLlmConfig({ ...llmConfig, ollamaEndpoint: event.target.value })} /></label>
          <label><span className="muted">Model Name</span><input className="input" value={llmConfig.modelName} onChange={(event) => setLlmConfig({ ...llmConfig, modelName: event.target.value })} /></label>
          <label><span className="muted">Temperature</span><input className="input" type="number" step="0.1" value={llmConfig.temperature} onChange={(event) => setLlmConfig({ ...llmConfig, temperature: Number(event.target.value) })} /></label>
          <label><span className="muted">Max Tokens</span><input className="input" type="number" value={llmConfig.maxTokens} onChange={(event) => setLlmConfig({ ...llmConfig, maxTokens: Number(event.target.value) })} /></label>
          <label><span className="muted">Batch Size</span><input className="input" type="number" value={llmConfig.batchSize} onChange={(event) => setLlmConfig({ ...llmConfig, batchSize: Number(event.target.value) })} /></label>
        </div>
        <div className="flow-node" style={{ marginTop: 12 }}>
          <strong>调用方式说明</strong>
          <p className="muted">Vercel服务端代理适合正式在线演示，API Key 放在 Vercel 环境变量中；网页端直连适合个人临时测试，但不要在公共电脑保存密钥；本地 Ollama 适合无外网和本地模型实验，默认地址为 http://127.0.0.1:11434。</p>
        </div>
        <div className="llm-actions">
          <button className="btn" onClick={runAnalysis} disabled={llmProgress.running}>开始分析</button>
          <button className="btn secondary" onClick={pauseAnalysis} disabled={!llmProgress.running || llmProgress.paused}>暂停</button>
          <button className="btn secondary" onClick={resumeAnalysis} disabled={!llmProgress.paused}>继续</button>
          <button className="btn secondary" onClick={stopAnalysis} disabled={!llmProgress.running && !llmProgress.paused}>停止</button>
          <span className="muted">推荐公开网站使用服务端代理；个人实验可在网页端临时填写 API Key；离线实验可连接本地 Ollama。</span>
        </div>
        <div className="progress-wrap">
          <div className="progress-bar"><span style={{ width: `${llmProgress.total ? (llmProgress.analyzed / llmProgress.total) * 100 : 0}%` }} /></div>
          <div className="progress-stats">
            <span>已分析 {llmProgress.analyzed}/{llmProgress.total || reviews.length}</span>
            <span>成功 {llmProgress.success}</span>
            <span>失败 {llmProgress.failed}</span>
            <span>需复核 {llmProgress.needReview || insights.filter((item) => item.needReview).length}</span>
            <span>预计剩余 {llmProgress.etaSeconds}s</span>
          </div>
        </div>
      </section>

      <div className="grid cols-3">
        <section className="panel">
          <h2 className="section-title">情感分布</h2>
          <div className="sentiment-cards">
            {(['positive', 'neutral', 'negative'] as Sentiment[]).map((sentiment) => {
              const count = sentimentCounts[sentiment];
              const ratio = insights.length ? ((count / insights.length) * 100).toFixed(1) : '0.0';
              return <div className="sentiment-card" key={sentiment}><span className={`tag ${sentimentTone(sentiment)}`}>{sentimentLabel(sentiment)}</span><strong>{ratio}%</strong><p className="muted">{count} 条评论</p></div>;
            })}
          </div>
          <ReactECharts className="chart-xs" option={{ tooltip: {}, series: [{ type: 'pie', radius: ['48%', '72%'], data: toPieData(filtered) }] }} />
        </section>
        <section className="panel">
          <h2 className="section-title">方面分布</h2>
          <ReactECharts className="chart-sm" option={{ tooltip: {}, grid: { ...chartGrid, bottom: 72 }, xAxis: { type: 'category', data: aspectStats.map((item) => item.aspect), axisLabel: { ...chartText, rotate: 30 } }, yAxis: { type: 'value', axisLabel: chartText }, series: [{ type: 'bar', data: aspectStats.map((item) => item.count), itemStyle: { color: '#22d3ee' }, label: { show: true, position: 'top', color: '#b7c8df', formatter: (p: { dataIndex: number }) => `${aspectStats[p.dataIndex]?.ratio}%` } }] }} />
        </section>
        <section className="panel">
          <h2 className="section-title">方面 × 情感矩阵</h2>
          <div className="sentiment-matrix">
            {aspectStats.slice(0, 8).map((item) => {
              const total = item.count || 1;
              return <div className="matrix-row" key={item.aspect}><strong>{item.aspect}</strong><div className="matrix-bars"><span className="green-bg" style={{ width: `${(item.positive / total) * 100}%` }} /><span className="amber-bg" style={{ width: `${(item.neutral / total) * 100}%` }} /><span className="rose-bg" style={{ width: `${(item.negative / total) * 100}%` }} /></div><span className="muted">{Math.round((item.negative / total) * 100)}%负面</span></div>;
            })}
          </div>
        </section>
      </div>

      <section className="panel">
        <h2 className="section-title">归因关键词提取</h2>
        <div className="keyword-grid">
          {keywordStats.map((group) => <div className="keyword-card" key={group.aspect}><h3>{group.aspect}</h3><div className="tag-wrap">{group.keywords.map(([keyword, count]) => <span className="tag" key={keyword}>{keyword} × {count}</span>)}</div></div>)}
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">人工复核工作台</h2>
        <div className="review-toolbar">
          <button className={`btn ${reviewFilter === 'all' ? '' : 'secondary'}`} onClick={() => setReviewFilter('all')}>全部样本</button>
          <button className={`btn ${reviewFilter === 'needReview' ? '' : 'secondary'}`} onClick={() => setReviewFilter('needReview')}>仅看需复核</button>
          <button className="btn secondary" onClick={confirmHighConfidence}>一键确认高置信度结果</button>
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">结构化感知质量问题</h2>
        <select className="btn secondary" value={model} onChange={(event) => setModel(event.target.value)} style={{ marginBottom: 14 }}>{models.map((item) => <option key={item}>{item}</option>)}</select>
        <table className="table absa-table">
          <thead><tr><th>原始评论</th><th>分析来源</th><th>识别方面</th><th>观点词</th><th>情感方向</th><th>归因说明</th><th>置信度</th><th>复核</th></tr></thead>
          <tbody>{visibleInsights.sort((a, b) => Number(b.needReview) - Number(a.needReview) || (a.confidence || 0) - (b.confidence || 0)).map((item) => <tr key={item.id}><td className="muted review-text-cell">{item.rawText}</td><td><span className="tag">{item.source || 'rule'}</span></td><td><span className="tag">{item.aspect}</span></td><td><div className="tag-wrap">{(item.keywords.length ? item.keywords : [item.opinion || '需人工复核']).map((keyword) => <span className="tag" key={keyword}>{keyword}</span>)}</div></td><td><span className={`tag ${sentimentTone(item.sentiment)}`}>{sentimentLabel(item.sentiment)}</span></td><td>{item.reason}{item.conflict?.length ? <p className="rose">冲突项：{item.conflict.join('、')}</p> : null}</td><td>{((item.confidence || 0) * 100).toFixed(0)}%</td><td>{item.needReview ? <button className="btn secondary" onClick={() => confirmInsight(item.id)}>确认</button> : <span className="tag green">已通过</span>}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

function Diagnosis({ selectedProblem, setSelectedProblemId, onJumpToQfd }: { selectedProblem: QualityProblem; setSelectedProblemId: (id: string) => void; onJumpToQfd: (id: string) => void }) {
  const scatterSeries = kanoOrder.map((kano) => ({
    name: getKanoLabel(kano),
    type: 'scatter' as const,
    symbolSize: (data: Array<string | number>) => Math.max(18, Number(data[2] || 10) * 1.05),
    data: problems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.kano === kano)
      .map(({ item, index }) => [item.attention, item.dissatisfaction, item.pi, item.name, index]),
    itemStyle: { color: getKanoColor(kano) },
    label: { show: true, formatter: (p: unknown) => { const params = p as { data?: Array<string | number> }; return String(Math.round(Number(params.data?.[2] || 0))); }, color: '#06111f', fontWeight: 800 },
  }));
  const selectedFda = getFdaScore(selectedProblem);
  const selectedCoefficient = getKanoCoefficient(selectedProblem.kano);

  return (
    <div className="grid">
      <section className="panel">
        <h2 className="section-title">Kano-FDA 联合诊断方法链</h2>
        <div className="method-chain">
          {[
            ['ABSA', '出了什么问题', '从评论中抽取方面、观点、情感与原因。'],
            ['Kano', '属于什么需求', '识别基本型、期望型与魅力型需求属性。'],
            ['FDA', '先改什么', '衡量关注度、不满意度和情感强度。'],
            ['QFD', '改什么', '将用户语言转化为工程质量特征。'],
            ['供应链映射', '谁来协同改', '推荐潜在协同主体与协同方式。'],
          ].map(([title, question, desc]) => <div className="method-card" key={title}><span className="tag">{title}</span><h3>{question}</h3><p className="muted">{desc}</p></div>)}
        </div>
      </section>
      <div className="grid cols-2">
        <section className="panel">
          <h2 className="section-title">Kano-FDA联合诊断图</h2>
          <p className="muted">颜色表示 Kano 需求属性；气泡大小表示综合优先级 PI。</p>
          <ReactECharts
            className="chart"
            option={{
              tooltip: { formatter: (p: unknown) => { const params = p as { data: Array<string | number>; seriesName: string }; return `${params.data[3]}<br/>${params.seriesName}<br/>关注度A：${params.data[0]}<br/>不满意度D：${params.data[1]}<br/>Final PI：${params.data[2]}`; } },
              legend: { textStyle: chartText, top: 0 },
              grid: { ...chartGrid, top: 58 },
              xAxis: { name: '关注度 A', min: 45, max: 100, axisLabel: chartText, splitLine: { lineStyle: { color: '#1e293b' } } },
              yAxis: { name: '不满意度 D', min: 45, max: 100, axisLabel: chartText, splitLine: { lineStyle: { color: '#1e293b' } } },
              series: scatterSeries,
            }}
            onEvents={{ click: (params: { data: unknown[] }) => setSelectedProblemId(problems[Number(params.data[4])].id) }}
          />
        </section>
        <section className="panel">
          <h2 className="section-title">问题归因分析</h2>
          <div className="detail-grid">
            <Kpi title="FDA得分" value={selectedFda} hint="未加入Kano系数前的严重程度" tone="cyan" />
            <Kpi title="Kano修正系数" value={selectedCoefficient} hint={getKanoLabel(selectedProblem.kano)} tone={selectedProblem.kano === 'Must-be' ? 'rose' : selectedProblem.kano === 'Attractive' ? 'green' : 'cyan'} />
            <Kpi title="最终PI值" value={selectedProblem.pi} hint={getPriorityExplanation(selectedProblem.kano)} tone="amber" />
          </div>
          <h2>{selectedProblem.name}</h2>
          <p className="muted">所属领域：{selectedProblem.aspect}｜Kano类型：{getKanoLabel(selectedProblem.kano)}</p>
          <p>{selectedProblem.attribution}</p>
          <h3>典型评论证据</h3>
          {selectedProblem.typicalComments.map((comment) => <p className="muted evidence" key={comment}>“{comment}”</p>)}
          <button className="btn" onClick={() => onJumpToQfd(selectedProblem.id)}>推荐下一步：转入 QFD 工程转化</button>
        </section>
      </div>
      <div className="grid cols-2">
        <section className="panel">
          <h2 className="section-title">Kano需求属性分布</h2>
          <div className="kano-grid">
            {kanoOrder.map((kano) => {
              const definition = kanoDefinitions[kano];
              const tags = [...problems.filter((item) => item.kano === kano).map((item) => item.name), ...definition.examples].slice(0, 5);
              return <div className="kano-card" key={kano} style={{ borderColor: getKanoColor(kano) }}><h3 style={{ color: getKanoColor(kano) }}>{definition.title}</h3><p className="muted">{definition.description}</p><div className="tag-wrap">{tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div></div>;
            })}
          </div>
        </section>
        <section className="panel">
          <h2 className="section-title">优先级计算说明</h2>
          <div className="formula-box">FDA得分 = wA × Z(A) + wD × Z(D) + wI × Z(I)</div>
          <div className="formula-box">最终优先级 = FDA得分 × Kano修正系数</div>
          <p className="muted">Kano修正系数示例：Must-be = 1.2，One-dimensional = 1.0，Attractive = 0.8。系数可根据专家评价或敏感性分析调整。</p>
          <p className="muted">Kano不是简单标签，而是需求属性识别工具；FDA不是单纯图表，而是改进优先级诊断工具。联合诊断体现“需求属性 + 问题严重程度”的综合判断。</p>
        </section>
      </div>
    </div>
  );
}

function Qfd({ selectedProblem, setSelectedProblemId, onJumpToScm }: { selectedProblem: QualityProblem; setSelectedProblemId: (id: string) => void; onJumpToScm: (id: string) => void }) {
  const selectedRelations = qfdRelations.filter((item) => item.problemId === selectedProblem.id && item.weight > 0);
  const makeNodes = (): Node[] => [{ id: selectedProblem.id, data: { label: selectedProblem.name }, position: { x: 40, y: 140 }, style: nodeStyle('#22d3ee') }, ...selectedRelations.map((relation, index) => ({ id: relation.featureId, data: { label: `${engineeringFeatures.find((item) => item.id === relation.featureId)?.name}\n关联度 ${relation.weight}` }, position: { x: 420, y: index * 110 + 60 }, style: nodeStyle(relation.weight === 9 ? '#fb7185' : '#fbbf24') }))];
  const makeEdges = (): Edge[] => selectedRelations.map((relation) => ({ id: `${selectedProblem.id}-${relation.featureId}`, source: selectedProblem.id, target: relation.featureId, animated: true }));
  const [nodes, setNodes, onNodesChange] = useNodesState(makeNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(makeEdges());
  useEffect(() => { setNodes(makeNodes()); setEdges(makeEdges()); }, [selectedProblem.id]);
  const priorities = featurePriority(engineeringFeatures, qfdRelations, problems);
  return (
    <div className="grid">
      <section className="panel">
        <h2 className="section-title">QFD质量屋矩阵</h2>
        <table className="table"><thead><tr><th>感知问题</th>{engineeringFeatures.slice(0, 5).map((item) => <th key={item.id}>{item.name}</th>)}</tr></thead><tbody>{problems.map((problem) => <tr key={problem.id} onClick={() => setSelectedProblemId(problem.id)}><td><strong>{problem.name}</strong></td>{engineeringFeatures.slice(0, 5).map((feature) => { const weight = qfdRelations.find((item) => item.problemId === problem.id && item.featureId === feature.id)?.weight || 0; return <td key={feature.id}>{weight ? <span className="tag">{weight}</span> : <span className="muted">-</span>}</td>; })}</tr>)}</tbody></table>
      </section>
      <section className="panel">
        <h2 className="section-title">当前链路转化：{selectedProblem.name}</h2>
        <p className="muted">节点可拖动调整展示位置，适合答辩现场演示。</p>
        <div style={{ height: 360 }}><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodesDraggable nodesConnectable={false} panOnDrag zoomOnScroll zoomOnPinch fitView><Background color="#1e3a4c" gap={18} /><Controls /></ReactFlow></div>
      </section>
      <section className="panel"><h2 className="section-title">ECT工程特征重要度</h2>{priorities.slice(0, 6).map((item) => <button className="flow-node" key={item.id} style={{ width: '100%', marginBottom: 10, textAlign: 'left' }} onClick={() => onJumpToScm(item.id)}>{item.name}<span className="tag" style={{ float: 'right' }}>{item.score}</span></button>)}</section>
    </div>
  );
}

function Scm({ selectedFeatureId, setSelectedFeatureId }: { selectedFeatureId: string; setSelectedFeatureId: (id: string) => void }) {
  const rec = scmRecommendations.find((item) => item.featureId === selectedFeatureId) || scmRecommendations[0];
  const feature = engineeringFeatures.find((item) => item.id === rec.featureId) || engineeringFeatures[0];
  const makeNodes = (): Node[] => [{ id: 'feature', data: { label: feature.name }, position: { x: 20, y: 130 }, style: nodeStyle('#22d3ee') }, { id: 'module', data: { label: rec.module }, position: { x: 310, y: 130 }, style: nodeStyle('#a78bfa') }, ...rec.collaborators.map((item, index) => ({ id: `c${index}`, data: { label: item }, position: { x: 600, y: 60 + index * 95 }, style: nodeStyle('#fbbf24') })), ...rec.internalTeams.map((item, index) => ({ id: `t${index}`, data: { label: item }, position: { x: 880, y: 60 + index * 95 }, style: nodeStyle('#34d399') }))];
  const makeEdges = (): Edge[] => [{ id: 'f-m', source: 'feature', target: 'module', animated: true }, ...rec.collaborators.map((_, index) => ({ id: `m-c${index}`, source: 'module', target: `c${index}`, animated: true })), ...rec.internalTeams.map((_, index) => ({ id: `m-t${index}`, source: 'module', target: `t${index}`, animated: true }))];
  const [nodes, setNodes, onNodesChange] = useNodesState(makeNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(makeEdges());
  useEffect(() => { setNodes(makeNodes()); setEdges(makeEdges()); }, [selectedFeatureId]);
  return (
    <div className="grid cols-2">
      <section className="panel">
        <h2 className="section-title">协同推荐知识图谱</h2>
        <select className="btn secondary" value={selectedFeatureId} onChange={(event) => setSelectedFeatureId(event.target.value)}>{engineeringFeatures.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
        <p className="muted">节点可拖动调整展示位置，适合答辩现场演示。</p>
        <div style={{ height: 420 }}><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodesDraggable nodesConnectable={false} panOnDrag zoomOnScroll zoomOnPinch fitView><Background color="#1e3a4c" gap={18} /><Controls /></ReactFlow></div>
      </section>
      <section className="panel"><h2 className="section-title">协同决策推荐</h2><Kpi title="协同紧迫度" value={rec.urgency} hint="基于PI与质量影响" tone={rec.urgency === '高' ? 'rose' : 'amber'} /><div className="flow-node"><h3>协同方式建议</h3><p>{rec.method}</p><p className="muted">{rec.suggestion}</p></div></section>
    </div>
  );
}

function CaseStudy() {
  return <section className="panel"><h2 className="section-title">问界 M9 案例实证</h2><div className="flow-wrap">{['评论', 'ABSA', 'Kano+FDA', 'QFD', '供应链映射', '协同建议'].map((item, index) => <div className="flow-node" key={item}><span className="tag">STEP {index + 1}</span><h3>{item}</h3></div>)}</div></section>;
}

function ReportCenter() {
  const exportExcel = () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(problems), '质量问题');
    XLSX.writeFile(workbook, 'PQ-SCM感知质量诊断报告.xlsx');
  };
  return <section className="panel"><h2 className="section-title">报告中心</h2>{reports.map((item) => <div className="flow-node" key={item.title} style={{ marginBottom: 12 }}><strong>{item.title}</strong><button className="btn" style={{ float: 'right' }} onClick={() => makeDownload(item.title, `${item.title}.txt`)}>导出</button><p className="muted">格式：{item.type}｜大小：{item.size}｜时间：{item.date}</p></div>)}<button className="btn" onClick={exportExcel}>生成Excel诊断报告</button></section>;
}

function nodeStyle(color: string) {
  return { color: '#e5f4ff', border: `1px solid ${color}`, background: '#0f172a', borderRadius: 10, boxShadow: `0 0 18px ${color}33`, whiteSpace: 'pre-line', width: 210 };
}
