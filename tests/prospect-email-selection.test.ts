import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyManualProspectEmail,
  buildProspectEmailCandidates,
  normalizeProspectEmailCandidates,
  prospectEmailSelectionMessage,
  selectProspectEmailCandidate,
  updateProspectEmailCandidates,
} from '../src/lib/prospect-email-selection';
import {
  canCreateFeishuRecord,
  migrateProspects,
  type Prospect,
} from '../src/lib/creator-prospecting';

test('YouTube 单邮箱会自动填写', () => {
  const result = updateProspectEmailCandidates(
    { emailStatus: 'missing' },
    buildProspectEmailCandidates('creator@example.com', 'youtube'),
    { replaceSources: ['youtube'] },
  );
  assert.equal(result.publicEmail, 'creator@example.com');
  assert.equal(result.emailSource, 'youtube');
  assert.equal(result.emailSelectionRequired, false);
});

test('飞书单邮箱会在当前为空时自动填写', () => {
  const result = updateProspectEmailCandidates(
    { emailStatus: 'missing' },
    buildProspectEmailCandidates({ text: '合作邮箱', link: 'mailto:team@example.com' }, 'resource'),
    { replaceSources: ['resource'] },
  );
  assert.equal(result.publicEmail, 'team@example.com');
  assert.equal(result.emailSource, 'resource');
});

test('相同邮箱忽略大小写合并来源', () => {
  const candidates = normalizeProspectEmailCandidates([
    { email: 'Creator@Example.com', sources: ['youtube'] },
    { email: 'creator@example.com', sources: ['resource'] },
  ]);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].sources, ['resource', 'youtube']);
});

test('YouTube 与飞书邮箱不同会要求人工选择且不覆盖当前值', () => {
  const result = updateProspectEmailCandidates(
    {
      publicEmail: 'youtube@example.com',
      emailStatus: 'available',
      emailSource: 'youtube',
      emailCandidates: [{ email: 'youtube@example.com', sources: ['youtube'] }],
    },
    buildProspectEmailCandidates('resource@example.com', 'resource'),
    { replaceSources: ['resource'] },
  );
  assert.equal(result.publicEmail, 'youtube@example.com');
  assert.equal(result.emailSelectionRequired, true);
  assert.equal(prospectEmailSelectionMessage(result), '发现不同来源邮箱，请选择');
});

test('飞书多邮箱和双表邮箱会合并并提示选择', () => {
  const result = updateProspectEmailCandidates(
    { emailStatus: 'missing' },
    [
      ...buildProspectEmailCandidates('first@example.com; second@example.com', 'resource'),
      ...buildProspectEmailCandidates(['second@example.com', 'history@example.com'], 'development'),
    ],
    { replaceSources: ['resource', 'development'] },
  );
  assert.equal(result.emailCandidates?.length, 3);
  assert.equal(result.emailSelectionRequired, true);
  assert.equal(prospectEmailSelectionMessage(result), '表格中有多个邮箱，请选择');
});

test('手动修改和清空都会锁定，后续自动来源不能覆盖', () => {
  const manual = applyManualProspectEmail({ emailStatus: 'missing' }, 'mine@example.com');
  const refreshed = updateProspectEmailCandidates(
    manual,
    buildProspectEmailCandidates('youtube@example.com', 'youtube'),
    { replaceSources: ['youtube'] },
  );
  assert.equal(refreshed.publicEmail, 'mine@example.com');
  assert.equal(refreshed.emailSelectionRequired, false);

  const cleared = applyManualProspectEmail(refreshed, '');
  const deduped = updateProspectEmailCandidates(
    cleared,
    buildProspectEmailCandidates('resource@example.com', 'resource'),
    { replaceSources: ['resource'] },
  );
  assert.equal(deduped.publicEmail, '');
  assert.equal(deduped.emailManuallyLocked, true);
});

test('手动选择候选邮箱后写入邮箱框并锁定', () => {
  const selected = selectProspectEmailCandidate({
    publicEmail: 'youtube@example.com',
    emailStatus: 'available',
    emailSource: 'youtube',
    emailCandidates: [
      { email: 'youtube@example.com', sources: ['youtube'] },
      { email: 'resource@example.com', sources: ['resource'] },
    ],
    emailSelectionRequired: true,
  }, 'resource@example.com');
  assert.equal(selected.publicEmail, 'resource@example.com');
  assert.equal(selected.emailManuallyLocked, true);
  assert.equal(selected.emailSelectionRequired, false);
});

test('旧版手动邮箱迁移后会自动获得人工保护', () => {
  const [prospect] = migrateProspects([{
    schemaVersion: 6,
    id: 'legacy-manual',
    inputUrl: 'https://www.youtube.com/@legacy',
    publicEmail: 'manual@example.com',
    emailStatus: 'manual',
    workflowStatus: 'resolved',
    dedupeStatus: 'unique',
    resourceStatus: 'missing',
    developmentStatus: 'missing',
  }]);
  assert.equal(prospect.emailSource, 'manual');
  assert.equal(prospect.emailManuallyLocked, true);
});

test('存在待选择邮箱时不能创建飞书开发记录', () => {
  const prospect = {
    schemaVersion: 7,
    id: 'blocked',
    inputUrl: 'https://www.youtube.com/@blocked',
    workflowStatus: 'resolved',
    emailStatus: 'available',
    emailSelectionRequired: true,
    dedupeStatus: 'unique',
    resourceStatus: 'missing',
    developmentStatus: 'missing',
    competitorCollaboration: 'unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies Prospect;
  assert.equal(canCreateFeishuRecord(prospect), false);
});
