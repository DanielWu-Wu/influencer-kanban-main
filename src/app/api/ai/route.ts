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

type ThreadMessage = {
  from?: string;
  to?: string;
  date?: string;
  body?: string;
};

function resolveChatOptions(options: ChatOptions): Required<ChatOptions> {
  const apiKey =
    options.apiKey ||
    process.env.AI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      '缺少 AI API Key。请在 Vercel 环境变量中设置 AI_API_KEY、DEEPSEEK_API_KEY 或 OPENAI_API_KEY。',
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
  if (typeof content !== 'string') throw new Error('无法解析 AI API 返回的数据。');
  return content;
}

function parseJson(content: string) {
  const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 未返回有效 JSON。');
  return JSON.parse(jsonMatch[0]);
}

function buildConversation(messages: ThreadMessage[]) {
  const selectedMessages = messages.slice(-40);
  const charactersPerMessage = Math.max(
    1_500,
    Math.min(6_000, Math.floor(60_000 / Math.max(selectedMessages.length, 1))),
  );

  return selectedMessages
    .map((message, index) => {
      const body = String(message.body || '').slice(0, charactersPerMessage);
      return `--- 邮件 ${index + 1} ---
时间：${message.date || '未知'}
发件人：${message.from || '未知'}
收件人：${message.to || '未知'}
正文：
${body}`;
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || 'draft');
    const threadSubject = String(body.threadSubject || '无主题');
    const threadMessages = Array.isArray(body.threadMessages)
      ? body.threadMessages as ThreadMessage[]
      : [];

    if (action === 'analyze') {
      if (threadMessages.length === 0) {
        return NextResponse.json({ error: '缺少完整邮件对话。' }, { status: 400 });
      }

      const systemPrompt = `你是一位资深的 YouTube 红人合作与商务谈判顾问。
请分析品牌方与红人的完整邮件往来，并结合以下合作流程判断当前状态：
红人建档 → 待联系 → 已联系 → 有意向 → 谈价格/方式 → 已确认 → 已寄样 → 拍摄中 → 已发布 → 复盘/归档。

请识别对方最近一封实质邮件的语言。language 必须返回 ISO 639-1 代码，例如 en、nl、es、de、fr、it、pt、ja。
请只返回以下 JSON，不要添加其他文字：
{
  "latestSummary": "最新邮件的中文意思梗概",
  "creatorIntent": "红人的真实意图和核心诉求",
  "stage": "当前合作阶段",
  "attitude": "红人的态度、积极程度和情绪",
  "confirmedItems": ["已经确认的事项"],
  "openQuestions": ["尚待确认或解决的问题"],
  "risks": ["潜在风险或需要留意的地方"],
  "replyStrategy": ["建议回复方向或谈判策略"],
  "language": "en",
  "languageName": "英语"
}`;

      const userPrompt = `邮件主题：${threadSubject}

完整邮件往来（按时间顺序）：
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
      return NextResponse.json({ error: '缺少完整对话或你的回复想法。' }, { status: 400 });
    }

    const systemPrompt = `你是一位资深 YouTube 红人合作邮件与谈判助手。
请结合完整邮件历史、合作分析和用户的中文回复想法，起草一封${targetLangName}商务回复。
要求：
1. 使用对方当前沟通语言，不要混入中文。
2. 保持专业、自然、友好，不虚构价格、日期、地址或承诺。
3. 用户没有明确说明的关键商务条件，应使用询问或保留表达。
4. 邮件正文不要重复主题，不使用 Markdown。
5. 同时提供准确的中文对照。

只返回以下 JSON：
{
  "suggestedReply": "使用${targetLangName}撰写的完整回复邮件",
  "translatedReply": "中文对照",
  "tone": "friendly",
  "keyPoints": ["本次回复落实的要点"]
}`;

    const userPrompt = `邮件主题：${threadSubject}

完整邮件往来：
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
    const errorMessage = error instanceof Error ? error.message : 'AI 邮件处理失败，请稍后重试。';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
