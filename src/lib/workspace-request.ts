type WorkspaceSession = { access_token: string; user: { id: string } };
type SessionBridge = {
  ensure: (options?: { forceRefresh?: boolean; forceVerify?: boolean }) => Promise<WorkspaceSession | null>;
  userId: () => string | null;
};
let bridge: SessionBridge | null = null;

export function registerWorkspaceSession(next: SessionBridge) {
  bridge = next;
  return () => { if (bridge === next) bridge = null; };
}

/** Auth failures must not fall through to a second, ordinary AI generation. */
export class WorkspaceRequestError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkspaceRequestError'; }
}

export function waitForWorkspace<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('操作已取消', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('操作已取消', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Explicit local AI/translation requests only. Never intercept mail sends or external URLs. */
export async function workspaceFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const raw = input instanceof Request ? input.url : String(input);
  const origin = typeof window === 'undefined' ? 'https://workspace.local' : window.location.origin;
  const url = new URL(raw, origin);
  if (url.origin !== origin || !/^\/api\/(ai(?:\/[^/]+)?|translate)$/.test(url.pathname)) return fetch(input, init);
  const active = bridge;
  if (!active) throw new WorkspaceRequestError('账号连接尚未就绪，请稍后重试。');
  const expectedUser = active.userId();
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  let session: WorkspaceSession | null;
  const ensure = async (forceRefresh = false) => {
    try {
      const next = await waitForWorkspace(active.ensure(forceRefresh ? { forceRefresh: true, forceVerify: true } : undefined), signal);
      if (!next) throw new WorkspaceRequestError('登录状态已失效，请重新登录。');
      if (active !== bridge || (expectedUser && next?.user.id !== expectedUser)
        || (next && active.userId() !== next.user.id)) throw new WorkspaceRequestError('账号已变化，请重新打开后操作。');
      return next;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
      throw new WorkspaceRequestError(error instanceof Error ? error.message : '连接暂时失败，请重试。');
    }
  };
  session = await ensure();
  const send = () => {
    if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
    if (active !== bridge || active.userId() !== session?.user.id) throw new WorkspaceRequestError('账号已变化，请重新打开后操作。');
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('Authorization', `Bearer ${session.access_token}`);
    return fetch(input instanceof Request ? input.clone() : input, { ...init, headers, signal }).catch((error) => {
      if (signal?.aborted) throw error;
      throw new WorkspaceRequestError('请求连接中断，请重试。');
    });
  };
  let response = await send();
  // The server explicitly certifies that the model has not been invoked.
  if (response.status === 401) {
    const result = await response.clone().json().catch(() => null);
    if (result?.code === 'SESSION_INVALID' && result?.executionStarted === false) {
      session = await ensure(true);
      response = await send();
    }
  }
  if (active !== bridge || active.userId() !== session.user.id) {
    void response.body?.cancel();
    throw new WorkspaceRequestError('账号已变化，请重新打开后操作。');
  }
  if (!response.ok) {
    const result = await response.clone().json().catch(() => null);
    // Never treat rejected authentication, ownership or throttling as lack of streaming support.
    if (![404, 405, 501].includes(response.status) || result?.executionStarted === false) {
      throw new WorkspaceRequestError(result?.error || '连接暂时失败，请重试。');
    }
  }
  return response;
}
