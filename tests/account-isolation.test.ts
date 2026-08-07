import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_USER_DATA_KEYS, USER_DATA_KEYS } from '../src/lib/account-data-keys';
import {
  getAccountCacheScope,
  scopedLocalStorageKey,
  setAccountCacheScope,
} from '../src/lib/account-cache-scope';

test('通用账号数据接口只接受公开业务键，不暴露历史私密备份', () => {
  assert.equal(PUBLIC_USER_DATA_KEYS.has(USER_DATA_KEYS.TODOS), true);
  assert.equal(PUBLIC_USER_DATA_KEYS.has(USER_DATA_KEYS.CALENDAR_EVENTS), true);
  assert.equal(PUBLIC_USER_DATA_KEYS.has(USER_DATA_KEYS.LEGACY_BACKUP), false);
});

test('相同浏览器缓存键按账号生成不同命名空间', () => {
  setAccountCacheScope('member-a');
  const memberAKey = scopedLocalStorageKey('gmail-thread-cache');
  assert.equal(getAccountCacheScope(), 'member-a');

  setAccountCacheScope('member-b');
  const memberBKey = scopedLocalStorageKey('gmail-thread-cache');
  assert.equal(getAccountCacheScope(), 'member-b');
  assert.notEqual(memberAKey, memberBKey);
  assert.equal(memberAKey, 'gmail-thread-cache::member-a');
  assert.equal(memberBKey, 'gmail-thread-cache::member-b');

  setAccountCacheScope(null);
});
