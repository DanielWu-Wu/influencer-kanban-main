import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearGmailInboxCache,
  createGmailInboxCacheKey,
  isGmailInboxCacheFresh,
  isGmailInboxCacheKeyCurrent,
  readGmailInboxCache,
  writeGmailInboxCache,
} from '../src/lib/gmail-inbox-cache';
import type { GmailThread } from '../src/lib/types';

const cachedThread = { id: 'thread-1' } as GmailThread;

test('Gmail 邮件列表缓存按系统账号和 Gmail 邮箱隔离', () => {
  clearGmailInboxCache();
  const accountAKey = createGmailInboxCacheKey({
    accountScope: 'account-a',
    gmailEmail: 'owner@example.com',
    viewKey: 'inbox:primary:0',
    pageIndex: 0,
  });
  const accountBKey = createGmailInboxCacheKey({
    accountScope: 'account-b',
    gmailEmail: 'owner@example.com',
    viewKey: 'inbox:primary:0',
    pageIndex: 0,
  });
  const mailboxBKey = createGmailInboxCacheKey({
    accountScope: 'account-a',
    gmailEmail: 'other@example.com',
    viewKey: 'inbox:primary:0',
    pageIndex: 0,
  });

  writeGmailInboxCache(accountAKey, {
    threads: [cachedThread],
    nextPageToken: null,
    normalUnreadCount: 1,
    lastSyncedAt: new Date(1_000).toISOString(),
    fetchedAt: 1_000,
  });

  assert.equal(readGmailInboxCache(accountAKey)?.threads[0]?.id, 'thread-1');
  assert.equal(readGmailInboxCache(accountBKey), null);
  assert.equal(readGmailInboxCache(mailboxBKey), null);
});

test('Gmail 邮件列表缓存只在新鲜期内阻止重复抓取', () => {
  const entry = {
    threads: [cachedThread],
    nextPageToken: null,
    normalUnreadCount: 1,
    lastSyncedAt: new Date(10_000).toISOString(),
    fetchedAt: 10_000,
  };

  assert.equal(isGmailInboxCacheFresh(entry, 69_999), true);
  assert.equal(isGmailInboxCacheFresh(entry, 70_000), false);
});

test('Gmail 邮件列表缓存按视图、搜索条件和页码隔离', () => {
  const inboxKey = createGmailInboxCacheKey({
    accountScope: 'account-a',
    gmailEmail: 'owner@example.com',
    viewKey: 'inbox:primary:0',
    pageIndex: 0,
  });
  const sentKey = createGmailInboxCacheKey({
    accountScope: 'account-a',
    gmailEmail: 'owner@example.com',
    viewKey: 'sent:primary:0',
    pageIndex: 0,
  });
  const searchKey = createGmailInboxCacheKey({
    accountScope: 'account-a',
    gmailEmail: 'owner@example.com',
    viewKey: 'search:project:0',
    pageIndex: 0,
  });
  const nextPageKey = createGmailInboxCacheKey({
    accountScope: 'account-a',
    gmailEmail: 'owner@example.com',
    viewKey: 'inbox:primary:0',
    pageIndex: 1,
  });

  assert.notEqual(inboxKey, sentKey);
  assert.notEqual(inboxKey, searchKey);
  assert.notEqual(inboxKey, nextPageKey);
});

test('Gmail 邮件列表忽略已经切走视图的旧请求结果', () => {
  const inboxKey = createGmailInboxCacheKey({
    accountScope: 'account-a',
    gmailEmail: 'owner@example.com',
    viewKey: 'inbox:primary:0',
    pageIndex: 0,
  });
  const sentKey = createGmailInboxCacheKey({
    accountScope: 'account-a',
    gmailEmail: 'owner@example.com',
    viewKey: 'sent:primary:0',
    pageIndex: 0,
  });

  assert.equal(isGmailInboxCacheKeyCurrent(inboxKey, inboxKey), true);
  assert.equal(isGmailInboxCacheKeyCurrent(inboxKey, sentKey), false);
  assert.equal(isGmailInboxCacheKeyCurrent(inboxKey, null), false);
});
