import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAccountFailure,
  classifyAuthVerificationError,
  isTransientAccountStatus,
  shouldPreserveLastAccount,
  shouldRefreshAccountSession,
} from '../src/lib/account-load-state';

test('账号失败状态区分明确权限拒绝和临时服务异常', () => {
  assert.equal(classifyAccountFailure(401), 'invalid');
  assert.equal(classifyAccountFailure(403), 'invalid');
  assert.equal(classifyAccountFailure(408), 'unavailable');
  assert.equal(classifyAccountFailure(429), 'unavailable');
  assert.equal(classifyAccountFailure(500), 'unavailable');
  assert.equal(classifyAccountFailure(503), 'unavailable');
});

test('账号临时异常只包含超时、限流和服务端错误', () => {
  assert.equal(isTransientAccountStatus(400), false);
  assert.equal(isTransientAccountStatus(401), false);
  assert.equal(isTransientAccountStatus(403), false);
  assert.equal(isTransientAccountStatus(408), true);
  assert.equal(isTransientAccountStatus(425), true);
  assert.equal(isTransientAccountStatus(429), true);
  assert.equal(isTransientAccountStatus(502), true);
});

test('令牌校验未知错误按服务异常处理，只有明确客户端错误才判定失效', () => {
  assert.equal(classifyAuthVerificationError(undefined), 'unavailable');
  assert.equal(classifyAuthVerificationError(0), 'unavailable');
  assert.equal(classifyAuthVerificationError(500), 'unavailable');
  assert.equal(classifyAuthVerificationError(401), 'invalid');
  assert.equal(classifyAuthVerificationError(403), 'invalid');
});

test('只有会话确实失效时刷新令牌，账号停用和临时网络错误不会触发刷新循环', () => {
  assert.equal(shouldRefreshAccountSession('invalid', 'SESSION_INVALID'), true);
  assert.equal(shouldRefreshAccountSession('invalid', 'ACCOUNT_DISABLED'), false);
  assert.equal(shouldRefreshAccountSession('invalid', 'ACCOUNT_NOT_PROVISIONED'), false);
  assert.equal(shouldRefreshAccountSession('unavailable', 'ACCOUNT_SERVICE_UNAVAILABLE'), false);
});

test('只在同一账号发生临时异常时保留上一次已确认资料', () => {
  assert.equal(shouldPreserveLastAccount('unavailable', 'member-a', 'member-a'), true);
  assert.equal(shouldPreserveLastAccount('invalid', 'member-a', 'member-a'), false);
  assert.equal(shouldPreserveLastAccount('unavailable', 'member-a', 'member-b'), false);
  assert.equal(shouldPreserveLastAccount('unavailable', null, 'member-a'), false);
});
