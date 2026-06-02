import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ClipboardCheck, FileSpreadsheet, Gauge, Layers3, MessageSquareText, Radio, Share2 } from 'lucide-react';
import { ConfigProvider, theme } from 'antd';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import ReactFlow, { Background, Controls, Edge, Node, useEdgesState, useNodesState } from 'react-flow-renderer';
import ReactECharts from './ReactECharts';
import { extractAbsa } from './absa';
import { engineeringFeatures, problems, qfdRelations, reports, reviews as seedReviews, scmRecommendations, warnings } from './data';
import { featurePriority, getFdaScore, getKanoCoefficient, getKanoColor, getKanoLabel, getKpis, getPriorityExplanation, makeDownload, sentimentLabel, toAspectBars, toPieData } from './analytics';
import { parseReviewFile } from './upload';
import { KanoCategory, QualityProblem, ReviewRecord } from './types';

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

function ReviewAnalysis({ reviews, setReviews }: { reviews: ReviewRecord[]; setReviews: (items: ReviewRecord[]) => void }) {
  const [model, setModel] = useState('全部车型');
  const filtered = reviews.filter((item) => model === '全部车型' || item.model === model);
  const models = ['全部车型', ...Array.from(new Set(reviews.map((item) => item.model)))];
  const upload = async (file: File) => {
    const parsed = await parseReviewFile(file);
    if (parsed.length) setReviews(parsed);
  };
  return (
    <div className="grid">
      <section className="panel">
        <h2 className="section-title">评论数据导入与方面级ABSA分析</h2>
        <label className="upload">
          <input type="file" accept=".xlsx,.xls,.csv,.tsv" style={{ display: 'none' }} onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
          <div>
            <MessageSquareText className="cyan" size={34} />
            <h3>拖拽或点击导入评论表格</h3>
            <p className="muted">支持 TSV / CSV / Excel；压缩包请先解压后上传 train.tsv、validation.tsv 或 test.tsv，系统将输出 Aspect、Opinion、Sentiment、Reason 四类信息。</p>
          </div>
        </label>
      </section>
      <div className="grid cols-3">
        <section className="panel"><h2 className="section-title">ABSA情感分布</h2><ReactECharts className="chart-sm" option={{ tooltip: {}, series: [{ type: 'pie', radius: ['45%', '70%'], data: toPieData(reviews) }] }} /></section>
        <section className="panel"><h2 className="section-title">方面分布</h2><ReactECharts className="chart-sm" option={{ tooltip: {}, grid: chartGrid, xAxis: { type: 'category', data: toAspectBars(reviews).map((item) => item.aspect), axisLabel: { ...chartText, rotate: 15 } }, yAxis: { type: 'value', axisLabel: chartText }, series: [{ type: 'bar', data: toAspectBars(reviews).map((item) => item.total), itemStyle: { color: '#22d3ee' } }] }} /></section>
        <section className="panel"><h2 className="section-title">感知痛点词云</h2><div className="word-cloud">{['冬季续航', '车机卡顿', '空悬异响', '雨天误报', 'BMS策略', '快充限流'].map((word, index) => <span key={word} className={index % 2 ? 'amber' : 'cyan'} style={{ fontSize: 20 + index * 3 }}>{word}</span>)}</div></section>
      </div>
      <section className="panel">
        <h2 className="section-title">方面级ABSA结构化结果</h2>
        <select className="btn secondary" value={model} onChange={(event) => setModel(event.target.value)} style={{ marginBottom: 14 }}>{models.map((item) => <option key={item}>{item}</option>)}</select>
        <table className="table absa-table">
          <thead><tr><th>Aspect（方面）</th><th>Opinion（观点）</th><th>Sentiment（情感）</th><th>Reason（原因）</th><th>原始评论</th></tr></thead>
          <tbody>{filtered.map((item) => { const result = extractAbsa(item.text, item.sentiment); return <tr key={item.id}><td><span className="tag">{result.aspect}</span></td><td>{result.opinion}</td><td><span className={`tag ${result.sentiment === 'negative' ? 'rose' : result.sentiment === 'positive' ? 'green' : ''}`}>{sentimentLabel(result.sentiment)}</span></td><td>{result.reason}</td><td className="muted review-text-cell">{item.text}</td></tr>; })}</tbody>
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
