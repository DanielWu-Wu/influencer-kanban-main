import { NextRequest } from 'next/server';
import { DEFAULT_OUTREACH_PROMPT } from '@/lib/ai-prompts';
import { getRequestUser } from '@/lib/supabase/server';
import { getUserSecret } from '@/lib/user-private-storage';

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
    throw new Error('缺少模型 API Key。请先在设置或环境变量中配置。');
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
    temperature: options.temperature ?? 0.4,
  };
}

function getModelOptions(body: Record<string, unknown>, temperature: number): ChatOptions {
  return {
    apiUrl: body.modelProvider === 'custom' ? String(body.customApiUrl || '') : undefined,
    apiKey: body.modelProvider === 'custom' ? String(body.customApiKey || '') : undefined,
    modelName: body.modelProvider === 'custom' ? String(body.customModelName || '') : undefined,
    temperature,
  };
}

async function hydrateSecrets(request: NextRequest, body: Record<string, unknown>) {
  if (body.modelProvider === 'custom' && !body.customApiKey) {
    const appAuth = await getRequestUser(request);
    if (appAuth) {
      body.customApiKey = await getUserSecret<string>(appAuth.supabase, 'ai_api_key') || '';
    }
  }
}

function withCustomInstructions(basePrompt: string, customPrompt: unknown) {
  const custom = String(customPrompt || '').trim();
  if (!custom || custom === DEFAULT_OUTREACH_PROMPT.trim()) return basePrompt;
  return `${basePrompt}

以下是用户在设置中配置的专属要求，请在不违反事实准确性和格式要求的前提下优先遵守：
${custom}`;
}

function parseJson(content: string) {
  const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('模型未返回有效 JSON。');
  return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function removeOutreachSignaturePlaceholders(value: unknown) {
  return String(value || '')
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = line.trim().toLowerCase();
      if (!normalized) return true;
      const mentionsSignature = ['signature', 'signatur', '签名', '署名'].some((keyword) => normalized.includes(keyword));
      const mentionsSystemInstruction = ['system', '自动', 'placeholder', '占位'].some((keyword) => normalized.includes(keyword));
      return !(mentionsSignature && mentionsSystemInstruction);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function invokeOpenAICompatibleApi(messages: ChatMessage[], options: ChatOptions) {
  const { apiUrl, apiKey, modelName, temperature } = resolveChatOptions(options);
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: modelName, messages, temperature }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`模型调用失败 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? data?.content;
  if (typeof content !== 'string') throw new Error('无法解析模型返回的数据。');
  return content;
}

async function streamOpenAICompatibleApi(
  messages: ChatMessage[],
  options: ChatOptions,
  onDelta: (delta: string) => void,
) {
  const { apiUrl, apiKey, modelName, temperature } = resolveChatOptions(options);
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: modelName, messages, temperature, stream: true }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`模型流式调用失败 (${response.status}): ${errorText}`);
  }
  if (!response.body) throw new Error('模型接口没有返回可读取的流。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const lines = chunk.split(/\r?\n/).filter((line) => line.startsWith('data:'));
      for (const line of lines) {
        const payload = line.replace(/^data:\s*/, '').trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const data = JSON.parse(payload);
          const delta = data?.choices?.[0]?.delta?.content ?? data?.choices?.[0]?.text ?? '';
          if (typeof delta === 'string' && delta) {
            fullText += delta;
            onDelta(delta);
          }
        } catch {
          // Ignore provider keepalive or non-JSON stream lines.
        }
      }
    }
  }

  return fullText.trim();
}

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function buildContextSummary(body: Record<string, unknown>) {
  return JSON.stringify({
    channel: body.channel || {},
    recentVideos: body.recentVideos || [],
    products: body.products || [],
    targetProduct: body.targetProduct || '',
    cooperationType: body.cooperationType || '',
    cooperationIdea: body.cooperationIdea || '',
    priority: body.priority || '',
    brandName: body.brandName || '',
    senderName: body.senderName || '',
    preferredLanguage: body.preferredLanguage || '',
    userPreference: body.userPreference || '',
  }, null, 2);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  await hydrateSecrets(request, body);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        const channel = (body.channel || {}) as { title?: string; url?: string };
        if (!channel.title && !channel.url) {
          throw new Error('缺少 YouTube 频道资料，无法生成开发信。');
        }

        const contextSummary = buildContextSummary(body);
        const modelOptions = getModelOptions(body, 0.55);
        const bodySystemPrompt = withCustomInstructions(
          `${DEFAULT_OUTREACH_PROMPT}

你正在为海外红人推广专员撰写首封开发信正文。
只输出目标语言的邮件正文，不要输出 JSON，不要输出标题，不要输出中文翻译，不要输出签名块。
正文需要自然、礼貌、具体，结合频道资料、目标产品、合作形式和合作想法。
不要编造未提供的产品参数、价格、库存、认证、安全结论或发货承诺。
如果有联系人姓名，可以自然称呼；没有联系人姓名时，不要猜测人名。`,
          body.outreachPrompt,
        );

        send('stage', { stage: 'streaming_body', label: '正在生成正文' });
        const streamedBody = removeOutreachSignaturePlaceholders(await streamOpenAICompatibleApi(
          [
            { role: 'system', content: bodySystemPrompt },
            { role: 'user', content: `请根据以下资料撰写开发信正文：\n${contextSummary}` },
          ],
          modelOptions,
          (delta) => send('delta', { text: delta }),
        ));

        send('stage', { stage: 'finalizing', label: '正在整理标题和中文翻译' });
        const finalPrompt = `请基于以下已经生成的开发信正文，补齐邮件标题、中文翻译、个性化依据和风险提醒。
只返回严格 JSON，不要 Markdown，不要解释。

已生成正文：
${streamedBody}

原始业务资料：
${contextSummary}

返回格式：
{
  "subject": "邮件主题",
  "subjectOptions": [
    {"subject": "备选主题1，使用目标语言", "translatedSubject": "备选主题1的中文翻译"},
    {"subject": "备选主题2，使用目标语言", "translatedSubject": "备选主题2的中文翻译"},
    {"subject": "备选主题3，使用目标语言", "translatedSubject": "备选主题3的中文翻译"}
  ],
  "translatedBody": "外语邮件正文的完整中文翻译",
  "translatedSummary": "中文解释，包括邮件意图和主要内容",
  "personalizationNotes": ["使用了哪些频道资料做个性化"],
  "riskNotes": ["保存草稿或发送前需要人工核对的事实和风险"],
  "missingInfo": ["仍然缺少哪些信息"],
  "language": "目标语言 ISO 639-1 代码",
  "tone": "professional"
}`;

        const metadata = parseJson(await invokeOpenAICompatibleApi(
          [
            { role: 'system', content: '你是严谨的邮件草稿整理助手，只返回严格 JSON。' },
            { role: 'user', content: finalPrompt },
          ],
          getModelOptions(body, 0.25),
        ));

        const subject = String(metadata.subject || '').trim();
        const subjectOptions = safeArray(metadata.subjectOptions)
          .map((item) => {
            const option = item as Record<string, unknown>;
            return {
              subject: String(option.subject || '').trim(),
              translatedSubject: String(option.translatedSubject || '').trim(),
            };
          })
          .filter((item) => item.subject)
          .slice(0, 3);
        if (!subjectOptions.length && subject) {
          subjectOptions.push({ subject, translatedSubject: '' });
        }

        const finalDraft = {
          ...metadata,
          subject: subjectOptions.some((item) => item.subject === subject)
            ? subject
            : subjectOptions[0]?.subject || subject,
          subjectOptions,
          body: streamedBody,
          translatedBody: removeOutreachSignaturePlaceholders(metadata.translatedBody),
        };

        send('final', finalDraft);
        controller.close();
      } catch (error) {
        send('error', { message: error instanceof Error ? error.message : '开发信流式生成失败。' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
