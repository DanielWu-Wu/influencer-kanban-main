import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_ANALYSIS_PROMPT,
  DEFAULT_DRAFT_PROMPT,
  DEFAULT_OUTREACH_PROMPT,
} from '@/lib/ai-prompts';
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

type ThreadMessage = {
  id?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  body?: string;
};

type OutreachVideo = {
  title?: string;
  description?: string;
  publishedAt?: string;
  url?: string;
};

type OutreachChannel = {
  title?: string;
  description?: string;
  country?: string;
  publicEmail?: string;
  url?: string;
  subscriberCount?: number | null;
  videoCount?: number | null;
  viewCount?: number | null;
  recentVideos?: OutreachVideo[];
};

function resolveChatOptions(options: ChatOptions): Required<ChatOptions> {
  const apiKey =
    options.apiKey ||
    process.env.AI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('缺少 AI API Key。请先在网站设置或 Vercel 环境变量中配置 AI_API_KEY。');
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
    body: JSON.stringify({ model: modelName, messages, temperature }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API 调用失败 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? data?.content;
  if (typeof content !== 'string') throw new Error('无法解析 AI API 返回的数据。');
  return content;
}

function parseJson(content: string) {
  const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 未返回有效 JSON。');
  return JSON.parse(jsonMatch[0]);
}

function buildConversation(messages: ThreadMessage[]) {
  const selectedMessages = [...messages]
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
    .slice(-50);
  const charactersPerMessage = Math.max(
    1_000,
    Math.min(5_000, Math.floor(75_000 / Math.max(selectedMessages.length, 1))),
  );

  return selectedMessages
    .map((message, index) => {
      const body = String(message.body || '').slice(0, charactersPerMessage);
      return `--- 邮件 ${index + 1} ---
主题：${message.subject || '无主题'}
时间：${message.date || '未知'}
发件人：${message.from || '未知'}
收件人：${message.to || '未知'}
正文：${body}`;
    })
    .join('\n\n');
}

function getModelOptions(body: Record<string, unknown>, temperature: number): ChatOptions {
  return {
    apiUrl: body.modelProvider === 'custom' ? String(body.customApiUrl || '') : undefined,
    apiKey: body.modelProvider === 'custom' ? String(body.customApiKey || '') : undefined,
    modelName: body.modelProvider === 'custom' ? String(body.customModelName || '') : undefined,
    temperature,
  };
}

function withCustomInstructions(
  basePrompt: string,
  customPrompt: unknown,
  defaultPrompt?: string,
) {
  const custom = String(customPrompt || '').trim();
  if (!custom || custom === defaultPrompt?.trim()) return basePrompt;
  return `${basePrompt}

以下是用户在设置中配置的专属要求。请在不违反事实准确性和输出格式要求的前提下优先遵守：
--- 用户专属提示词 ---
${custom}
--- 用户专属提示词结束 ---`;
}

async function hydrateSecrets(request: NextRequest, body: Record<string, unknown>) {
  if (body.modelProvider === 'custom' && !body.customApiKey) {
    const appAuth = await getRequestUser(request);
    if (appAuth) {
      body.customApiKey = await getUserSecret<string>(appAuth.supabase, 'ai_api_key') || '';
    }
  }
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    await hydrateSecrets(request, body);

    const action = String(body.action || 'draft');
    const threadSubject = String(body.threadSubject || '无主题');
    const threadMessages = Array.isArray(body.threadMessages)
      ? body.threadMessages as ThreadMessage[]
      : [];

    if (action === 'outreach') {
      const channel = (body.channel || {}) as OutreachChannel;
      if (!channel.title && !channel.url) {
        return NextResponse.json({ error: '缺少 YouTube 频道资料，无法生成开发信。' }, { status: 400 });
      }

      const systemPrompt = withCustomInstructions(
        `${DEFAULT_OUTREACH_PROMPT}

只返回以下 JSON，不要添加其他文字：
{
  "subject": "邮件主题",
  "body": "用目标语言撰写的完整开发信正文",
  "translatedSummary": "中文解释，包括邮件意图和主要内容",
  "personalizationNotes": ["使用了哪些频道资料做个性化"],
  "missingInfo": ["仍然缺少哪些信息"],
  "language": "en",
  "tone": "professional"
}`,
        body.outreachPrompt,
        DEFAULT_OUTREACH_PROMPT,
      );

      const userPrompt = `请为下面这个 YouTube 频道生成首次冷开发邮件。

频道资料：
${JSON.stringify(channel, null, 2)}

最近视频：
${JSON.stringify(channel.recentVideos || [], null, 2)}

产品数据库：
${JSON.stringify(safeArray(body.products), null, 2)}

品牌信息：
${JSON.stringify({
  brandName: body.brandName || '',
  senderName: body.senderName || '',
  preferredLanguage: body.preferredLanguage || '',
  emailSignature: body.emailSignature || '',
}, null, 2)}

用户补充偏好：
${String(body.userPreference || '').trim() || '无'}
`;

      const result = parseJson(await invokeOpenAICompatibleApi(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        getModelOptions(body, 0.55),
      ));
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'analyze') {
      if (threadMessages.length === 0) {
        return NextResponse.json({ error: '缺少邮件历史，无法进行合作分析。' }, { status: 400 });
      }

      const systemPrompt = withCustomInstructions(
        `${DEFAULT_ANALYSIS_PROMPT}

请识别对方最近一封实质邮件的语言。language 必须返回 ISO 639-1 代码，例如 en、nl、es、de、fr、it、pt、ja。
只返回以下 JSON，不要添加其他文字：
{
  "latestSummary": "最新邮件的中文意思梗概",
  "creatorIntent": "红人的真实意图和核心诉求",
  "stage": "当前合作阶段",
  "attitude": "红人的态度、积极程度和情绪",
  "communicationStyle": "暂定沟通风格和判断依据",
  "currentEmotion": "对方当前情绪",
  "statedPosition": "对方明确说出的要求或表面立场",
  "coreInterests": "要求背后的核心利益、主要卡点或真实顾虑",
  "communicationRisks": ["本轮回复不宜使用的表达、态度或谈判方式"],
  "leverageOptions": ["可用于推动合作的非现金条件或替代方案"],
  "confirmedItems": ["已经确认的事项"],
  "openQuestions": ["尚待确认或解决的问题"],
  "risks": ["潜在风险或需要留意的地方"],
  "replyStrategy": ["建议回复方向或谈判策略"],
  "language": "en",
  "languageName": "英语"
}`,
        body.analysisPrompt,
        DEFAULT_ANALYSIS_PROMPT,
      );

      const userPrompt = `当前邮件主题：${threadSubject}

以下内容包含当前线程，以及与同一联系人最近最多 50 封历史邮件，已经按时间顺序排列：
${buildConversation(threadMessages)}`;

      const result = parseJson(await invokeOpenAICompatibleApi(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        getModelOptions(body, 0.25),
      ));
      return NextResponse.json({ success: true, data: result });
    }

    const userIdeas = String(body.userIdeas || '').trim();
    const targetLang = String(body.targetLang || 'en');
    const targetLangName = String(body.targetLangName || targetLang);
    const analysis = body.analysis || {};

    if (!userIdeas || threadMessages.length === 0) {
      return NextResponse.json(
        { error: '缺少邮件历史或你的回复想法。' },
        { status: 400 },
      );
    }

    const systemPrompt = withCustomInstructions(
      `${DEFAULT_DRAFT_PROMPT}

目标语言：${targetLangName}
只返回以下 JSON，不要添加其他文字：
{
  "suggestedReply": "使用目标语言撰写的完整回复邮件",
  "translatedReply": "中文对照",
  "tone": "friendly",
  "keyPoints": ["本次回复落实的要点"]
}`,
      body.draftPrompt,
      DEFAULT_DRAFT_PROMPT,
    );

    const userPrompt = `当前邮件主题：${threadSubject}

与该联系人的最近邮件历史：
${buildConversation(threadMessages)}

AI 对合作状态的分析：
${JSON.stringify(analysis)}

我的回复想法和判断（中文）：
${userIdeas}

目标语言代码：${targetLang}`;

    const result = parseJson(await invokeOpenAICompatibleApi(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      getModelOptions(body, 0.55),
    ));
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('AI 邮件处理失败:', error);
    const errorMessage = error instanceof Error
      ? error.message
      : 'AI 邮件处理失败，请稍后重试。';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
