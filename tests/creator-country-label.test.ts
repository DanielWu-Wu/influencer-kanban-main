import assert from 'node:assert/strict';
import test from 'node:test';
import { countryLabel } from '../src/lib/creator-prospecting';

const EUROPE_COUNTRY_CODES = [
  'AD', 'AL', 'AM', 'AT', 'AX', 'AZ', 'BA', 'BE', 'BG', 'BY',
  'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FO', 'FR',
  'GB', 'GE', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM', 'IS',
  'IT', 'JE', 'KZ', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME',
  'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE',
  'SI', 'SJ', 'SK', 'SM', 'TR', 'UA', 'UK', 'VA', 'XK',
];

test('建档地区将乌克兰和罗马尼亚代码转换为中文国家名', () => {
  assert.equal(countryLabel('UA'), '乌克兰');
  assert.equal(countryLabel('ro'), '罗马尼亚');
});

test('未手写配置的 ISO 国家代码也通过国际化标准转换为中文', () => {
  assert.equal(countryLabel('MX'), '墨西哥');
  assert.equal(countryLabel('SG'), '新加坡');
});

test('欧洲国家与常见欧洲地区代码全部输出中文名称', () => {
  for (const code of EUROPE_COUNTRY_CODES) {
    const label = countryLabel(code);
    assert.notEqual(label, code, `${code} 不应原样输出国家代码`);
    assert.match(label, /\p{Script=Han}/u, `${code} 应转换为中文国家名`);
  }
});

test('地区转换兼容空值和已经是中文的国家名', () => {
  assert.equal(countryLabel(), '未知');
  assert.equal(countryLabel(' 乌克兰 '), '乌克兰');
});
