import { NextRequest, NextResponse } from 'next/server';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ChatOptions = {
  apiUrl?: string;
  apiKey?: string;
  modelName?: string;
  temperature?: number;
};

function resolveChatOptions(options: ChatOptions): Required<ChatOptions> {
  const apiKey =
    options.apiKey ||
    process.env.AI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      '缺少 AI API Key。请在设置中配置自定义 OpenAI 兼容 API，或在环境变量中设置 AI_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY。',
    );
  }

  return {
    apiUrl:
      options.apiUrl ||
      process.env.AI_API_URL ||
      process.env.DEEPSEEK_API_URL ||
      'https://api.deepseek.com/chat/completions',
    apiKey,
    modelName:
      options.modelName ||
      process.env.AI_MODEL ||
      process.env.DEEPSEEK_MODEL ||
      'deepseek-chat',
    temperature: options.temperature ?? 0.7,
  };
}

async function invokeOpenAICompatibleApi(
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<string> {
  const { apiUrl, apiKey, modelName, temperature } = resolveChatOptions(options);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API 调用失败 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? data?.content;

  if (typeof content !== 'string') {
    throw new Error('无法解析 AI API 返回的数据。');
  }

  return content;
}

export async function POST(request: NextRequest) {
  try {
    const {
      threadSubject,
      lastMessage,
      userIdeas,
      targetLang = 'en',
      customPrompt,
      modelProvider,
      customApiUrl,
      customApiKey,
      customModelName,
    } = await request.json();

    if (!lastMessage || !userIdeas) {
      return NextResponse.json({ error: '缺少必要参数。' }, { status: 400 });
    }

    const langNames: Record<string, string> = {
      en: '英语',
      zh: '中文',
      ja: '日语',
      de: '德语',
      fr: '法语',
      es: '西班牙语',
      it: '意大利语',
      ru: '俄语',
      ar: '阿拉伯语',
      pt: '葡萄牙语',
      nl: '荷兰语',
      sv: '瑞典语',
      pl: '波兰语',
      da: '丹麦语',
      no: '挪威语',
      fi: '芬兰语',
      cs: '捷克语',
      el: '希腊语',
      tr: '土耳其语',
    };

    const targetLangName = langNames[targetLang] || '英语';
    const defaultPrompt = `你是一位专业的跨境电商红人推广邮件助手。请根据用户提供的上下文和回复想法，撰写一封专业、友好、适合商务沟通的${targetLangName}邮件，并提供中文翻译。

请严格返回 JSON，不要添加额外说明：
{
  "suggestedReply": "使用${targetLangName}撰写的邮件回复",
  "translatedReply": "上述邮件的中文翻译",
  "tone": "friendly",
  "keyPoints": ["要点1", "要点2"]
}`;

    const systemPrompt = customPrompt
      ? customPrompt.replace(/{targetLangName}/g, targetLangName)
      : defaultPrompt;

    const userPrompt = `邮件主题：${threadSubject || '无主题'}

对方最近一封邮件内容：
${lastMessage}

我的回复想法（中文）：
${userIdeas}

请根据以上信息撰写邮件，并附上中文翻译。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const content = await invokeOpenAICompatibleApi(messages, {
      apiUrl: modelProvider === 'custom' ? customApiUrl : undefined,
      apiKey: modelProvider === 'custom' ? customApiKey : undefined,
      modelName: modelProvider === 'custom' ? customModelName : undefined,
      temperature: 0.7,
    });

    let result;
    try {
      const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI 未返回 JSON。');
      }
      result = JSON.parse(jsonMatch[0]);
    } catch {
      result = {
        suggestedReply: content,
        translatedReply: 'AI 返回格式不是标准 JSON，请检查原文。',
        tone: 'friendly',
        keyPoints: String(userIdeas)
          .split(/[。！？；\n]/)
          .map((point) => point.trim())
          .filter(Boolean),
      };
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('AI 邮件生成失败:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'AI 邮件生成失败，请稍后重试。';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
