import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkFeishuItems,
  normalizeBatchOperationId,
  normalizeFeishuFieldsWithTypes,
} from '../src/lib/feishu-batch';

for (const [count, expectedChunks] of [[1, 1], [49, 1], [50, 1], [51, 2]] as const) {
  test(`批量切块 ${count} 条得到 ${expectedChunks} 批`, () => {
    const chunks = chunkFeishuItems(Array.from({ length: count }, (_, index) => index));
    assert.equal(chunks.length, expectedChunks);
    assert.deepEqual(chunks.flat(), Array.from({ length: count }, (_, index) => index));
    assert.ok(chunks.every((chunk) => chunk.length <= 50));
  });
}

test('批量操作标识必须存在且长度受限', () => {
  assert.equal(normalizeBatchOperationId(' operation-1 '), 'operation-1');
  assert.throws(() => normalizeBatchOperationId(''));
  assert.throws(() => normalizeBatchOperationId('x'.repeat(121)));
});

test('字段类型转换复用单条写入规则，多选标量转换为数组', () => {
  const normalized = normalizeFeishuFieldsWithTypes(
    { 内容类型: '房车', 频道名: 'Demo' },
    new Map([['内容类型', 4], ['频道名', 1]]),
  );
  assert.deepEqual(normalized, { 内容类型: ['房车'], 频道名: 'Demo' });
  assert.throws(() => normalizeFeishuFieldsWithTypes(
    { 已删除字段: '值' },
    new Map([['频道名', 1]]),
  ));
});

test('飞书复选框字段保留布尔值用于单条状态写回', () => {
  const normalized = normalizeFeishuFieldsWithTypes(
    { 物流信息已告知: true, 折扣信息已告知: false },
    new Map([['物流信息已告知', 7], ['折扣信息已告知', 7]]),
  );
  assert.deepEqual(normalized, {
    物流信息已告知: true,
    折扣信息已告知: false,
  });
});

test('飞书写入阻止意外字符串化的对象文本', () => {
  assert.throws(
    () => normalizeFeishuFieldsWithTypes(
      { 联系邮箱: '[object Object]\ncreator@example.com' },
      new Map([['联系邮箱', 1]]),
    ),
    /已阻止写入/,
  );
  assert.throws(
    () => normalizeFeishuFieldsWithTypes(
      { 频道链接: { text: '[object Object]', link: 'https://youtube.com/@creator' } },
      new Map([['频道链接', 15]]),
    ),
    /频道链接/,
  );
});
