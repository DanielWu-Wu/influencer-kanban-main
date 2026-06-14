export type FeishuBaseLocation = {
  appToken: string;
  tableId?: string;
};

export function parseFeishuBaseUrl(value: string): FeishuBaseLocation {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('请输入完整的飞书多维表格网址。');
  }

  const match = url.pathname.match(/\/base\/([^/?#]+)/);
  if (!match?.[1]) {
    if (url.pathname.includes('/wiki/')) {
      throw new Error('当前链接是飞书知识库链接。请在多维表格中打开原始表格后，再复制地址栏网址。');
    }
    throw new Error('无法从网址中识别多维表格 App Token。');
  }

  return {
    appToken: match[1],
    tableId: url.searchParams.get('table') || undefined,
  };
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
