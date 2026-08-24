export const WORKSPACE_SESSION_REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const WORKSPACE_SESSION_READY_CACHE_MS = 5 * 60 * 1000;

export function shouldRefreshWorkspaceSession(
  expiresAtSeconds: number | undefined,
  now = Date.now(),
) {
  if (!expiresAtSeconds || !Number.isFinite(expiresAtSeconds)) return true;
  return expiresAtSeconds * 1000 <= now + WORKSPACE_SESSION_REFRESH_MARGIN_MS;
}

export function canReuseReadyWorkspaceSession(options: {
  readyAt: number;
  readyAccessToken: string;
  currentAccessToken: string;
  expiresAtSeconds?: number;
  now?: number;
}) {
  const now = options.now ?? Date.now();
  return Boolean(
    options.readyAt
    && options.readyAccessToken
    && options.readyAccessToken === options.currentAccessToken
    && now - options.readyAt < WORKSPACE_SESSION_READY_CACHE_MS
    && !shouldRefreshWorkspaceSession(options.expiresAtSeconds, now),
  );
}

export function shouldRetrySafeRequestAfterSessionRecovery(status: number) {
  return status === 401 || status === 403;
}

export async function runSafeRequestWithSessionRecovery(
  ensureSession: (options?: { forceRefresh?: boolean; forceVerify?: boolean }) => Promise<unknown | null>,
  request: () => Promise<Response>,
) {
  const currentSession = await ensureSession();
  if (!currentSession) throw new Error('登录状态已失效，请重新登录。');
  let response = await request();
  if (!shouldRetrySafeRequestAfterSessionRecovery(response.status)) return response;

  const recoveredSession = await ensureSession({ forceRefresh: true, forceVerify: true });
  if (!recoveredSession) throw new Error('登录状态已失效，请重新登录。');
  response = await request();
  return response;
}
