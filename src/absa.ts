import { ReviewInsight, ReviewRecord, Sentiment } from './types';

export interface AbsaResult {
  aspect: string;
  opinion: string;
  sentiment: Sentiment;
  reason: string;
}

interface AspectRule {
  aspect: string;
  subAspect: string;
  pattern: RegExp;
  keywordRules: Array<[RegExp, string]>;
  positivePattern: RegExp;
  negativePattern: RegExp;
  positiveOpinion: string;
  negativeOpinion: string;
  neutralOpinion: string;
  positiveReason: string;
  negativeReason: string;
}

const negativeWords = /不满|不好|不行|差|硬伤|太硬|慢|卡|卡顿|黑屏|异响|噪声|抖|顿挫|不给力|偏软|偏硬|不舒服|不清楚|不实用|不方便|费油|油耗高|掉电|缩水|衰减|限流|误报|投诉|可恨|反感|不好开|不稳定|没有|缺少|少了/;
const positiveWords = /满意|舒服|舒适|好看|漂亮|喜欢|省油|油耗低|性价比高|空间大|动力强|响应快|顺滑|稳定|清晰|实用|耐用|配置厚道|方便|好用|不错|棒|省心/;

export const aspectRules: AspectRule[] = [
  {
    aspect: '续航与能耗',
    subAspect: '续航/能耗表现',
    pattern: /续航|掉电|电耗|油耗|省油|费油|热泵|BMS|电池|低温|缩水|衰减/,
    keywordRules: [[/冬|低温|东北|零下/, '低温衰减'], [/续航|缩水|衰减|掉电/, '冬季续航'], [/热泵|热管理/, '热管理'], [/BMS|电池/, 'BMS策略'], [/油耗|费油|省油|电耗/, '能耗表现']],
    positivePattern: /省油|油耗低|电耗低|续航不错|续航满意|耐用/,
    negativePattern: /掉电|费油|油耗高|电耗高|缩水|衰减|续航差|续航短/,
    positiveOpinion: '能耗表现较好',
    negativeOpinion: '续航或能耗表现不佳',
    neutralOpinion: '能耗表现被提及',
    positiveReason: '用户对续航与能耗表现认可，可作为维持型体验优势继续跟踪。',
    negativeReason: '续航、能耗或低温表现未达预期，需关注热管理、能量管理与标定策略。',
  },
  {
    aspect: '智能座舱',
    subAspect: '车机交互体验',
    pattern: /车机|座舱|中控|屏|大屏|语音|HUD|导航|投屏|联网|车联网|黑屏|卡顿|SoC|手机互联/,
    keywordRules: [[/卡顿|卡|响应慢/, '车机卡顿'], [/语音/, '语音识别'], [/黑屏|死机/, '系统稳定性'], [/OTA|升级/, 'OTA'], [/屏|中控|HUD/, '显示交互']],
    positivePattern: /大屏.*棒|中控.*大方|车机.*好用|语音.*好用|互联.*无缝|响应快|清晰/,
    negativePattern: /卡顿|黑屏|不清楚|不好用|不实用|响应慢|科技感不强|没有.*车机|投屏.*卡/,
    positiveOpinion: '座舱交互体验较好',
    negativeOpinion: '车机交互或显示体验不足',
    neutralOpinion: '座舱体验被提及',
    positiveReason: '智能座舱的人机交互、显示或互联体验获得认可，可作为体验亮点保留。',
    negativeReason: '车机响应、显示清晰度、互联能力或软件稳定性存在改进空间。',
  },
  {
    aspect: '动力性能',
    subAspect: '动力响应与加速',
    pattern: /动力|加速|起步|发动机|电机|扭矩|马力|换挡|转速|小马拉大车/,
    keywordRules: [[/起步|肉|不给力|小马拉大车/, '起步动力'], [/加速|动力/, '动力响应'], [/发动机|转速|噪音/, '发动机标定'], [/换挡|顿挫/, '换挡平顺性']],
    positivePattern: /动力强|加速快|起步快|换挡顺|响应快|动力.*满意/,
    negativePattern: /动力.*不|不给力|起步肉|加速.*慢|小马拉大车|转速.*高|发动机噪音/,
    positiveOpinion: '动力响应较好',
    negativeOpinion: '动力响应不足',
    neutralOpinion: '动力表现被提及',
    positiveReason: '动力系统响应和加速体验较好，说明动力标定与用户预期匹配度较高。',
    negativeReason: '动力响应或发动机/电驱标定未满足用户预期，需关注动力总成匹配与控制策略。',
  },
  {
    aspect: '操控与底盘',
    subAspect: '操控稳定性与底盘调校',
    pattern: /操控|方向|转向|底盘|悬架|悬挂|减震|刹车|制动|侧倾|抖动|滤震|过弯/,
    keywordRules: [[/减震|悬架|悬挂|太硬|偏硬/, '减震调校'], [/底盘|滤震/, '底盘调校'], [/刹车|制动/, '制动响应'], [/方向|转向|操控/, '操控稳定性'], [/抖动|侧倾/, '车身稳定性']],
    positivePattern: /操控.*舒服|操控.*好|方向.*准|底盘.*扎实|刹车.*线性|过弯.*稳|侧倾很小/,
    negativePattern: /太硬|偏硬|抖动|顿挫|减震.*硬|底盘.*低|刹车.*误触发|不好开|侧倾/,
    positiveOpinion: '操控和底盘表现较好',
    negativeOpinion: '底盘/减震调校不足',
    neutralOpinion: '操控底盘表现被提及',
    positiveReason: '操控稳定性、转向或底盘支撑获得认可，可作为驾驶体验优势。',
    negativeReason: '底盘、悬架、减震或制动标定需复核，可能影响舒适性和驾驶信心。',
  },
  {
    aspect: '舒适性与NVH',
    subAspect: '座椅/NVH/舒适性',
    pattern: /座椅|舒服|舒适|异响|噪声|噪音|风噪|胎噪|NVH|空悬|空气悬架|振动|震动|隔音/,
    keywordRules: [[/异响|噪声|噪音/, '异响噪声'], [/风噪|胎噪|隔音/, 'NVH'], [/座椅|舒服|舒适/, '座椅舒适性'], [/空悬|空气悬架/, '空气悬架'], [/振动|震动/, '振动抑制']],
    positivePattern: /舒服|舒适|安静|隔音好|座椅.*好|NVH.*好/,
    negativePattern: /异响|噪声|噪音|风噪|胎噪|不舒服|太硬|震动|振动|挤压声|隔音差/,
    positiveOpinion: '乘坐舒适性较好',
    negativeOpinion: '舒适性或NVH不足',
    neutralOpinion: '舒适性表现被提及',
    positiveReason: '座椅、NVH或悬架舒适性获得认可，说明乘坐体验较稳定。',
    negativeReason: '座椅、悬架、NVH或装配一致性存在复核空间，影响用户感知质量。',
  },
  {
    aspect: '外观造型',
    subAspect: '造型与颜值',
    pattern: /外观|颜值|造型|车身|颜色|线条|轮毂|尾翼|漆面|设计|回头率/,
    keywordRules: [[/外观|颜值|造型|设计/, '外观造型'], [/颜色|线条|轮毂|尾翼/, '造型细节'], [/漆面|漆薄|掉漆/, '漆面质量'], [/回头率|漂亮|好看/, '视觉吸引力']],
    positivePattern: /好看|漂亮|喜欢|颜值高|霸气|时尚|大气|回头率|设计.*好/,
    negativePattern: /不好看|不喜欢|漆薄|掉漆|设计.*不|老气|不够高/,
    positiveOpinion: '外观造型受认可',
    negativeOpinion: '外观或漆面体验不足',
    neutralOpinion: '外观造型被提及',
    positiveReason: '外观造型、颜色或设计风格匹配用户审美，可作为感知质量正向因素。',
    negativeReason: '外观设计或漆面质量存在用户不满，需要关注造型细节与表面质量。',
  },
  {
    aspect: '内饰质感',
    subAspect: '内饰材料与做工',
    pattern: /内饰|做工|用料|塑料|软包|皮|储物|中控台|装配|气味|异味|档次/,
    keywordRules: [[/内饰|中控台|档次/, '内饰质感'], [/做工|装配/, '装配工艺'], [/塑料|软包|皮|用料/, '材料用料'], [/气味|异味/, '气味控制'], [/储物/, '储物设计']],
    positivePattern: /做工.*好|用料.*好|内饰.*满意|科技感.*强|储物.*多|档次.*高/,
    negativePattern: /做工.*差|塑料|太薄|单调|异味|气味|档次低|硬塑料|反感/,
    positiveOpinion: '内饰质感较好',
    negativeOpinion: '内饰材料或做工不足',
    neutralOpinion: '内饰质感被提及',
    positiveReason: '内饰材料、做工或储物设计获得认可，可作为体验保持项。',
    negativeReason: '内饰材料、装配工艺或气味控制影响感知质量，需要供应链与工艺协同优化。',
  },
  {
    aspect: '空间表现',
    subAspect: '乘坐与储物空间',
    pattern: /空间|后排|前排|乘坐|储物|后备箱|轴距|车内空间|杯座/,
    keywordRules: [[/空间|车内空间|轴距/, '乘坐空间'], [/后排|前排|乘坐/, '座舱空间'], [/储物|杯座/, '储物空间'], [/后备箱/, '后备箱空间']],
    positivePattern: /空间大|后排.*大|储物.*多|乘坐.*舒服|适合家用/,
    negativePattern: /空间小|后排.*不能|后备箱.*小|储物.*小|不方便/,
    positiveOpinion: '空间表现较好',
    negativeOpinion: '空间或储物便利性不足',
    neutralOpinion: '空间表现被提及',
    positiveReason: '乘坐空间或储物空间满足用户需求，是典型期望型体验优势。',
    negativeReason: '空间布局或储物便利性未达预期，需要关注车身布置与人机工程设计。',
  },
  {
    aspect: '充电体验',
    subAspect: '补能效率与兼容性',
    pattern: /充电|快充|慢充|补能|充电桩|限流|充电口|电费/,
    keywordRules: [[/快充|慢充|充电.*慢|充电.*快/, '充电速度'], [/限流/, '快充限流'], [/充电桩|兼容/, '充电兼容性'], [/充电口|不顺手/, '充电便利性'], [/电费/, '补能成本']],
    positivePattern: /充电.*快|快充.*快|充电.*实用|省.*电费|兼容性好/,
    negativePattern: /充电.*慢|限流|兼容性差|不方便|充电口.*不顺手/,
    positiveOpinion: '充电体验较好',
    negativeOpinion: '充电效率或便利性不足',
    neutralOpinion: '充电体验被提及',
    positiveReason: '补能便利性或充电效率获得认可，可作为服务体验优势。',
    negativeReason: '充电协议、BMS充电策略、热管理或服务体验存在协同改进空间。',
  },
  {
    aspect: '智能驾驶',
    subAspect: '辅助驾驶与感知控制',
    pattern: /智驾|辅助驾驶|自动驾驶|雷达|摄像头|预警|误报|制动|刹停|识别|感知/,
    keywordRules: [[/误报|误触发/, '误报'], [/雷达|摄像头|感知|识别/, '感知识别'], [/辅助驾驶|自动驾驶|智驾/, '辅助驾驶'], [/制动|刹停/, '控制介入'], [/预警/, '安全预警']],
    positivePattern: /预警.*好用|辅助驾驶.*好|识别.*准|安全配置.*好/,
    negativePattern: /误报|不清楚|退出|突兀|误触发|识别.*差|摄像头.*不清楚/,
    positiveOpinion: '智能驾驶体验较好',
    negativeOpinion: '感知或控制稳定性不足',
    neutralOpinion: '智能驾驶体验被提及',
    positiveReason: '辅助驾驶或安全预警体验获得认可，可作为智能化体验亮点。',
    negativeReason: '感知识别、融合算法或控制策略需要联合标定，避免异常预警和突兀介入。',
  },
  {
    aspect: '安全配置',
    subAspect: '安全与配置完整性',
    pattern: /安全|配置|气囊|雷达|倒车雷达|全景|摄像头|ESP|刹车|预警/,
    keywordRules: [[/配置|缺少|少了/, '配置完整性'], [/倒车雷达|雷达|摄像头|全景/, '感知配置'], [/安全|气囊|ESP/, '安全配置'], [/刹车|预警/, '主动安全']],
    positivePattern: /配置.*丰富|安全配置.*好|预警.*好用|倒车雷达.*好/,
    negativePattern: /没有.*雷达|配置.*少|摄像头不清楚|缺少|安全.*不足/,
    positiveOpinion: '安全配置较完整',
    negativeOpinion: '安全配置或感知配置不足',
    neutralOpinion: '安全配置被提及',
    positiveReason: '安全配置满足用户预期，有助于提升基础质量感知。',
    negativeReason: '安全配置缺失或感知硬件体验不足，可能引发基本型需求不满。',
  },
  {
    aspect: '售后服务与交付',
    subAspect: '售后服务体验',
    pattern: /售后|4S|服务|交付|保养|维修|态度|客服|门店/,
    keywordRules: [[/售后|服务|客服/, '售后服务'], [/4S|门店/, '服务网络'], [/保养|维修/, '保养维修'], [/态度|耐心/, '服务态度'], [/交付/, '交付体验']],
    positivePattern: /售后.*好|服务.*好|态度.*好|耐心|交付.*顺利/,
    negativePattern: /售后不好|4s店不全|态度.*差|保养.*麻烦|服务.*不/,
    positiveOpinion: '售后服务体验较好',
    negativeOpinion: '售后服务体验不足',
    neutralOpinion: '售后服务被提及',
    positiveReason: '售后响应和服务态度获得认可，有助于维持用户信任。',
    negativeReason: '售后网络、服务态度或保养便利性影响体验，需要服务体系协同改进。',
  },
  {
    aspect: '价格与性价比',
    subAspect: '价格价值感知',
    pattern: /价格|价位|性价比|便宜|贵|配置厚道|值得|划算/,
    keywordRules: [[/性价比|划算|值得/, '性价比'], [/价格|价位|贵|便宜/, '价格感知'], [/配置厚道/, '配置价值']],
    positivePattern: /性价比高|性价比合适|便宜|配置厚道|划算|值得/,
    negativePattern: /贵|不值|性价比低|买不到|价格.*高/,
    positiveOpinion: '性价比表现较好',
    negativeOpinion: '价格价值感不足',
    neutralOpinion: '价格价值被提及',
    positiveReason: '价格、配置和体验之间的价值感较强，是用户满意的重要来源。',
    negativeReason: '价格与配置或体验预期不匹配，需要关注配置策略与价值沟通。',
  },
];

export function inferSentimentFromText(text: string): Sentiment {
  const negativeCount = (text.match(negativeWords) || []).length;
  const positiveCount = (text.match(positiveWords) || []).length;
  if (negativeCount > positiveCount) return 'negative';
  if (positiveCount > negativeCount) return 'positive';
  return 'neutral';
}

function extractKeywords(text: string, rule?: AspectRule) {
  if (!rule) return ['需人工复核'];
  const matched = rule.keywordRules.filter(([pattern]) => pattern.test(text)).map(([, keyword]) => keyword);
  return Array.from(new Set(matched)).slice(0, 4);
}

export function extractAbsa(text: string, fallbackSentiment?: Sentiment): AbsaResult {
  const normalized = text.trim();
  const sentiment = fallbackSentiment && fallbackSentiment !== 'neutral' ? fallbackSentiment : inferSentimentFromText(normalized);
  const matched = aspectRules.find((rule) => rule.pattern.test(normalized));
  if (!matched) {
    return {
      aspect: '综合体验',
      opinion: normalized.length > 16 ? `${normalized.slice(0, 16)}...` : normalized || '未识别观点',
      sentiment,
      reason: '缺少明确质量关键词，建议结合人工标注或专家复核进一步确认。',
    };
  }

  const opinion =
    sentiment === 'positive'
      ? matched.positivePattern.test(normalized)
        ? matched.positiveOpinion
        : matched.neutralOpinion
      : sentiment === 'negative'
        ? matched.negativePattern.test(normalized)
          ? matched.negativeOpinion
          : matched.neutralOpinion
        : matched.neutralOpinion;

  return {
    aspect: matched.aspect,
    opinion,
    sentiment,
    reason: sentiment === 'negative' ? matched.negativeReason : sentiment === 'positive' ? matched.positiveReason : '该评论提到了相关体验维度，但情感强度较弱，可作为持续监测样本。',
  };
}

export function extractReviewInsight(review: ReviewRecord): ReviewInsight {
  const result = extractAbsa(review.text, review.sentiment);
  const rule = aspectRules.find((item) => item.aspect === result.aspect);
  return {
    id: review.id,
    rawText: review.text,
    aspect: result.aspect,
    sentiment: result.sentiment,
    keywords: extractKeywords(review.text, rule),
    reason: result.reason,
    model: review.model,
    platform: review.platform,
    date: review.date,
  };
}

export function inferAspectFromText(text: string) {
  const result = extractAbsa(text);
  const rule = aspectRules.find((item) => item.aspect === result.aspect);
  return {
    aspect: result.aspect,
    subAspect: rule?.subAspect || result.opinion,
  };
}
