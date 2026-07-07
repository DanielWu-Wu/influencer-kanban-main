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
  contactName?: string;
  title?: string;
  description?: string;
  country?: string;
  language?: string;
  publicEmail?: string;
  url?: string;
  subscriberCount?: number | null;
  videoCount?: number | null;
  viewCount?: number | null;
  recentAverageViews?: number | null;
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

    if (action === 'inferContactName') {
      const channel = (body.channel || {}) as Pick<OutreachChannel, 'title' | 'description'>;
      if (!channel.title && !channel.description) {
        return NextResponse.json({
          success: true,
          data: { contactName: '', confidence: 0, found: false },
        });
      }

      const result = parseJson(await invokeOpenAICompatibleApi(
        [
          {
            role: 'system',
            content: `你是一位谨慎的联系人姓名提取助手。
只能根据 YouTube 频道名称和频道简介判断是否出现了可用于商务邮件称呼的真实人物姓名。
不要把频道名、品牌名、公司名、用户名、昵称、团队名称或主题关键词误判为人名。
如果没有明确人物姓名线索，必须返回 found=false，contactName 为空字符串，不能猜测。
confidence 使用 0 到 100 的整数，表示该文本明确指向这个人物姓名的可信程度。
只返回严格 JSON：
{"contactName":"姓名或空字符串","confidence":0,"found":false}`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              channelTitle: channel.title || '',
              channelDescription: channel.description || '',
            }, null, 2),
          },
        ],
        getModelOptions(body, 0.1),
      )) as { contactName?: unknown; confidence?: unknown; found?: unknown };
      const contactName = String(result.contactName || '').trim();
      const found = result.found === true && Boolean(contactName);
      const confidence = found
        ? Math.min(100, Math.max(0, Math.round(Number(result.confidence) || 0)))
        : 0;
      return NextResponse.json({
        success: true,
        data: {
          contactName: found ? contactName : '',
          confidence,
          found,
        },
      });
    }

    if (action === 'inferOutreachLanguage') {
      const channel = (body.channel || {}) as Pick<
        OutreachChannel,
        'title' | 'description' | 'recentVideos'
      >;
      const recentTitles = (channel.recentVideos || [])
        .slice(0, 8)
        .map((video) => video.title || '')
        .filter(Boolean);
      if (!channel.description && !recentTitles.length) {
        return NextResponse.json({
          success: true,
          data: { languageCode: '', confidence: 0, found: false },
        });
      }

      const result = parseJson(await invokeOpenAICompatibleApi(
        [
          {
            role: 'system',
            content: `你是一位谨慎的语言识别助手。
请判断品牌首次联系 YouTube 创作者时最适合使用的语言。
优先根据频道简介的主要语言判断；仅当简介为空、过短或多语言混杂而无法判断时，才参考最近视频的原标题。
不要根据国家猜测语言。
languageCode 必须是小写 ISO 639-1 两字母代码，例如 pl、en、es、nl、pt。
如果证据不足，必须返回 found=false，languageCode 为空字符串。
confidence 使用 0 到 100 的整数。
只返回严格 JSON：
{"languageCode":"语言代码或空字符串","confidence":0,"found":false}`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              channelTitle: channel.title || '',
              channelDescription: channel.description || '',
              recentVideoTitles: recentTitles,
            }, null, 2),
          },
        ],
        getModelOptions(body, 0.1),
      )) as { languageCode?: unknown; confidence?: unknown; found?: unknown };
      const languageCode = String(result.languageCode || '').trim().toLowerCase().slice(0, 2);
      const found = result.found === true && /^[a-z]{2}$/.test(languageCode);
      const confidence = found
        ? Math.min(100, Math.max(0, Math.round(Number(result.confidence) || 0)))
        : 0;
      return NextResponse.json({
        success: true,
        data: {
          languageCode: found ? languageCode : '',
          confidence,
          found,
        },
      });
    }

    if (action === 'outreach') {
      const channel = (body.channel || {}) as OutreachChannel;
      if (!channel.title && !channel.url) {
        return NextResponse.json({ error: '缺少 YouTube 频道资料，无法生成开发信。' }, { status: 400 });
      }

      const systemPrompt = withCustomInstructions(
        `${DEFAULT_OUTREACH_PROMPT}

产品资料使用规则：
1. 只使用 products 中当前选中产品的产品名、链接、卖点、技术参数和素材说明。
2. 根据频道简介和最近长视频，从产品卖点中挑选 2-3 个最相关的点进行个性化表达，不要把所有参数机械堆砌进邮件。
3. 不要编造未提供的功率、容量、价格、折扣、质保、认证、库存、发货时效或安全结论。
4. productImage.hasMainImage 只表示用户上传了主图，AI 不能读取图片内容，也不能基于图片做事实判断。

称呼规则：
1. channel.contactName 有值时，只使用这个已确认姓名作为联系人称呼。
2. channel.contactName 为空时，不得猜测人名；使用频道名或自然的团队称呼。

只返回以下 JSON，不要添加其他文字：
{
  "subject": "邮件主题",
  "subjectOptions": [
    {"subject": "备选邮件主题 1，使用目标语言", "translatedSubject": "备选邮件主题 1 的中文翻译"},
    {"subject": "备选邮件主题 2，使用目标语言", "translatedSubject": "备选邮件主题 2 的中文翻译"},
    {"subject": "备选邮件主题 3，使用目标语言", "translatedSubject": "备选邮件主题 3 的中文翻译"}
  ],
  "body": "用目标语言撰写的完整开发信正文",
  "translatedBody": "外语邮件正文的完整中文翻译",
  "translatedSummary": "中文解释，包括邮件意图和主要内容",
  "personalizationNotes": ["使用了哪些频道资料做个性化"],
  "riskNotes": ["保存草稿或发送前需要人工核对的事实和风险"],
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

本次人工确认的邀约方向：
${JSON.stringify({
  targetProduct: body.targetProduct || '',
  cooperationType: body.cooperationType || '',
  cooperationIdea: body.cooperationIdea || '',
  priority: body.priority || '',
}, null, 2)}

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
      )) as Record<string, unknown>;
      const subject = String(result.subject || '').trim();
      const subjectOptions = safeArray(result.subjectOptions)
        .map((item) => {
          const option = item as Record<string, unknown>;
          return {
            subject: String(option.subject || '').trim(),
            translatedSubject: String(option.translatedSubject || '').trim(),
          };
        })
        .filter((item) => item.subject)
        .slice(0, 3);
      if (subject && !subjectOptions.some((item) => item.subject === subject)) {
        subjectOptions.unshift({ subject, translatedSubject: '' });
      }
      result.subjectOptions = subjectOptions.slice(0, 3);
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
