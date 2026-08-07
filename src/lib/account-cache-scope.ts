export const ACCOUNT_SCOPE_CHANGED_EVENT = 'account-scope-changed';

let currentAccountScope = 'signed-out';

export function getAccountCacheScope() {
  return currentAccountScope;
}

export function setAccountCacheScope(scope?: string | null) {
  const next = scope || 'signed-out';
  if (next === currentAccountScope) return;
  currentAccountScope = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACCOUNT_SCOPE_CHANGED_EVENT, { detail: next }));
  }
}

export function scopedLocalStorageKey(key: string) {
  return scopedLocalStorageKeyFor(key, currentAccountScope);
}

export function scopedLocalStorageKeyFor(key: string, scope?: string | null) {
  return `${key}::${scope || 'signed-out'}`;
}
