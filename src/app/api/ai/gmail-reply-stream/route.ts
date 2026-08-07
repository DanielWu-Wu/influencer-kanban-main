import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_DRAFT_PROMPT } from '@/lib/ai-prompts';
import {
  buildCompactGmailAIConversation,
  selectRelevantGmailAIDraftMessages,
  type GmailAIHistoryMessage,
} from '@/lib/gmail-ai-reply';
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
    options.apiKey
    || process.env.AI_API_KEY
    || process.env.DEEPSEEK_API_KEY
    || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 AI API Key。请先在网站设置或 Vercel 环境变量中配置 AI_API_KEY。');
  }

  return {
    apiUrl:
      options.apiUrl
      || process.env.AI_API_URL
      || process.env.DEEPSEEK_API_URL
      || 'https://api.deepseek.com/chat/completions',
    apiKey,
    modelName:
      options.modelName
      || process.env.AI_MODEL
      || process.env.DEEPSEEK_MODEL
      || 'deepseek-chat',
    temperature: options.temperature ?? 0.4,
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

function getModelOptions(body: Record<string, unknown>, temperature: number): ChatOptions {
  return {
    apiUrl: body.modelProvider === 'custom' ? String(body.customApiUrl || '') : undefined,
    apiKey: body.modelProvider === 'custom' ? String(body.customApiKey || '') : undefined,
    modelName: body.modelProvider === 'custom' ? String(body.customModelName || '') : undefined,
    temperature,
  };
}

function withCustomInstructions(basePrompt: string, customPrompt: unknown) {
  const custom = String(customPrompt || '').trim();
  if (!custom || custom === DEFAULT_DRAFT_PROMPT.trim()) return basePrompt;
  return `${basePrompt}

以下是用户在设置中配置的专属要求。请在不违反事实准确性、目标语言和输出格式要求的前提下优先遵守：
--- 用户专属提示词 ---
${custom}
--- 用户专属提示词结束 ---`;
}

async function invokeOpenAICompatibleApi(
  messages: ChatMessage[],
  options: ChatOptions,
) {
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
  if (response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('当前模型接口未启用流式响应。');
  }

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
          // Ignore provider keepalive or malformed chunks and continue reading.
        }
      }
    }
  }

  return fullText.trim();
}

function parseJson(content: string) {
  const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 未返回有效 JSON。');
  return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
}

function safeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  if (!(await getRequestUser(request))) return NextResponse.json({ error: '未登录或账号无权使用 AI。' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  await hydrateSecrets(request, body);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        const threadMessages = Array.isArray(body.threadMessages)
          ? body.threadMessages as GmailAIHistoryMessage[]
          : [];
        const userIdeas = String(body.userIdeas || '').trim();
        const threadSubject = String(body.threadSubject || '');
        const targetLang = String(body.targetLang || 'en');
        const targetLangName = String(body.targetLangName || targetLang);
        const requestedTone = String(body.replyTone || 'friendly');
        const replyTone = ['friendly', 'formal', 'casual'].includes(requestedTone)
          ? requestedTone
          : 'friendly';
        const replyToneName = replyTone === 'formal'
          ? '正式专业'
          : replyTone === 'casual'
            ? '轻松亲切'
            : '自然友好';

        if (!userIdeas || threadMessages.length === 0) {
          throw new Error('缺少邮件历史或你的回复想法。');
        }

        const selectedMessages = selectRelevantGmailAIDraftMessages(
          threadMessages,
          String(body.gmailAccountEmail || ''),
        );
        const conversation = buildCompactGmailAIConversation(selectedMessages);
        const analysis = body.analysis || {};
        const modelOptions = getModelOptions(body, 0.55);
        const startedAt = performance.now();
        let firstDeltaAt = 0;

        const bodySystemPrompt = withCustomInstructions(
          `${DEFAULT_DRAFT_PROMPT}

本次只生成目标语言的邮件正文。
目标语言：${targetLangName}
目标语气：${replyToneName}
只输出不含签名的完整邮件正文，不要输出 JSON、中文翻译、标题、分析、Markdown 或额外说明。`,
          body.draftPrompt,
        );
        const bodyUserPrompt = `当前邮件主题：${threadSubject}

与该联系人最相关的邮件：
${conversation.text}

AI 对合作状态的完整分析：
${JSON.stringify(analysis)}

我的回复想法和判断（中文）：
${userIdeas}

目标语言代码：${targetLang}
目标语气代码：${replyTone}`;

        send('stage', { stage: 'streaming_body', label: '正在生成回复正文' });
        const streamedReply = await streamOpenAICompatibleApi(
          [
            { role: 'system', content: bodySystemPrompt },
            { role: 'user', content: bodyUserPrompt },
          ],
          modelOptions,
          (delta) => {
            if (!firstDeltaAt) firstDeltaAt = performance.now();
            send('delta', { text: delta });
          },
        );
        const suggestedReply = streamedReply
          .replace(/^```(?:text|plaintext)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        if (!suggestedReply) throw new Error('AI 没有返回可用的回复正文。');

        send('stage', { stage: 'finalizing', label: '正在补充中文对照和回复要点' });
        const metadataStartedAt = performance.now();
        const metadata = parseJson(await invokeOpenAICompatibleApi(
          [
            {
              role: 'system',
              content: `你是严谨的商务邮件整理助手。请把外语邮件准确翻译为简体中文，并提炼已经落实的回复要点。
只返回严格 JSON，不要添加 Markdown 或解释：
{
  "translatedReply": "完整中文对照",
  "keyPoints": ["本次回复落实的要点"]
}`,
            },
            {
              role: 'user',
              content: `目标语言：${targetLangName}
外语邮件正文：
${suggestedReply}`,
            },
          ],
          getModelOptions(body, 0.25),
        ));
        const translatedReply = String(metadata.translatedReply || '').trim();
        if (!translatedReply) throw new Error('AI 没有返回可用的中文对照。');

        const totalMs = performance.now() - startedAt;
        console.info('[Gmail AI reply stream timing]', {
          messages: conversation.messageCount,
          inputCharacters: conversation.inputCharacters,
          compactCharacters: conversation.outputCharacters,
          firstDeltaMs: firstDeltaAt ? Math.round(firstDeltaAt - startedAt) : null,
          bodyMs: Math.round(metadataStartedAt - startedAt),
          metadataMs: Math.round(performance.now() - metadataStartedAt),
          totalMs: Math.round(totalMs),
        });
        send('final', {
          suggestedReply,
          translatedReply,
          tone: replyTone,
          keyPoints: safeStringArray(metadata.keyPoints),
        });
        controller.close();
      } catch (error) {
        send('error', {
          message: error instanceof Error ? error.message : 'AI 流式生成失败。',
          canFallback: true,
        });
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
