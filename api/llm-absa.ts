const aspects = '外观造型、内饰质感、空间表现、动力性能、续航与能耗、充电体验、智能座舱、智能驾驶、操控与底盘、舒适性与NVH、安全配置、售后服务与交付、其他';

interface ApiRequest {
  method?: string;
  body?: {
    commentText?: string;
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

  const { commentText, config } = req.body || {};
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

  const systemPrompt = '你是新能源汽车感知质量分析助手。你的任务是对用户评论进行方面级情感分析。请严格根据评论文本判断，不要编造不存在的信息。输出必须是合法JSON。';
  const userPrompt = `请分析以下新能源汽车用户评论，并输出方面级情感分析结果。

评论文本：
${commentText}

分析要求：
1. 识别评论涉及的主要方面类别。
2. 提取对应观点词或观点短语。
3. 判断情感方向：正面、中性、负面。
4. 用一句话说明情感归因。
5. 给出置信度，范围0到1。
6. 判断是否需要人工复核。

方面类别只能从以下列表中选择：
${aspects}。

输出JSON格式如下：
{
  "aspect": "",
  "opinion": "",
  "sentiment": "",
  "reason": "",
  "confidence": 0.0,
  "need_review": false
}

判定规则：
- 如果评论涉及多个方面，选择最主要的方面。
- 如果情感不明确，sentiment填“中性”，confidence低于0.6，need_review为true。
- 如果评论过短、乱码、无意义，aspect填“其他”，sentiment填“中性”，need_review为true。
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
