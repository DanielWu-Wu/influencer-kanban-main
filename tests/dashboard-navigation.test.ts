import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearDashboardNavigationIntent,
  getDashboardNavigationIntent,
} from '../src/lib/dashboard-navigation';

test('授权回调参数只解析为一次启动导航意图', () => {
  assert.equal(getDashboardNavigationIntent('?view=gmail'), 'gmail');
  assert.equal(getDashboardNavigationIntent('?gmail_connected=1'), 'gmail');
  assert.equal(getDashboardNavigationIntent('?auth_error=denied'), 'gmail');
  assert.equal(getDashboardNavigationIntent('?view=settings'), 'settings');
  assert.equal(getDashboardNavigationIntent('?feishu_connected=1'), 'settings');
  assert.equal(getDashboardNavigationIntent('?feishu_error=invalid_state'), 'settings');
  assert.equal(getDashboardNavigationIntent('?foo=bar'), null);
});

test('用户主动切换功能时只清理临时导航参数并保留其他查询条件', () => {
  assert.equal(
    clearDashboardNavigationIntent(
      'https://example.com/?view=settings&feishu_connected=1&campaign=summer#details',
    ),
    '/?campaign=summer#details',
  );
  assert.equal(
    clearDashboardNavigationIntent('https://example.com/?gmail_connected=1&auth_error=denied'),
    '/',
  );
});
