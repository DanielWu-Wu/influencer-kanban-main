import assert from 'node:assert/strict';
import test from 'node:test';
import { simpleParser } from 'mailparser';
import { readGmailMessageBody, resolveMailTranslationBody, isUsableMailTranslation } from '../src/lib/mail-translation-body';
import { findUsableEmailTranslation } from '../src/lib/email-translations';
import { buildDailyMailPreview } from '../src/lib/daily-mail-preview';
import { selectTencentTranslationBodyPart } from '../src/lib/tencent-translation-body';
import { requestGmailTranslation, clearGmailTranslationRequests } from '../src/lib/gmail-translation-prefetch';

const textPart = (text: string, mimeType = 'text/plain') => ({
  mimeType, body: { data: Buffer.from(text).toString('base64url') },
});
const original = 'Hola Daniel,\r\nTe envío el contrato firmado.\r\n\r\nSaludos\r\n';

test('Gmail 待办和详情共用 MIME 正文，忽略空白差异但不忽略真正修改', () => {
  const payload = { mimeType: 'multipart/alternative', parts: [textPart(original), textPart('<p>Hola</p>', 'text/html')] };
  const daily = readGmailMessageBody(payload).body;
  const detail = readGmailMessageBody(payload).body;
  const saved = { id: 't', messageId: 'user::gmail:me::1', originalText: daily, translatedText: '你好，已发送签署的合同。', targetLang: 'zh', createdAt: '' };
  assert.equal(daily, detail);
  assert.ok(findUsableEmailTranslation([saved], [saved.messageId], `\n${detail}\r\n`));
  assert.equal(findUsableEmailTranslation([saved], [saved.messageId], detail.replace('contrato', 'precio')), undefined);
  assert.equal(findUsableEmailTranslation([saved], ['other::gmail:me::1'], detail), undefined);
  assert.equal(findUsableEmailTranslation([saved], ['user::tencent:me::1'], detail), undefined);
  assert.equal(findUsableEmailTranslation([saved], ['user::gmail:other::1'], detail), undefined);
});

test('Gmail HTML-only 正文和文本附件不会污染翻译依据', () => {
  const html = '<div>Hola&nbsp;Daniel</div><p>Contrato &amp; precio: 100 €</p>';
  const actual = readGmailMessageBody({ parts: [textPart(html, 'text/html'), { ...textPart('attachment secret'), filename: 'notes.txt' }] }).body;
  assert.equal(actual, resolveMailTranslationBody('', html));
  assert.ok(actual.includes('100 €'));
  assert.ok(!actual.includes('attachment'));
});

test('腾讯 IMAP 文本与完整 MIME 解析统一，保留超过 12000 字的正文和换行', async () => {
  const long = original + 'Propuesta de colaboración.\r\n'.repeat(800) + 'Precio final: 250 €';
  const parsed = await simpleParser(Buffer.from(`Content-Type: text/plain; charset=utf-8\r\n\r\n${long}`), { skipHtmlToText: true });
  const daily = resolveMailTranslationBody(long);
  assert.equal(daily, resolveMailTranslationBody(parsed.text || '', String(parsed.html || '')));
  assert.ok(daily.length > 12_000 && daily.endsWith('250 €'));
  assert.ok(daily.includes('\n\nSaludos'));
});

test('腾讯 HTML-only 待办与详情生成同样的完整原文', async () => {
  const html = '<html><body><p>Hola Daniel</p><p>He recibido el producto.</p></body></html>';
  const parsed = await simpleParser(Buffer.from(`Content-Type: text/html; charset=utf-8\r\n\r\n${html}`), { skipHtmlToText: true });
  assert.equal(resolveMailTranslationBody('', html), resolveMailTranslationBody(parsed.text || '', String(parsed.html || '')));
});

test('空译文和原样返回的外语不能标记中文已备好', () => {
  assert.equal(isUsableMailTranslation('Hola Daniel', ''), false);
  assert.equal(isUsableMailTranslation('Hola Daniel', 'Hola Daniel'), false);
  assert.equal(isUsableMailTranslation('Hola Daniel', '【当前邮件翻译】\nHola Daniel'), false);
  assert.equal(isUsableMailTranslation('Hola Daniel', '你好 Daniel'), true);
});

test('腾讯复杂正文不能只取第一段；单段邮件没有 part 编号时回退完整 MIME', () => {
  assert.equal(selectTencentTranslationBodyPart({ type: 'text/plain' }), undefined);
  assert.equal(selectTencentTranslationBodyPart({ type: 'text/plain', part: '1', parameters: { format: 'flowed' } }), undefined);
  const plain = { type: 'text/plain', part: '1.1' };
  assert.equal(selectTencentTranslationBodyPart({ type: 'multipart/alternative', childNodes: [plain, { type: 'text/html', part: '1.2' }] }), plain);
  assert.equal(selectTencentTranslationBodyPart({ type: 'multipart/mixed', childNodes: [plain, { type: 'text/plain', part: '2' }] }), undefined);
  assert.equal(selectTencentTranslationBodyPart({ type: 'multipart/mixed', childNodes: [plain, { type: 'text/plain', part: '2', disposition: 'attachment' }] }), plain);
});

test('待办预览仅接受同账号、同 provider、同线程和同邮件的真实正文', () => {
  const snapshot = { provider: 'gmail' as const, mailAccountId: 'gmail:me', mailAddress: 'me@example.com', messageId: '1', threadId: 'th', from: 'creator@example.com', subject: '合同', body: original, date: '2026-09-01T00:00:00Z' };
  assert.equal(buildDailyMailPreview(snapshot, [snapshot])?.isPartial, true);
  assert.equal(buildDailyMailPreview({ ...snapshot, mailAccountId: 'other' }, [snapshot]), undefined);
  assert.equal(buildDailyMailPreview({ ...snapshot, messageId: '2' }, [snapshot]), undefined);
  assert.equal(buildDailyMailPreview(snapshot, [{ ...snapshot, body: '' }]), undefined);
});

test('后台 2 个槽与前台 1 个槽总并发不超过 3，前台复用已排队的同一封', async () => {
  clearGmailTranslationRequests();
  const originalFetch = globalThis.fetch;
  const release: Array<() => void> = [];
  let requests = 0;
  let active = 0;
  let maximum = 0;
  globalThis.fetch = async () => {
    requests += 1;
    maximum = Math.max(maximum, ++active);
    await new Promise<void>((resolve) => release.push(resolve));
    active -= 1;
    return new Response(JSON.stringify({ success: true, data: { translatedText: '合同已签署', sourceLang: 'es' } }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const options = { scopeKey: 'isolated::gmail:a', text: 'Contrato firmado', sourceText: original, settings: {} };
    const tasks = ['1', '2', '3'].map((messageId) => requestGmailTranslation({ ...options, messageId, priority: 'background' }));
    assert.equal(requests, 2);
    const foreground = requestGmailTranslation({ ...options, messageId: '3', priority: 'foreground' });
    assert.equal(foreground, tasks[2]);
    const extra = requestGmailTranslation({ ...options, messageId: '4', priority: 'foreground' });
    assert.equal(requests, 3);
    for (let i = 0; i < 5; i += 1) {
      release.splice(0).forEach((resolve) => resolve());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all([...tasks, extra]);
    assert.equal(maximum, 3);
    assert.equal(requests, 4);
    await requestGmailTranslation({ ...options, messageId: '3' });
    assert.equal(requests, 4, '刚结束的同一任务不能再次请求');
  } finally {
    release.splice(0).forEach((resolve) => resolve());
    globalThis.fetch = originalFetch;
    clearGmailTranslationRequests();
  }
});

test('空中文结果拒绝缓存，正文变化不能复用同一请求', async () => {
  clearGmailTranslationRequests();
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {
    count += 1;
    return new Response(JSON.stringify({ success: true, data: { translatedText: count === 1 ? '' : '你好', sourceLang: 'es' } }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const input = { scopeKey: 'isolated::gmail:a', messageId: 'm', text: 'Hola', sourceText: 'Hola\nOn Tue: old quote', settings: {} };
    await assert.rejects(requestGmailTranslation(input), /有效中文/);
    await requestGmailTranslation(input);
    await requestGmailTranslation({ ...input, sourceText: 'Hola\nOn Tue: changed quote' });
    assert.equal(count, 3);
  } finally { globalThis.fetch = originalFetch; clearGmailTranslationRequests(); }
});
