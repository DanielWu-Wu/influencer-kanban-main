import { NextRequest, NextResponse } from 'next/server';
import { getUserSecret } from '@/lib/user-private-storage';
import { getRequestUser } from '@/lib/supabase/server';

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
    temperature: options.temperature ?? 0.3,
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
    const body = await request.json();
    const {
      text,
      sourceLang,
      customPrompt,
      modelProvider,
      customApiUrl,
      customModelName,
    } = body;
    let { customApiKey } = body;

    if (modelProvider === 'custom' && !customApiKey) {
      const appAuth = await getRequestUser(request);
      if (appAuth) {
        customApiKey =
          await getUserSecret<string>(appAuth.supabase, 'ai_api_key') || '';
      }
    }

    if (!text) {
      return NextResponse.json({ error: '缺少翻译文本。' }, { status: 400 });
    }

    const langHint = sourceLang ? `源语言可能是 ${sourceLang}。` : '';
    const defaultPrompt = `你是一位专业翻译助手。请将用户提供的文本翻译成中文。${langHint}只返回翻译结果，不要添加解释或额外内容，并尽量保持原文段落结构。`;
    const systemPrompt = customPrompt
      ? customPrompt.replace('{langHint}', langHint)
      : defaultPrompt;

    const content = await invokeOpenAICompatibleApi(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      {
        apiUrl: modelProvider === 'custom' ? customApiUrl : undefined,
        apiKey: modelProvider === 'custom' ? customApiKey : undefined,
        modelName: modelProvider === 'custom' ? customModelName : undefined,
        temperature: 0.3,
      },
    );

    return NextResponse.json({
      success: true,
      data: {
        translatedText: content.trim(),
        sourceLang: sourceLang || 'auto',
        targetLang: 'zh',
      },
    });
  } catch (error) {
    console.error('翻译失败:', error);
    const errorMessage =
      error instanceof Error ? error.message : '翻译失败，请稍后重试。';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
