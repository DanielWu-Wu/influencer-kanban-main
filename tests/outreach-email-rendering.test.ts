import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOutreachEmailEditorHtml,
  buildOutreachEmailHtml,
  type OutreachEmailProductAsset,
} from '../src/lib/outreach-email-rendering';

const product: OutreachEmailProductAsset = {
  name: 'AFERIY',
  model: 'NOMAD 1800 Pro',
  productUrl: 'https://example.com/nomad-1800-pro',
  mainImage: {
    fileName: 'nomad-1800-pro.png',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,PRODUCT_IMAGE',
  },
};

const body = [
  'Hola Carlos:',
  'Nuestro NOMAD 1800 Pro es una estación de energía portátil.',
  '¿Te gustaría probarla?',
].join('\n\n');

function productImageCount(html: string) {
  return html.match(/data-product-image="true"/g)?.length || 0;
}

test('可编辑开发信正文只显示一张受保护的产品主图', () => {
  const html = buildOutreachEmailEditorHtml({
    body,
    product,
    imageSrc: product.mainImage?.dataUrl,
    imagePlacement: 1,
    includeImage: true,
  });

  assert.equal(productImageCount(html), 1);
  assert.match(html, /data-product-image="true" contenteditable="false" draggable="true"/);
  assert.match(html, /src="data:image\/png;base64,PRODUCT_IMAGE"/);
  assert.match(html, /href="https:\/\/example\.com\/nomad-1800-pro"/);
});

test('编辑区按开头、段落后和末尾位置渲染产品主图', () => {
  const atStart = buildOutreachEmailEditorHtml({
    body,
    product,
    imageSrc: product.mainImage?.dataUrl,
    imagePlacement: 0,
    includeImage: true,
  });
  const afterFirstParagraph = buildOutreachEmailEditorHtml({
    body,
    product,
    imageSrc: product.mainImage?.dataUrl,
    imagePlacement: 1,
    includeImage: true,
  });
  const atEnd = buildOutreachEmailEditorHtml({
    body,
    product,
    imageSrc: product.mainImage?.dataUrl,
    imagePlacement: 3,
    includeImage: true,
  });

  assert.ok(atStart.indexOf('data-product-image="true"') < atStart.indexOf('Hola Carlos:'));
  assert.ok(afterFirstParagraph.indexOf('Hola Carlos:') < afterFirstParagraph.indexOf('data-product-image="true"'));
  assert.ok(afterFirstParagraph.indexOf('data-product-image="true"') < afterFirstParagraph.indexOf('Nuestro'));
  assert.ok(atEnd.indexOf('data-product-image="true"') > atEnd.indexOf('¿Te gustaría probarla?'));
});

test('不插图时编辑区保持纯正文', () => {
  const html = buildOutreachEmailEditorHtml({
    body,
    product,
    imageSrc: product.mainImage?.dataUrl,
    imagePlacement: 1,
    includeImage: false,
  });

  assert.equal(productImageCount(html), 0);
  assert.doesNotMatch(html, /contenteditable="false"/);
});

test('最终邮箱草稿继续使用单张 CID 图片且不带编辑器属性', () => {
  const html = buildOutreachEmailHtml({
    body,
    product,
    imageSrc: 'cid:product-main-image',
    imagePlacement: 1,
    includeImage: true,
  });

  assert.equal(productImageCount(html), 1);
  assert.match(html, /src="cid:product-main-image"/);
  assert.doesNotMatch(html, /data:image\/png;base64,PRODUCT_IMAGE/);
  assert.doesNotMatch(html, /contenteditable="false"/);
});
