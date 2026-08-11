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

type ProviderTiming = {
  providerHeadersMs: number;
  providerBodyMs: number;
  firstDeltaMs: number | null;
  streamed: boolean;
  modelName: string;
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

function parseProviderContent(rawText: string) {
  const data = JSON.parse(rawText);
  const content = data?.choices?.[0]?.message?.content ?? data?.content;
  if (typeof content !== 'string') throw new Error('无法解析 AI API 返回的数据。');
  return content;
}

async function invokeOpenAICompatibleApi(
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<{ content: string; timing: ProviderTiming }> {
  const { apiUrl, apiKey, modelName, temperature } = resolveChatOptions(options);
  const startedAt = performance.now();
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
  const headersAt = performance.now();
  const rawText = await response.text();
  const completedAt = performance.now();

  if (!response.ok) {
    throw new Error(`AI API 调用失败 (${response.status}): ${rawText}`);
  }

  return {
    content: parseProviderContent(rawText),
    timing: {
      providerHeadersMs: Math.round(headersAt - startedAt),
      providerBodyMs: Math.round(completedAt - headersAt),
      firstDeltaMs: null,
      streamed: false,
      modelName,
    },
  };
}

async function streamOpenAICompatibleApi(
  messages: ChatMessage[],
  options: ChatOptions,
  onDelta: (delta: string) => void,
): Promise<{ content: string; timing: ProviderTiming }> {
  const { apiUrl, apiKey, modelName, temperature } = resolveChatOptions(options);
  const startedAt = performance.now();
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
      stream: true,
    }),
  });
  const headersAt = performance.now();

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API 调用失败 (${response.status}): ${errorText}`);
  }
  if (!response.body) throw new Error('模型接口没有返回可读取的流。');

  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (contentType.includes('application/json')) {
    const rawText = await response.text();
    const completedAt = performance.now();
    const content = parseProviderContent(rawText);
    onDelta(content);
    return {
      content,
      timing: {
        providerHeadersMs: Math.round(headersAt - startedAt),
        providerBodyMs: Math.round(completedAt - headersAt),
        firstDeltaMs: Math.round(completedAt - startedAt),
        streamed: false,
        modelName,
      },
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let firstDeltaAt = 0;

  const readChunk = (chunk: string) => {
    const lines = chunk.split(/\r?\n/).filter((line) => line.startsWith('data:'));
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, '').trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const data = JSON.parse(payload);
        const delta = data?.choices?.[0]?.delta?.content ?? data?.choices?.[0]?.text ?? '';
        if (typeof delta === 'string' && delta) {
          if (!firstDeltaAt) firstDeltaAt = performance.now();
          fullText += delta;
          onDelta(delta);
        }
      } catch {
        // Provider keepalive or malformed chunks should not interrupt valid deltas.
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() || '';
    chunks.forEach(readChunk);
  }
  buffer += decoder.decode();
  if (buffer.trim()) readChunk(buffer);

  const completedAt = performance.now();
  if (!fullText.trim()) throw new Error('模型接口没有返回可用的流式译文。');
  return {
    content: fullText,
    timing: {
      providerHeadersMs: Math.round(headersAt - startedAt),
      providerBodyMs: Math.round(completedAt - headersAt),
      firstDeltaMs: firstDeltaAt ? Math.round(firstDeltaAt - startedAt) : null,
      streamed: true,
      modelName,
    },
  };
}

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const requestStartedAt = performance.now();
  const authStartedAt = performance.now();
  const appAuth = await getRequestUser(request);
  const authMs = Math.round(performance.now() - authStartedAt);
  if (!appAuth) {
    return NextResponse.json({ error: '未登录或账号无权使用翻译。' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      text,
      sourceLang,
      customPrompt,
      modelProvider,
      customApiUrl,
      customModelName,
      stream,
    } = body;
    let { customApiKey } = body;
    let secretMs = 0;

    if (modelProvider === 'custom' && !customApiKey) {
      const secretStartedAt = performance.now();
      customApiKey = await getUserSecret<string>(appAuth.supabase, 'ai_api_key') || '';
      secretMs = Math.round(performance.now() - secretStartedAt);
    }

    if (!text) {
      return NextResponse.json({ error: '缺少翻译文本。' }, { status: 400 });
    }

    const langHint = sourceLang ? `源语言可能是 ${sourceLang}。` : '';
    const defaultPrompt = `你是一位专业翻译助手。请将用户提供的文本翻译成中文。${langHint}只返回翻译结果，不要添加解释或额外内容，并尽量保持原文段落结构。`;
    const systemPrompt = customPrompt
      ? customPrompt.replace('{langHint}', langHint)
      : defaultPrompt;
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ];
    const modelOptions: ChatOptions = {
      apiUrl: modelProvider === 'custom' ? customApiUrl : undefined,
      apiKey: modelProvider === 'custom' ? customApiKey : undefined,
      modelName: modelProvider === 'custom' ? customModelName : undefined,
      temperature: 0.3,
    };

    if (stream === true) {
      const encoder = new TextEncoder();
      const responseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(sseEvent(event, data)));
          };
          try {
            send('stage', { stage: 'streaming', label: '正在翻译' });
            const result = await streamOpenAICompatibleApi(messages, modelOptions, (delta) => {
              send('delta', { text: delta });
            });
            const totalMs = Math.round(performance.now() - requestStartedAt);
            const metrics = {
              authMs,
              secretMs,
              ...result.timing,
              totalMs,
              inputCharacters: String(text).length,
            };
            console.info('[Email translation timing]', metrics);
            send('final', {
              translatedText: result.content.trim(),
              sourceLang: sourceLang || 'auto',
              targetLang: 'zh',
            });
            send('metrics', metrics);
          } catch (error) {
            console.error('翻译失败:', error);
            send('error', {
              message: error instanceof Error ? error.message : '翻译失败，请稍后重试。',
            });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(responseStream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    const result = await invokeOpenAICompatibleApi(messages, modelOptions);
    const totalMs = Math.round(performance.now() - requestStartedAt);
    console.info('[Email translation timing]', {
      authMs,
      secretMs,
      ...result.timing,
      totalMs,
      inputCharacters: String(text).length,
    });
    return NextResponse.json({
      success: true,
      data: {
        translatedText: result.content.trim(),
        sourceLang: sourceLang || 'auto',
        targetLang: 'zh',
      },
    });
  } catch (error) {
    console.error('翻译失败:', error);
    const errorMessage = error instanceof Error ? error.message : '翻译失败，请稍后重试。';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
