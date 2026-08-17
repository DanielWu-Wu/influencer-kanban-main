import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareAppVersions,
  getUnseenAppReleases,
  isValidAppVersion,
  type AppRelease,
} from '../src/lib/app-release';

const releases: AppRelease[] = [
  { version: '1.3.0', releasedAt: '2026-08-03', title: '第三版', highlights: ['三'] },
  { version: '1.1.0', releasedAt: '2026-08-01', title: '第一版', highlights: ['一'] },
  { version: '1.2.0', releasedAt: '2026-08-02', title: '第二版', highlights: ['二'] },
];

test('版本号按主版本、次版本和修订版本比较', () => {
  assert.ok(compareAppVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareAppVersions('2.0.0', '1.99.99') > 0);
  assert.equal(compareAppVersions('1.1.0', '1.1.0'), 0);
});

test('没有已读记录时在同一个提醒中返回全部版本', () => {
  assert.deepEqual(
    getUnseenAppReleases(null, releases).map((release) => release.version),
    ['1.3.0', '1.2.0', '1.1.0'],
  );
});

test('只汇总最后已读版本之后的更新', () => {
  assert.deepEqual(
    getUnseenAppReleases('1.1.0', releases).map((release) => release.version),
    ['1.3.0', '1.2.0'],
  );
});

test('已经看过最新版本或回滚到旧版本时不再提醒', () => {
  assert.deepEqual(getUnseenAppReleases('1.3.0', releases), []);
  assert.deepEqual(getUnseenAppReleases('1.4.0', releases), []);
});

test('异常的已读版本记录会安全跳过提醒', () => {
  assert.equal(isValidAppVersion('1.2.3'), true);
  assert.equal(isValidAppVersion('release-latest'), false);
  assert.deepEqual(getUnseenAppReleases('release-latest', releases), []);
});
