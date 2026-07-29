import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeishuRecordIndex,
  findFeishuRecordMatch,
  splitFeishuEmails,
} from '../src/lib/feishu-record-index';

const mapping = {
  channelId: '频道 ID',
  channelUrl: '频道链接',
  email: '邮箱',
  channelName: '频道名',
} as const;

function record(
  recordId: string,
  fields: Record<string, unknown>,
) {
  return { record_id: recordId, fields };
}

test('精确匹配遵循 Channel ID → 链接 → 邮箱优先级', () => {
  const records = [
    record('by-channel', {
      '频道 ID': 'UC123',
      '频道链接': { text: '另一个链接', link: 'https://youtube.com/@other' },
      '邮箱': 'other@example.com',
      '频道名': 'Other',
    }),
    record('by-email', {
      '频道链接': 'https://youtube.com/@target',
      '邮箱': 'target@example.com',
      '频道名': 'Target',
    }),
  ];
  const index = buildFeishuRecordIndex(records, mapping);
  const match = findFeishuRecordMatch({
    channelId: 'UC123',
    inputUrl: 'https://youtube.com/@target',
    publicEmail: 'target@example.com',
    title: 'Target',
  }, index);
  assert.equal(match.kind, 'exact');
  assert.equal(match.kind === 'exact' ? match.record.record_id : '', 'by-channel');
});

test('飞书超链接对象提取真实频道链接，单元格多邮箱分别进入索引', () => {
  const records = [
    record('multi-email', {
      '频道链接': { text: 'Minimal Furgo', link: 'https://www.youtube.com/@MinimalFurgo/videos' },
      '邮箱': 'hello@example.com\nminimalfurgo@gmail.com；third@example.com',
      '频道名': 'Minimal Furgo',
    }),
  ];
  assert.deepEqual(
    splitFeishuEmails(records[0].fields['邮箱']),
    ['hello@example.com', 'minimalfurgo@gmail.com', 'third@example.com'],
  );
  const index = buildFeishuRecordIndex(records, mapping);
  const byUrl = findFeishuRecordMatch({
    inputUrl: 'https://www.youtube.com/@MinimalFurgo',
  }, index);
  const byEmail = findFeishuRecordMatch({
    inputUrl: 'https://youtube.com/@unrelated',
    publicEmail: 'minimalfurgo@gmail.com',
  }, index);
  assert.equal(byUrl.kind, 'exact');
  assert.equal(byEmail.kind, 'exact');
});

test('同一精确键命中多条记录时返回冲突，不静默取第一条', () => {
  const records = [
    record('one', { '邮箱': 'same@example.com' }),
    record('two', { '邮箱': 'same@example.com' }),
  ];
  const match = findFeishuRecordMatch({
    inputUrl: 'https://youtube.com/@new',
    publicEmail: 'same@example.com',
  }, buildFeishuRecordIndex(records, mapping));
  assert.equal(match.kind, 'conflict');
  assert.equal(match.kind === 'conflict' ? match.records.length : 0, 2);
});

test('handle 和频道名只返回疑似匹配', () => {
  const records = [
    record('handle', {
      '频道链接': 'https://youtube.com/@same-handle',
      '频道名': 'Same name',
    }),
  ];
  const index = buildFeishuRecordIndex(records, mapping);
  const match = findFeishuRecordMatch({
    inputUrl: 'https://youtube.com/channel/UC-unrelated',
    customUrl: '@same-handle',
  }, index);
  assert.equal(match.kind, 'suspected');

  const nameOnly = findFeishuRecordMatch({
    inputUrl: 'https://youtube.com/@different',
    title: 'Same name',
  }, index);
  assert.equal(nameOnly.kind, 'suspected');
});

test('约1,000行快照对10个红人完成本地索引匹配低于200ms', () => {
  const records = Array.from({ length: 1_000 }, (_, index) => record(`record-${index}`, {
    '频道 ID': `UC${index}`,
    '频道链接': `https://youtube.com/@creator-${index}`,
    '邮箱': `creator-${index}@example.com`,
    '频道名': `Creator ${index}`,
  }));
  const startedAt = performance.now();
  const index = buildFeishuRecordIndex(records, mapping);
  const matches = Array.from({ length: 10 }, (_, indexValue) => (
    findFeishuRecordMatch({
      channelId: `UC${indexValue * 99}`,
      inputUrl: `https://youtube.com/@creator-${indexValue * 99}`,
    }, index)
  ));
  const elapsedMs = performance.now() - startedAt;
  assert.ok(matches.every((match) => match.kind === 'exact'));
  assert.ok(elapsedMs < 200, `本地索引匹配耗时 ${elapsedMs.toFixed(1)}ms`);
});
