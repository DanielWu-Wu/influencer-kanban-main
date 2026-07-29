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
