import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProspects } from '../src/lib/creator-prospecting';
import { executeProspectWriteTask, recoverProspectWriteTask, writeTaskContextMatches, type ProspectWriteTask } from '../src/lib/prospect-feishu-write';

function task(): ProspectWriteTask {
  return { id: 'op', scope: 'user-a', resourceUrl: 'resource', developmentUrl: 'development', mappingSignature: 'mapping', kind: 'quick', status: 'pending', steps: [
    { key: 'resource', action: 'batchCreate', operationId: 'op:resource', url: 'resource', fields: { name: 'Creator' }, status: 'pending' },
    { key: 'development', action: 'batchCreate', operationId: 'op:development', url: 'development', fields: { name: 'Creator' }, status: 'pending' },
  ] };
}
function io() {
  const writes: string[] = []; const saved: ProspectWriteTask[] = [];
  return { writes, saved, current: () => true, validate: async () => undefined as string | undefined,
    save: (value: ProspectWriteTask) => { saved.push(structuredClone(value)); }, applied: () => {},
    write: async (step: ProspectWriteTask['steps'][number]) => { writes.push(step.operationId); return { clientId: 'p', status: 'success' as const, recordId: `rec-${step.key}` }; } };
}
test('正常顺序完成并在每次写入前持久保存任务', async () => {
  const port = io(); const result = await executeProspectWriteTask(task(), port);
  assert.equal(result.status, 'success'); assert.deepEqual(port.writes, ['op:resource', 'op:development']);
  assert.equal(port.saved[0].steps[0].status, 'writing');
});
test('明确失败重试只执行未完成步骤，操作标识不变', async () => {
  const port = io(); const original = port.write;
  const partial = await executeProspectWriteTask(task(), { ...port, write: async (step) => step.key === 'development'
    ? { clientId: 'p', status: 'failed', outcomeCertain: true, error: 'invalid field' } : original(step) });
  assert.equal(partial.steps[0].status, 'success'); assert.equal(partial.status, 'failed');
  const result = await executeProspectWriteTask(partial, port);
  assert.equal(result.status, 'success'); assert.deepEqual(port.writes, ['op:resource', 'op:development']);
});
test('提交后网络中断不会自动重建', async () => {
  const port = io();
  const result = await executeProspectWriteTask(task(), { ...port, write: async () => { throw new Error('timeout'); } });
  assert.equal(result.status, 'unknown');
  await executeProspectWriteTask(result, port); assert.deepEqual(port.writes, []);
});
test('旧接口失败未明确结果时也按待核实处理', async () => {
  const result = await executeProspectWriteTask(task(), { ...io(), write: async () => ({ clientId: 'p', status: 'failed', error: 'unknown' }) });
  assert.equal(result.status, 'unknown');
});
test('重复冲突阻止写入并进入待确认', async () => {
  const port = io(); const result = await executeProspectWriteTask(task(), { ...port, validate: async () => '关联已变化' });
  assert.equal(result.status, 'review'); assert.deepEqual(port.writes, []);
});
test('账号切换阻止后续步骤及迟到结果落入新账号', async () => {
  const port = io(); let active = true;
  const result = await executeProspectWriteTask(task(), { ...port, current: () => active, write: async (step) => { active = false; return port.write(step); } });
  assert.equal(result.steps[0].status, 'writing'); assert.equal(port.writes.length, 1); assert.equal(port.saved.length, 1);
});
test('本地保存失败时不发送请求', async () => {
  const port = io(); await assert.rejects(executeProspectWriteTask(task(), { ...port, save: () => { throw new Error('quota'); } }));
  assert.deepEqual(port.writes, []);
});
test('刷新恢复写入中为待核实，未发送阶段不当作成功', () => {
  const original = task(); original.status = 'writing'; original.steps[0].status = 'writing';
  const result = recoverProspectWriteTask(original)!;
  assert.equal(result.status, 'unknown'); assert.equal(result.steps[0].status, 'unknown'); assert.equal(result.steps[1].status, 'pending');
});
test('目标表、映射和账号隔离', () => {
  const original = task(); assert.equal(writeTaskContextMatches(original, original), true);
  for (const field of ['scope', 'resourceUrl', 'developmentUrl', 'mappingSignature'] as const) {
    assert.equal(writeTaskContextMatches(original, { ...original, [field]: 'changed' }), false);
  }
});

test('成功日志已保存但界面更新中断，恢复记录编号且不重复创建', async () => {
  const port = io();
  await assert.rejects(executeProspectWriteTask(task(), { ...port, applied: () => { throw new Error('unmounted'); } }));
  const durable = port.saved.at(-1)!;
  assert.equal(durable.steps[0].status, 'success');
  const [restored] = migrateProspects([{ schemaVersion: 7, id: 'p', inputUrl: 'https://youtube.com/@creator', workflowStatus: 'resolved', feishuWriteTask: durable }]);
  assert.equal(restored.resourceRecordId, 'rec-resource');
  assert.equal(restored.resourceStatus, 'exists');
  await executeProspectWriteTask(restored.feishuWriteTask!, port);
  assert.deepEqual(port.writes, ['op:resource', 'op:development']);
});

test('已成功开发记录从任务日志恢复后允许进入邀约确认', () => {
  const journal = task(); journal.steps[1].status = 'success'; journal.steps[1].recordId = 'rec-development';
  const [restored] = migrateProspects([{ schemaVersion: 7, id: 'p', inputUrl: 'https://youtube.com/@creator', workflowStatus: 'resolved', feishuWriteTask: journal }]);
  assert.equal(restored.feishuRecordId, 'rec-development');
  assert.equal(restored.workflowStatus, 'dedupe_completed');
});

test('请求成功但保存日志失败，刷新后必须核实而不是重建', async () => {
  const port = io();
  await assert.rejects(executeProspectWriteTask(task(), { ...port, save: value => {
    if (value.steps[0].status === 'success') throw new Error('quota');
    port.save(value);
  } }));
  const recovered = recoverProspectWriteTask(port.saved.at(-1))!;
  assert.equal(recovered.status, 'unknown');
  await executeProspectWriteTask(recovered, port);
  assert.deepEqual(port.writes, ['op:resource']);
});
