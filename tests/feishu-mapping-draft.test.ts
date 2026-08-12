import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areFeishuFieldMappingsEqual,
  shouldSyncFeishuMappingDraft,
} from '../src/lib/feishu-mapping';

test('后台设置更新不会覆盖尚未保存的飞书映射草稿', () => {
  assert.equal(shouldSyncFeishuMappingDraft(false), true);
  assert.equal(shouldSyncFeishuMappingDraft(true), false);
});

test('映射比较忽略对象引用，只比较字段选择', () => {
  assert.equal(
    areFeishuFieldMappingsEqual(
      { channelName: '频道名', email: '邮箱' },
      { email: '邮箱', channelName: '频道名' },
    ),
    true,
  );
  assert.equal(
    areFeishuFieldMappingsEqual({ channelName: '频道名' }, { channelName: '红人频道名' }),
    false,
  );
});
