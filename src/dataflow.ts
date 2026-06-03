import { AnalysisResult, EngineeringFeature, EngineeringFeatureScore, EnterpriseProfile, IssueSummary, KanoCategory, QfdResult, ReviewInsight, ReviewRecord, SupplyChainResult } from './types';

const fdaWeights = { attention: 0.3, dissatisfaction: 0.5, intensity: 0.2 };
const kanoFactor: Record<KanoCategory, number> = { 'Must-be': 1.2, 'One-dimensional': 1.0, Attractive: 0.8, Indifferent: 0.7 };

const issueRules = [
  { issue: '冬季续航衰减', aspect: '续航与能耗', pattern: /续航|掉电|电耗|里程|BMS|热泵|低温|冬天|缩水|电池|空调|热风/ },
  { issue: '车机系统卡顿', aspect: '智能座舱', pattern: /车机|中控|屏|语音|系统|OTA|卡顿|黑屏|死机|响应|导航|投屏|内存|SoC/ },
  { issue: 'NVH异常', aspect: '舒适性与NVH', pattern: /座椅|腰疼|悬架|悬挂|风噪|胎噪|异响|NVH|噪声|压缩机|震动|减速带/ },
  { issue: '智驾误报与退出', aspect: '智能驾驶', pattern: /智驾|辅助驾驶|自动泊车|AEB|雷达|误报|摄像头|雨|雾|制动|退出|识别/ },
  { issue: '充电兼容性与效率不足', aspect: '充电体验', pattern: /充电|快充|慢充|充电桩|兼容|中断|限流|补能|协议/ },
  { issue: '空间舒适表现', aspect: '空间表现', pattern: /空间|后排|前排|乘坐|储物|后备箱|舒服|宽敞/ },
  { issue: '动力响应体验', aspect: '动力性能', pattern: /动力|加速|起步|电机|扭矩|响应|换挡/ },
  { issue: '内饰质感与装配', aspect: '内饰质感', pattern: /内饰|做工|用料|塑料|软包|异味|装配|气味/ },
  { issue: '外观造型感知', aspect: '外观造型', pattern: /外观|造型|颜值|车身|颜色|线条|漆面|设计/ },
  { issue: '售后服务与交付体验', aspect: '售后服务与交付', pattern: /售后|4S|服务|交付|保养|维修|客服|门店|态度/ },
  { issue: '安全配置完整性', aspect: '安全配置', pattern: /安全|配置|气囊|雷达|摄像头|制动|预警/ },
];

const qfdMappings = [
  ['冬季续航衰减', '续航与能耗', '电池低温放电性能', 9, ['低温', '冬天', '掉电', '续航缩水', '电池'], '动力电池系统', '低温环境下电芯放电能力与可用容量保持能力'],
  ['冬季续航衰减', '续航与能耗', '电池热管理效率', 9, ['低温', '热泵', '电池加热', '空调', '热风'], '热管理系统', '电池包和乘员舱热管理效率协同'],
  ['冬季续航衰减', '续航与能耗', 'BMS低温控制策略', 9, ['BMS', '预热', '标定', '掉电'], '三电控制系统', '低温预热、放电功率和能量管理策略'],
  ['冬季续航衰减', '续航与能耗', '热泵系统效率', 3, ['热泵', '空调', '制热'], '热管理系统', '热泵制热效率与能耗平衡'],
  ['冬季续航衰减', '续航与能耗', '整车能耗控制', 3, ['电耗', '能耗', '续航'], '整车能耗系统', '整车级能耗标定与低温策略'],
  ['车机系统卡顿', '智能座舱', '座舱芯片算力', 9, ['SoC', '芯片', '多任务', '算力'], '智能座舱', '高负载座舱任务的算力支撑'],
  ['车机系统卡顿', '智能座舱', '系统内存管理', 9, ['内存', '卡顿', '黑屏', '多屏'], '智能座舱软件', '多任务资源调度与内存回收'],
  ['车机系统卡顿', '智能座舱', '软件响应时间', 9, ['响应', '卡顿', '延迟', '导航', '投屏'], '智能座舱软件', 'HMI与多媒体链路响应优化'],
  ['车机系统卡顿', '智能座舱', 'OTA系统稳定性', 3, ['OTA', '系统', '升级'], '智能座舱软件', '软件版本修复与稳定性验证'],
  ['车机系统卡顿', '智能座舱', '散热设计', 3, ['高温', '调频', '散热'], '座舱域控硬件', '域控热设计与性能释放'],
  ['NVH异常', '舒适性与NVH', '悬架结构设计', 9, ['悬架', '悬挂', '震动', '减速带'], '底盘与悬架系统', '悬架结构参数和舒适性匹配'],
  ['NVH异常', '舒适性与NVH', '空气弹簧供应质量', 9, ['空气悬架', '压缩机', '异响', '阀'], '底盘与悬架系统', '空气弹簧与阀体供应质量复核'],
  ['NVH异常', '舒适性与NVH', '减振器匹配参数', 3, ['减震', '偏硬', '震动'], '底盘与悬架系统', '减振器阻尼与车身舒适性匹配'],
  ['NVH异常', '舒适性与NVH', '底盘装配工艺', 3, ['装配', '异响', '风噪', '密封'], '整车制造工艺', '底盘和密封装配一致性控制'],
  ['智驾误报与退出', '智能驾驶', '传感器感知精度', 9, ['雷达', '摄像头', '感知', '识别'], '智能驾驶感知系统', '传感器识别精度和标定稳定性'],
  ['智驾误报与退出', '智能驾驶', '算法识别阈值', 9, ['误报', '退出', '阈值', '制动'], '智能驾驶算法', '异常场景识别阈值与控制策略'],
  ['智驾误报与退出', '智能驾驶', '雷达/摄像头融合策略', 9, ['雷达', '摄像头', '融合'], '智能驾驶感知系统', '多传感器融合与异常过滤'],
  ['智驾误报与退出', '智能驾驶', '雨雾天气鲁棒性', 3, ['雨', '雾', '暴雨', '低能见度'], '智能驾驶算法', '极端天气数据集和鲁棒性验证'],
  ['充电兼容性与效率不足', '充电体验', '充电协议兼容性', 9, ['充电桩', '兼容', '协议', '中断'], '充电系统', '充电协议和桩端适配能力'],
  ['充电兼容性与效率不足', '充电体验', 'BMS充电控制策略', 9, ['BMS', '充电', '限流'], '三电控制系统', '充电过程控制与保护策略'],
  ['充电兼容性与效率不足', '充电体验', '充电桩适配能力', 3, ['充电桩', '适配'], '充电系统', '不同桩端设备兼容验证'],
  ['充电兼容性与效率不足', '充电体验', '热管理保护策略', 3, ['热管理', '限流', '保护'], '热管理系统', '充电热保护与效率平衡'],
] as const;

export const enterpriseLibrary: EnterpriseProfile[] = [
  { enterprise_name: '宁德时代', module: '动力电池系统', role_type: '电池供应商', main_products: '动力电池、电芯、BMS', typical_customers: '多家新能源整车企业', collaboration_capability: '低温放电、BMS标定、电池测试数据共享', notes: '适合电池低温与BMS策略协同' },
  { enterprise_name: '比亚迪弗迪电池', module: '动力电池系统', role_type: '电池供应商', main_products: '刀片电池、BMS', typical_customers: '比亚迪及外部客户', collaboration_capability: '电芯材料、BMS策略、低温测试', notes: '适合电池系统联合验证' },
  { enterprise_name: '中创新航', module: '动力电池系统', role_type: '电池供应商', main_products: '动力电池、电池包', typical_customers: '新能源乘用车客户', collaboration_capability: '低温性能与电池包验证', notes: '候选电池协同主体' },
  { enterprise_name: '三花智控', module: '热管理系统', role_type: '热管理供应商', main_products: '热管理阀件、热泵部件', typical_customers: '新能源整车企业', collaboration_capability: '热泵效率、冷媒阀件、热管理参数协同', notes: '适合热管理效率优化' },
  { enterprise_name: '银轮股份', module: '热管理系统', role_type: '热管理供应商', main_products: '换热器、热管理模块', typical_customers: '乘用车与商用车客户', collaboration_capability: '冷却管路、换热效率、台架测试', notes: '适合热管理测试协同' },
  { enterprise_name: '华为数字能源', module: '三电控制系统', role_type: '控制系统供应商', main_products: '电驱、电源、数字能源方案', typical_customers: '新能源整车与能源客户', collaboration_capability: '控制策略、能源管理、OTA标定', notes: '适合BMS与能耗策略协同' },
  { enterprise_name: '高通', module: '智能座舱', role_type: '芯片供应商', main_products: '座舱SoC', typical_customers: '智能汽车客户', collaboration_capability: '算力适配、芯片负载测试、多任务性能优化', notes: '适合座舱芯片算力问题' },
  { enterprise_name: '地平线', module: '智能驾驶感知系统', role_type: '芯片/算法供应商', main_products: '车规芯片、辅助驾驶算法', typical_customers: '新能源整车企业', collaboration_capability: '感知算法、芯片适配、场景数据集', notes: '适合智驾感知和座舱算力协同' },
  { enterprise_name: '芯驰科技', module: '智能座舱', role_type: '芯片供应商', main_products: '座舱芯片、车规处理器', typical_customers: '车载电子客户', collaboration_capability: '座舱域控算力与稳定性测试', notes: '候选座舱芯片主体' },
  { enterprise_name: '华为车BU', module: '智能座舱软件', role_type: '软件/算法供应商', main_products: '智能座舱、智能驾驶方案', typical_customers: '合作车企', collaboration_capability: '系统响应优化、OTA修复、智能驾驶算法协同', notes: '适合座舱软件和智驾协同' },
  { enterprise_name: '百度Apollo', module: '智能座舱软件', role_type: '软件服务商', main_products: '智能座舱、自动驾驶平台', typical_customers: '整车企业', collaboration_capability: '软件响应、语音导航、自动驾驶场景', notes: '候选软件协同主体' },
  { enterprise_name: '科大讯飞', module: '智能座舱软件', role_type: '语音软件供应商', main_products: '车载语音、人机交互', typical_customers: '整车企业', collaboration_capability: '语音响应优化、离线语音能力', notes: '适合语音响应问题' },
  { enterprise_name: '禾赛科技', module: '智能驾驶感知系统', role_type: '传感器供应商', main_products: '激光雷达', typical_customers: '乘用车与Robotaxi客户', collaboration_capability: '传感器标定、雨雾场景数据补充', notes: '适合雷达感知精度协同' },
  { enterprise_name: '速腾聚创', module: '智能驾驶感知系统', role_type: '传感器供应商', main_products: '激光雷达', typical_customers: '智能汽车客户', collaboration_capability: '点云质量、传感器标定、鲁棒性测试', notes: '适合智驾误报协同' },
  { enterprise_name: 'Momenta', module: '智能驾驶算法', role_type: '算法供应商', main_products: '辅助驾驶算法', typical_customers: '整车企业', collaboration_capability: '识别阈值优化、场景数据训练', notes: '适合算法识别阈值协同' },
  { enterprise_name: '拓普集团', module: '底盘与悬架系统', role_type: '底盘供应商', main_products: '底盘、悬架、热管理零部件', typical_customers: '新能源整车企业', collaboration_capability: '结构参数复核、NVH测试、装配工艺优化', notes: '适合悬架结构和NVH协同' },
  { enterprise_name: '保隆科技', module: '底盘与悬架系统', role_type: '底盘零部件供应商', main_products: '空气悬架、传感器', typical_customers: '乘用车客户', collaboration_capability: '空气弹簧质量、悬架传感器验证', notes: '适合空气悬架协同' },
  { enterprise_name: '中鼎股份', module: '底盘与悬架系统', role_type: '橡胶密封供应商', main_products: '密封件、减振件', typical_customers: '整车客户', collaboration_capability: 'NVH、密封和减振件协同', notes: '适合异响和风噪问题' },
  { enterprise_name: '特来电', module: '充电系统', role_type: '充电服务商', main_products: '充电桩、充电网络', typical_customers: '新能源车主与车企', collaboration_capability: '协议兼容测试、充电异常数据共享', notes: '适合充电兼容性协同' },
  { enterprise_name: '星星充电', module: '充电系统', role_type: '充电服务商', main_products: '充电设备、运营平台', typical_customers: '新能源车主与车企', collaboration_capability: '充电桩适配、异常中断数据共享', notes: '候选充电协同主体' },
  { enterprise_name: '国家电网', module: '充电系统', role_type: '充电网络运营方', main_products: '公共充电网络', typical_customers: '公共充电用户', collaboration_capability: '充电协议、桩端数据和区域测试', notes: '适合公共充电兼容验证' },
  { enterprise_name: '整车厂软件中心', module: '智能座舱软件', role_type: '整车厂内部团队', main_products: '车机系统、OTA软件', typical_customers: '内部业务部门', collaboration_capability: '系统响应优化、内存管理、OTA修复', notes: '内部候选协同主体' },
  { enterprise_name: '整车厂三电部门', module: '三电控制系统', role_type: '整车厂内部团队', main_products: '三电控制与标定', typical_customers: '内部项目', collaboration_capability: 'BMS低温策略、OTA标定、台架测试', notes: '内部候选协同主体' },
];

function normalizeIssue(result: AnalysisResult) {
  const text = `${result.aspect} ${result.opinion} ${result.reason} ${result.raw_text}`;
  return issueRules.find((rule) => rule.pattern.test(text))?.issue || `${result.aspect}体验问题`;
}

function estimateIntensity(text: string, sentiment: string) {
  if (sentiment !== 'negative') return 0;
  if (/垃圾|完全不能用|崩溃|无法接受|忍不了/.test(text)) return 1.0;
  if (/严重|很差|受不了|频繁|特别明显/.test(text)) return 0.8;
  if (/明显|经常|缩水|卡顿|异响|误报/.test(text)) return 0.6;
  if (/有点|偶尔|一两秒|轻微/.test(text)) return 0.4;
  return 0.6;
}

function normalizeValues(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((value) => (max === min ? 0.5 : (value - min) / (max - min)));
}

function classifyKano(aspect: string, issueType: string, positiveRatio: number, negativeRatio: number): KanoCategory {
  if (/HUD|露营模式|智能场景|车载冰箱|氛围灯|自动泊车/.test(issueType)) return 'Attractive';
  if (positiveRatio >= 50 && negativeRatio < 20) return 'Attractive';
  if (negativeRatio >= 70 && positiveRatio <= 20) return 'Must-be';
  if (['安全配置', '续航与能耗', '售后服务与交付', '操控与底盘'].includes(aspect) && negativeRatio >= 50) return 'Must-be';
  if (positiveRatio >= 20 && negativeRatio >= 20) return 'One-dimensional';
  return negativeRatio >= 50 ? 'Must-be' : 'One-dimensional';
}

export function buildAnalysisResults(reviews: ReviewRecord[], insights: Record<string, ReviewInsight>): AnalysisResult[] {
  return reviews.map((review) => {
    const insight = insights[review.id];
    return {
      comment_id: review.id,
      raw_text: insight?.rawText || review.text,
      source: review.platform,
      vehicle_model: review.model,
      time: review.date,
      aspect: insight?.aspect || review.aspect,
      opinion: insight?.opinion || insight?.keywords?.[0] || review.subAspect,
      sentiment: insight?.sentiment || review.sentiment,
      reason: insight?.reason || review.subAspect,
      confidence: insight?.confidence ?? 0.8,
      need_review: Boolean(insight?.needReview),
      analysis_source: insight?.source || 'rule',
    };
  });
}

export function buildIssueSummary(results: AnalysisResult[], topN = 10): IssueSummary[] {
  const valid = results.filter((item) => !item.need_review && item.raw_text.trim());
  const total = valid.length || results.length || 1;
  const groups = valid.reduce<Record<string, AnalysisResult[]>>((acc, item) => {
    const issue = normalizeIssue(item);
    const key = `${item.aspect}::${issue}`;
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
  const base = Object.entries(groups).map(([key, items], index) => {
    const [aspect, issueType] = key.split('::');
    const negative = items.filter((item) => item.sentiment === 'negative').length;
    const positive = items.filter((item) => item.sentiment === 'positive').length;
    const attention = Number(((items.length / total) * 100).toFixed(1));
    const dissatisfaction = Number(((negative / items.length) * 100).toFixed(1));
    const intensity = Number(((items.reduce((sum, item) => sum + estimateIntensity(`${item.opinion} ${item.reason} ${item.raw_text}`, item.sentiment), 0) / Math.max(1, negative)) * 100).toFixed(1));
    const positiveRatio = Number(((positive / items.length) * 100).toFixed(1));
    const negativeRatio = dissatisfaction;
    return { id: `issue-${index + 1}`, name: issueType, issueType, aspect, attention, dissatisfaction, intensity, positiveRatio, negativeRatio, items };
  });
  const zA = normalizeValues(base.map((item) => item.attention));
  const zD = normalizeValues(base.map((item) => item.dissatisfaction));
  const zI = normalizeValues(base.map((item) => item.intensity));
  return base.map((item, index) => {
    const kano = classifyKano(item.aspect, item.issueType, item.positiveRatio, item.negativeRatio);
    const fda = fdaWeights.attention * zA[index] + fdaWeights.dissatisfaction * zD[index] + fdaWeights.intensity * zI[index];
    const pi = Number((fda * kanoFactor[kano] * 100).toFixed(1));
    const avgConfidence = item.items.reduce((sum, result) => sum + result.confidence, 0) / item.items.length;
    return {
      id: item.id,
      name: item.name,
      issueType: item.issueType,
      aspect: item.aspect,
      attention: item.attention,
      dissatisfaction: item.dissatisfaction,
      intensity: item.intensity,
      pi,
      kano,
      fda: Number((fda * 100).toFixed(1)),
      normalizedAttention: Number(zA[index].toFixed(3)),
      normalizedDissatisfaction: Number(zD[index].toFixed(3)),
      normalizedIntensity: Number(zI[index].toFixed(3)),
      count: item.items.length,
      positiveRatio: item.positiveRatio,
      negativeRatio: item.negativeRatio,
      avgConfidence: Number(avgConfidence.toFixed(2)),
      attribution: `由${item.items.length}条评论聚合得到，主要证据包括“${item.items[0]?.opinion || item.issueType}”，用于辅助识别${item.aspect}领域的改进优先级。`,
      typicalComments: item.items.slice(0, 3).map((result) => result.raw_text),
      evidenceResults: item.items,
    };
  }).sort((a, b) => b.pi - a.pi).slice(0, topN);
}

function keywordMatch(resultText: string, keywords: readonly string[]) {
  const hits = keywords.filter((keyword) => resultText.includes(keyword));
  if (hits.length >= 2) return { score: 1.2, hits };
  if (hits.length === 1) return { score: 1.0, hits };
  return { score: 0.8, hits: [] };
}

export function buildQfdResults(issues: IssueSummary[]) {
  const maxPi = Math.max(...issues.map((item) => item.pi), 1);
  const results: QfdResult[] = [];
  issues.forEach((issue) => {
    qfdMappings
      .filter(([issueName, aspect]) => issueName === issue.issueType || aspect === issue.aspect)
      .forEach(([qualityIssue, aspect, featureName, baseRelation, keywords, module, description], index) => {
        const text = issue.evidenceResults.map((item) => `${item.opinion} ${item.reason} ${item.raw_text}`).join(' ');
        const match = keywordMatch(text, keywords);
        const piFactor = issue.pi / maxPi;
        const relationScore = Number((baseRelation * match.score * issue.avgConfidence * piFactor).toFixed(2));
        results.push({
          issueId: issue.id,
          issueName: issue.name || qualityIssue,
          aspect,
          featureId: `ect-${featureName}`,
          featureName,
          baseRelation,
          keywordMatch: match.score,
          confidence: issue.avgConfidence || 0.8,
          piFactor: Number(piFactor.toFixed(2)),
          relationScore,
          evidenceKeywords: match.hits.length ? match.hits : [...keywords].slice(0, 3),
          module,
          description,
        });
      });
  });
  return results.filter((item) => item.relationScore > 0).sort((a, b) => b.relationScore - a.relationScore);
}

export function buildEngineeringFeatureScores(qfdResults: QfdResult[]): EngineeringFeatureScore[] {
  const grouped = qfdResults.reduce<Record<string, QfdResult[]>>((acc, item) => {
    acc[item.featureName] = acc[item.featureName] || [];
    acc[item.featureName].push(item);
    return acc;
  }, {});
  return Object.entries(grouped).map(([featureName, items], index) => ({
    id: `ect-${featureName}`,
    name: featureName,
    unit: '综合分',
    current: '-',
    target: '优先优化',
    score: Number(items.reduce((sum, item) => sum + item.relationScore, 0).toFixed(2)),
    relatedIssues: Array.from(new Set(items.map((item) => item.issueName))),
    _order: index,
  })).sort((a, b) => b.score - a.score);
}

function collaborationMethod(featureName: string) {
  const mapping = qfdMappings.find(([, , name]) => name === featureName);
  if (!mapping) return '开展联合复核、样本共享和工程参数协同优化。';
  const module = mapping[5];
  if (module === '动力电池系统') return '低温放电性能优化、电芯材料参数复核、低温测试数据共享。';
  if (module === '热管理系统') return '热泵效率优化、冷却管路参数协同、热管理标定测试。';
  if (module === '三电控制系统') return 'BMS低温策略优化、OTA标定升级、联合台架测试。';
  if (module === '智能座舱') return '算力适配、芯片负载测试、多任务性能优化。';
  if (module === '智能座舱软件') return '系统响应优化、内存管理优化、OTA修复。';
  if (module === '智能驾驶感知系统') return '传感器标定、雨雾场景数据集补充、识别阈值优化。';
  if (module === '底盘与悬架系统') return '结构参数复核、NVH测试、装配工艺优化。';
  if (module === '充电系统') return '协议兼容测试、充电桩适配、异常中断数据共享。';
  return '开展联合测试、参数复核和改进闭环跟踪。';
}

export function buildSupplyChainResults(featureScores: EngineeringFeatureScore[], qfdResults: QfdResult[]): SupplyChainResult[] {
  const recs: SupplyChainResult[] = [];
  featureScores.forEach((feature) => {
    const related = qfdResults.filter((item) => item.featureName === feature.name);
    const modules = Array.from(new Set(related.map((item) => item.module)));
    modules.forEach((module) => {
      enterpriseLibrary
        .filter((enterprise) => enterprise.module === module || enterprise.collaboration_capability.includes(module) || module.includes(enterprise.module))
        .forEach((enterprise) => {
          const roleWeight = enterprise.role_type.includes('内部') ? 1.0 : enterprise.role_type.includes('供应商') ? 1.0 : 0.7;
          const matchScore = enterprise.module === module ? 1.0 : 0.7;
          recs.push({
            enterpriseName: enterprise.enterprise_name,
            module,
            roleType: enterprise.role_type,
            score: Number((feature.score * roleWeight * matchScore).toFixed(2)),
            roleWeight,
            matchScore,
            relatedFeatures: [feature.name],
            collaborationMethod: collaborationMethod(feature.name),
            reason: `与“${feature.name}”相关，工程特征重要度为${feature.score}，适合作为${module}的潜在协同主体。`,
            profile: enterprise,
          });
        });
    });
  });
  const merged = recs.reduce<Record<string, SupplyChainResult>>((acc, item) => {
    const key = `${item.enterpriseName}-${item.module}`;
    if (!acc[key]) acc[key] = { ...item };
    else {
      acc[key].score = Number((acc[key].score + item.score).toFixed(2));
      acc[key].relatedFeatures = Array.from(new Set([...acc[key].relatedFeatures, ...item.relatedFeatures]));
    }
    return acc;
  }, {});
  return Object.values(merged).sort((a, b) => b.score - a.score);
}
