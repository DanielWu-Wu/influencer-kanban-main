export type DashboardNavigationIntent = 'gmail' | 'settings' | null;

const TRANSIENT_NAVIGATION_PARAMS = [
  'view',
  'gmail_connected',
  'auth_error',
  'feishu_connected',
  'feishu_error',
] as const;

export function getDashboardNavigationIntent(search: string): DashboardNavigationIntent {
  const params = new URLSearchParams(search);
  if (
    params.get('view') === 'gmail'
    || params.has('gmail_connected')
    || params.has('auth_error')
  ) {
    return 'gmail';
  }
  if (
    params.get('view') === 'settings'
    || params.has('feishu_connected')
    || params.has('feishu_error')
  ) {
    return 'settings';
  }
  return null;
}

export function clearDashboardNavigationIntent(url: string) {
  const nextUrl = new URL(url);
  for (const key of TRANSIENT_NAVIGATION_PARAMS) nextUrl.searchParams.delete(key);
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}
