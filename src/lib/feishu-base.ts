export type FeishuBaseLocation = {
  appToken: string;
  tableId?: string;
};

type FeishuWikiNode = {
  node?: {
    obj_token?: string;
    obj_type?: string;
  };
};

function parseFeishuUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('请输入完整的飞书多维表格网址。');
  }

  const baseMatch = url.pathname.match(/\/base\/([^/?#]+)/);
  if (baseMatch?.[1]) {
    return {
      type: 'base' as const,
      token: baseMatch[1],
      tableId: url.searchParams.get('table') || undefined,
    };
  }

  const wikiMatch = url.pathname.match(/\/wiki\/([^/?#]+)/);
  if (wikiMatch?.[1]) {
    return {
      type: 'wiki' as const,
      token: wikiMatch[1],
      tableId: url.searchParams.get('table') || undefined,
    };
  }

  throw new Error('无法从网址中识别飞书多维表格。');
}

export async function resolveFeishuBaseUrl(
  value: string,
  accessToken: string,
): Promise<FeishuBaseLocation> {
  const parsed = parseFeishuUrl(value);
  if (parsed.type === 'base') {
    return {
      appToken: parsed.token,
      tableId: parsed.tableId,
    };
  }

  try {
    const data = await requestFeishuApi<FeishuWikiNode>(
      `/wiki/v2/spaces/get_node?token=${encodeURIComponent(parsed.token)}`,
      accessToken,
    );
    const node = data.node;
    if (!node?.obj_token) {
      throw new Error('知识库节点没有返回多维表格编号。');
    }
    if (node.obj_type && node.obj_type !== 'bitable') {
      throw new Error(`该知识库页面不是多维表格（类型：${node.obj_type}）。`);
    }
    return {
      appToken: node.obj_token,
      tableId: parsed.tableId,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误';
    throw new Error(
      `无法解析飞书知识库链接。请确认应用已开通“查看知识库”权限并重新连接飞书。${detail}`,
    );
  }
}

type FeishuApiPayload<T> = {
  code?: number;
  msg?: string;
  data?: T;
};

export async function fetchFeishuApi<T>(path: string, accessToken: string) {
  return requestFeishuApi<T>(path, accessToken);
}

export async function requestFeishuApi<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {},
) {
  const response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });
  const payload = await response.json() as FeishuApiPayload<T>;
  if (!response.ok || (payload.code && payload.code !== 0)) {
    throw new Error(payload.msg || `飞书 API 请求失败 (${response.status})`);
  }
  if (!payload.data) throw new Error('飞书 API 没有返回数据。');
  return payload.data;
}
