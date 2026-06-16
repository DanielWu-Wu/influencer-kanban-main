import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/supabase/server';
import { getUserSecret } from '@/lib/user-private-storage';
import type {
  AgentFeishuRecord,
  AgentGmailContext,
  AgentProductContext,
  AgentResponse,
} from '@/lib/agent-assistant';

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
    throw new Error('缺少 AI API Key。请先在网站设置或 Vercel 环境变量中配置。');
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
    temperature: options.temperature ?? 0.25,
  };
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
    throw new Error(`AI API 调用失败 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? data?.content;
  if (typeof content !== 'string') throw new Error('无法解析 AI API 返回。');
  return content;
}

function parseJson(content: string): AgentResponse {
  const match = content.trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 没有返回有效 JSON。');
  const parsed = JSON.parse(match[0]) as Partial<AgentResponse>;
  return {
    reply: String(parsed.reply || '我已经完成分析。'),
    summaryBullets: Array.isArray(parsed.summaryBullets)
      ? parsed.summaryBullets.map(String).slice(0, 8)
      : [],
    actions: Array.isArray(parsed.actions)
      ? parsed.actions
          .filter((action) => action?.type === 'update_feishu_record')
          .map((action, index) => ({
            id: String(action.id || `agent-action-${index + 1}`),
            type: 'update_feishu_record' as const,
            recordId: String(action.recordId || ''),
            influencerName: String(action.influencerName || ''),
            reason: String(action.reason || ''),
            fields: Array.isArray(action.fields)
              ? action.fields
                  .filter((field) => field?.fieldName && field?.value !== undefined)
                  .map((field) => ({
                    fieldName: String(field.fieldName),
                    fieldLabel: field.fieldLabel ? String(field.fieldLabel) : undefined,
                    value: String(field.value),
                  }))
              : [],
          }))
          .filter((action) => action.recordId && action.fields.length > 0)
      : [],
    needsConfirmation: Boolean(parsed.needsConfirmation),
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map(String).slice(0, 6)
      : [],
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.modelProvider === 'custom' && !body.customApiKey) {
      const appAuth = await getRequestUser(request);
      if (appAuth) {
        body.customApiKey =
          await getUserSecret<string>(appAuth.supabase, 'ai_api_key') || '';
      }
    }

    const message = String(body.message || '').trim();
    if (!message) {
      return NextResponse.json({ error: '请输入要问 AI Agent 的内容。' }, { status: 400 });
    }

    const feishuRecords = Array.isArray(body.feishuRecords)
      ? body.feishuRecords as AgentFeishuRecord[]
      : [];
    const products = Array.isArray(body.products)
      ? body.products as AgentProductContext[]
      : [];
    const gmail = (body.gmail || {
      connected: false,
      recentThreads: [],
      contactHistories: [],
    }) as AgentGmailContext;
    const fieldMapping = body.fieldMapping || {};

    const systemPrompt = `你是一个海外 YouTube 红人推广运营 Agent，服务对象是推广负责人 Daniel。

你的任务：
1. 读取飞书红人库、Gmail 摘要、产品资料和用户指令。
2. 先给出简短、可执行的中文回答。
3. 如果用户要求修改资料，你只能生成“操作预览”，不能说已经执行。
4. 所有写入动作只允许使用 actions 中的 update_feishu_record。
5. 不能自动发邮件、删除记录、修改未被用户要求的字段、编造表格不存在的字段。
6. 如果记录匹配不确定，先说明需要确认，不要生成写入动作。
7. action.fields.fieldName 必须使用上下文里提供的真实飞书字段名，不要使用字段 key。
8. 如果只是让你汇报、筛选或分析，actions 返回空数组。

只返回 JSON，不要输出 Markdown 代码块：
{
  "reply": "给用户看的简短中文回答",
  "summaryBullets": ["可选的要点"],
  "actions": [
    {
      "id": "action-1",
      "type": "update_feishu_record",
      "recordId": "飞书 record_id",
      "influencerName": "红人名称",
      "reason": "为什么要这样更新",
      "fields": [
        { "fieldName": "真实飞书字段名", "fieldLabel": "字段中文含义", "value": "要写入的新值" }
      ]
    }
  ],
  "needsConfirmation": true,
  "warnings": ["可选风险提示"]
}`;

    const userPrompt = `用户指令：
${message}

飞书字段映射：
${JSON.stringify(fieldMapping)}

可参考的飞书红人记录（已经筛选/压缩，recordId 是真实写入目标）：
${JSON.stringify(feishuRecords)}

产品资料：
${JSON.stringify(products)}

Gmail 上下文：
${JSON.stringify(gmail)}

请按系统要求返回 JSON。`;

    const result = parseJson(await invokeOpenAICompatibleApi(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      getModelOptions(body, 0.2),
    ));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI Agent 调用失败。' },
      { status: 500 },
    );
  }
}
