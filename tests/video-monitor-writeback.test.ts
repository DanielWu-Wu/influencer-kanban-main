import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoWritePlan, sameVideoWriteFields, type VideoWriteData } from '../src/lib/video-monitor-writeback';
const mapping = { actualPublishDate: '日期', publishedVideoUrl: '链接', exposureCount: '播放', commentCount: '评论', likeCount: '点赞' };
const types = new Map([['日期', 5], ['链接', 15], ['播放', 2], ['评论', 2], ['点赞', 2]]);
const video: VideoWriteData = { id: 'abcdefghijk', channelId: 'channel', title: '测试', publishedAt: '2026-08-07T17:18:24Z', statistics: { viewCount: '100', commentCount: '0', likeCount: '12' } };
test('视频写回：5字段映射，北京时间日期，零评论有效，其他字段不受影响', () => {
  const plan = buildVideoWritePlan(mapping, types, { 其他: '保留' }, video);
  assert.deepEqual(plan.write, { 日期: Date.parse('2026-08-08T00:00:00+08:00'), 链接: { text: 'https://www.youtube.com/watch?v=abcdefghijk', link: 'https://www.youtube.com/watch?v=abcdefghijk' }, 播放: 100, 评论: 0, 点赞: 12 });
  assert.equal(plan.rows[0].after, '2026-08-08');
  assert.equal(Object.keys(plan.original).length, 5);
});
test('视频写回：缺失统计、负数、超安全整数不写0且保留原值', () => {
  const plan = buildVideoWritePlan(mapping, types, { 播放: 99, 评论: 6, 点赞: 7 }, { ...video, statistics: { commentCount: '-1', likeCount: '999999999999999999' } });
  assert.equal(plan.write.播放, undefined);
  assert.equal(plan.write.评论, undefined);
  assert.equal(plan.write.点赞, undefined);
  assert.equal(plan.rows.filter(row => row.skip).length, 3);
});
test('视频写回：不同视频、未知非空链接阻止覆盖，同视频短链接允许更新', () => {
  assert.throws(() => buildVideoWritePlan(mapping, types, { 链接: { text: '旧视频', link: 'https://youtu.be/lmnopqrstuv' } }, video), /不同/);
  assert.throws(() => buildVideoWritePlan(mapping, types, { 链接: 'https://example.com' }, video), /不同/);
  assert.doesNotThrow(() => buildVideoWritePlan(mapping, types, { 链接: { text: '视频', link: 'https://youtu.be/abcdefghijk' } }, video));
});
test('视频写回：缺失、重复、错误类型映射拒绝写入，文本类型正确转换', () => {
  assert.throws(() => buildVideoWritePlan({ ...mapping, likeCount: '' }, types, {}, video), /映射/);
  assert.throws(() => buildVideoWritePlan({ ...mapping, likeCount: '评论' }, types, {}, video), /映射/);
  assert.throws(() => buildVideoWritePlan(mapping, new Map([...types, ['日期', 20]]), {}, video), /类型/);
  const plan = buildVideoWritePlan(mapping, new Map(Object.values(mapping).map(field => [field, 1])), {}, video);
  assert.equal(plan.write.播放, '100');
  assert.equal(plan.write.日期, '2026-08-08');
});
test('视频写回：回读兼容文本数组、超链接标签，识别原值变更', () => {
  assert.equal(sameVideoWriteFields({ 文本: [{ text: '100' }], 链接: { text: '视频标题', link: 'https://youtu.be/abcdefghijk' } }, { 文本: '100', 链接: { text: '链接', link: 'https://youtu.be/abcdefghijk' } }), true);
  assert.equal(sameVideoWriteFields({ 评论: 0 }, { 评论: null }), false);
  assert.equal(sameVideoWriteFields({}, { 评论: null }), true);
});
