import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMappedFeishuChannelUrl } from '../src/lib/feishu-field-value';

test('从飞书超链接对象提取真实 YouTube 频道地址而不是显示文字', () => {
  const url = extractMappedFeishuChannelUrl({
    红人频道: {
      text: 'Maya Feliz',
      link: 'https://www.youtube.com/@mayafeliz',
    },
  }, {
    channelUrl: '红人频道',
  });

  assert.equal(url, 'https://www.youtube.com/@mayafeliz');
});

test('频道链接字段为空时可从频道名称超链接中提取地址', () => {
  const url = extractMappedFeishuChannelUrl({
    频道链接: '',
    频道名称: {
      text: 'Tripping Around',
      link: 'https://www.youtube.com/channel/UC123456789',
    },
  }, {
    channelUrl: '频道链接',
    channelName: '频道名称',
  });

  assert.equal(url, 'https://www.youtube.com/channel/UC123456789');
});
