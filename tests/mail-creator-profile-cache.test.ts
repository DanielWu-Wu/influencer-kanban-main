import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMailCreatorProfileLookupKey,
  clearMailCreatorProfileCache,
  MAIL_CREATOR_PROFILE_CACHE_MAX_ENTRIES,
  parseMailCreatorProfileLookupKey,
  readMailCreatorProfileCache,
  writeMailCreatorProfileCache,
  type MailCreatorProfile,
} from '../src/lib/mail-creator-profile-cache';

const profile: MailCreatorProfile = {
  recordId: 'record-1',
  email: 'creator@example.com',
  matchedBy: '邮箱：creator@example.com',
  channelName: 'Creator',
  channelUrl: 'https://youtube.com/@creator',
  channelId: 'UC_CREATOR',
  region: '西班牙',
  platform: 'YouTube',
  followers: '10000',
  collaborationStatus: '有意向',
  hasReply: '已回复',
};

function buildKey(overrides: Partial<Parameters<typeof buildMailCreatorProfileLookupKey>[0]> = {}) {
  return buildMailCreatorProfileLookupKey({
    accountScope: 'system-user-a',
    provider: 'gmail',
    mailAccountId: 'gmail-account-a',
    threadId: 'thread-1',
    contactEmails: ['Creator@Example.com', 'other@example.com'],
    feishuUrl: 'https://example.feishu.cn/base/abc',
    mapping: {
      email: '联系邮箱',
      channelName: '频道名',
      collaborationStatus: '合作状态',
    },
    ...overrides,
  });
}

test('红人匹配键忽略联系人顺序、大小写和字段映射对象顺序', () => {
  const first = buildKey();
  const second = buildKey({
    contactEmails: ['other@example.com', 'creator@example.com', 'CREATOR@example.com'],
    mapping: {
      collaborationStatus: '合作状态',
      channelName: '频道名',
      email: '联系邮箱',
    },
  });
  assert.equal(first, second);
  assert.deepEqual(parseMailCreatorProfileLookupKey(first)?.contactEmails, [
    'creator@example.com',
    'other@example.com',
  ]);
});

test('无效匹配键不会被解析为可用身份', () => {
  assert.equal(parseMailCreatorProfileLookupKey(''), null);
  assert.equal(parseMailCreatorProfileLookupKey('{"provider":"gmail"}'), null);
});

test('系统用户、邮箱类型、邮箱账号、线程、联系人和飞书映射严格隔离', () => {
  const baseline = buildKey();
  const variants = [
    buildKey({ accountScope: 'system-user-b' }),
    buildKey({ provider: 'tencent_exmail' }),
    buildKey({ mailAccountId: 'gmail-account-b' }),
    buildKey({ threadId: 'thread-2' }),
    buildKey({ contactEmails: ['different@example.com'] }),
    buildKey({ feishuUrl: 'https://example.feishu.cn/base/other' }),
    buildKey({ mapping: { email: '另一个邮箱字段' } }),
  ];
  variants.forEach((variant) => assert.notEqual(variant, baseline));
});

test('会话缓存同时保留成功匹配和未找到结果', () => {
  clearMailCreatorProfileCache();
  const matchedKey = buildKey();
  const missingKey = buildKey({ threadId: 'thread-missing' });

  writeMailCreatorProfileCache(matchedKey, profile, 100);
  writeMailCreatorProfileCache(missingKey, null, 200);

  assert.deepEqual(readMailCreatorProfileCache(matchedKey), { profile, matchedAt: 100 });
  assert.deepEqual(readMailCreatorProfileCache(missingKey), { profile: null, matchedAt: 200 });
  clearMailCreatorProfileCache();
});

test('会话缓存采用最近使用顺序并限制最大数量', () => {
  clearMailCreatorProfileCache();
  const firstKey = buildKey({ threadId: 'thread-0' });
  writeMailCreatorProfileCache(firstKey, profile);

  for (let index = 1; index < MAIL_CREATOR_PROFILE_CACHE_MAX_ENTRIES; index += 1) {
    writeMailCreatorProfileCache(buildKey({ threadId: `thread-${index}` }), profile);
  }
  assert.ok(readMailCreatorProfileCache(firstKey));

  const evictedKey = buildKey({ threadId: 'thread-1' });
  writeMailCreatorProfileCache(buildKey({ threadId: 'thread-overflow' }), profile);
  assert.equal(readMailCreatorProfileCache(evictedKey), undefined);
  assert.ok(readMailCreatorProfileCache(firstKey));
  clearMailCreatorProfileCache();
});
