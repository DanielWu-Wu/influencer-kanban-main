import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAdvanceProspectingStage } from '../src/lib/creator-prospecting';

test('当前阶段只有一个待处理红人且已处理时进入下一阶段', () => {
  assert.equal(shouldAdvanceProspectingStage(['creator-a'], ['creator-a']), true);
});

test('当前阶段仍有其他待处理红人时停留在当前阶段', () => {
  assert.equal(
    shouldAdvanceProspectingStage(['creator-a', 'creator-b'], ['creator-a']),
    false,
  );
});

test('批量处理完当前阶段全部红人时进入下一阶段', () => {
  assert.equal(
    shouldAdvanceProspectingStage(
      ['creator-a', 'creator-b'],
      ['creator-a', 'creator-b'],
    ),
    true,
  );
});

test('无待处理项或处理的是其他阶段记录时不会跳转', () => {
  assert.equal(shouldAdvanceProspectingStage([], ['creator-a']), false);
  assert.equal(shouldAdvanceProspectingStage(['creator-a'], []), false);
  assert.equal(shouldAdvanceProspectingStage(['creator-a'], ['creator-b']), false);
});
