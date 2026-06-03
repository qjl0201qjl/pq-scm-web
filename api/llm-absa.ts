const aspects = '外观造型、内饰质感、空间表现、动力性能、续航与能耗、充电体验、智能座舱、智能驾驶、操控与底盘、舒适性与NVH、安全配置、售后服务与交付、其他';

interface ApiRequest {
  method?: string;
  body?: {
    commentText?: string;
    candidateAspect?: string;
    config?: Record<string, unknown>;
  };
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
}

function getApiKey(provider?: string) {
  if (provider === 'Qwen') return process.env.QWEN_API_KEY || process.env.OPENAI_API_KEY || '';
  if (provider === 'OpenAI compatible') return process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  if (provider === 'Custom') return process.env.CUSTOM_LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  return process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { commentText, candidateAspect, config } = req.body || {};
  if (!commentText || !config) {
    res.status(400).json({ error: 'Missing commentText or config' });
    return;
  }

  const apiKey = getApiKey(config.provider);
  if (!apiKey) {
    res.status(500).json({ error: 'Missing API key. Please set DEEPSEEK_API_KEY, OPENAI_API_KEY, QWEN_API_KEY, or CUSTOM_LLM_API_KEY.' });
    return;
  }

  const baseUrl = String(config.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = String(config.modelName || 'deepseek-chat');

  const candidateLine = candidateAspect && candidateAspect !== '综合体验' ? `\n规则ABSA候选方面：${candidateAspect}\n请结合候选方面和评论原文判断最终结果；如果候选方面与原文不符，以原文为准。\n` : '';
  const systemPrompt = '你是新能源汽车感知质量方面级情感分析专家。你的任务是根据用户评论识别其涉及的质量方面、观点词、情感方向和归因原因。请严格依据评论内容分析，不要使用模板化解释，不要编造评论中不存在的信息。只输出合法 JSON。';
  const userPrompt = `请对以下新能源汽车用户评论进行方面级情感分析。

评论文本：
${commentText}
${candidateLine}
请完成以下任务：
1. 判断评论主要涉及哪个感知质量方面。
2. 提取最核心的观点词或观点短语。
3. 判断情感方向：正面、中性、负面。
4. 用一句话说明原因，原因必须来自评论文本。
5. 给出置信度，范围0到1。
6. 判断是否需要人工复核。

方面类别必须从以下列表选择：
${aspects.split('、').join('\n')}

输出 JSON：
{
  "aspect": "",
  "opinion": "",
  "sentiment": "",
  "reason": "",
  "confidence": 0.0,
  "need_review": false
}

判定规则：
- 出现“续航、掉电、电耗、里程、BMS、热泵、低温、冬天”等，优先考虑“续航与能耗”。
- 出现“车机、中控屏、语音、系统、OTA、卡顿、黑屏、死机”等，优先考虑“智能座舱”。
- 出现“智驾、辅助驾驶、自动泊车、AEB、雷达、误报”等，优先考虑“智能驾驶”。
- 出现“座椅、腰疼、悬架、风噪、胎噪、异响、NVH”等，优先考虑“舒适性与NVH”。
- 出现“充电、快充、慢充、充电桩、兼容、中断”等，优先考虑“充电体验”。
- 如果评论非常短但有明确情感，也必须尽量判断，不要直接归为“其他”。
- 只有在文本乱码、无意义、完全无法判断时，才输出 aspect="其他"。
- need_review 只有在 confidence < 0.65 或文本乱码时才为 true。
- 不允许统一输出“缺少明确质量关键词”。
- 不允许统一输出“该评论反映了用户体验与工程质量特征之间的潜在对应关系”。
- 不要输出解释文字，只输出JSON。`;

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: Number(config.temperature ?? 0.2),
        max_tokens: Number(config.maxTokens ?? 500),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: data });
      return;
    }
    res.status(200).json({ content: data.choices?.[0]?.message?.content || data });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
