import type { FeishuAppCredentialStatus } from './feishu-app-credentials';
import { toBrowserFeishuAuth, type StoredFeishuAuth } from './feishu-cloud-auth';

export async function getFeishuSessionState(
  credentials: FeishuAppCredentialStatus,
  stored: StoredFeishuAuth | null,
  refresh: () => Promise<StoredFeishuAuth>,
) {
  if (!stored) return { ...credentials, connected: false };

  try {
    const fresh = await refresh();
    return { ...credentials, connected: true, data: toBrowserFeishuAuth(fresh) };
  } catch (error) {
    // 刷新失败只影响当前授权，不应将已保存的企业应用凭证显示为丢失。
    return {
      ...credentials,
      connected: false,
      reconnectRequired: true,
      error: error instanceof Error ? error.message : '飞书授权状态检查失败。',
    };
  }
}
