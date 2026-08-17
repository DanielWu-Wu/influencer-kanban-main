import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampGmailThreadListWidth,
  getGmailThreadListDoubleClickWidth,
  getGmailThreadListMaxWidth,
  GMAIL_THREAD_LIST_DEFAULT_WIDTH,
  GMAIL_THREAD_LIST_MIN_WIDTH,
  isGmailThreadListAvatarOnly,
  parseStoredGmailThreadListWidth,
} from '../src/lib/gmail-pane-layout';

test('Gmail 线程列表宽度受最小值、详情区和大屏最大值约束', () => {
  assert.equal(clampGmailThreadListWidth(20, 1_600), GMAIL_THREAD_LIST_MIN_WIDTH);
  assert.equal(clampGmailThreadListWidth(900, 1_600), 680);
  assert.equal(getGmailThreadListMaxWidth(900), 420);
  assert.equal(clampGmailThreadListWidth(460, 900), 420);
});

test('Gmail 线程列表进入窄栏后只显示头像', () => {
  assert.equal(isGmailThreadListAvatarOnly(239), true);
  assert.equal(isGmailThreadListAvatarOnly(240), false);
});

test('Gmail 线程列表宽度存储异常时回到默认宽度', () => {
  assert.equal(parseStoredGmailThreadListWidth('512'), 512);
  assert.equal(parseStoredGmailThreadListWidth('not-a-number'), GMAIL_THREAD_LIST_DEFAULT_WIDTH);
  assert.equal(parseStoredGmailThreadListWidth(null), GMAIL_THREAD_LIST_DEFAULT_WIDTH);
});

test('Gmail 线程列表双击在最小宽度和默认宽度之间切换', () => {
  assert.equal(
    getGmailThreadListDoubleClickWidth(GMAIL_THREAD_LIST_DEFAULT_WIDTH),
    GMAIL_THREAD_LIST_MIN_WIDTH,
  );
  assert.equal(getGmailThreadListDoubleClickWidth(512), GMAIL_THREAD_LIST_MIN_WIDTH);
  assert.equal(getGmailThreadListDoubleClickWidth(9_999), GMAIL_THREAD_LIST_MIN_WIDTH);
  assert.equal(
    getGmailThreadListDoubleClickWidth(GMAIL_THREAD_LIST_MIN_WIDTH),
    GMAIL_THREAD_LIST_DEFAULT_WIDTH,
  );
  assert.equal(getGmailThreadListDoubleClickWidth(-1), GMAIL_THREAD_LIST_DEFAULT_WIDTH);
});
