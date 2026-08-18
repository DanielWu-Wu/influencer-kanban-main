import assert from 'node:assert/strict';
import { wrapGmailDefaultEmailHtml } from '../src/lib/gmail-compose-html';

{
  const html = wrapGmailDefaultEmailHtml('Hola<br>Daniel');

  assert.equal(html, '<div style="word-break:break-word">Hola<br>Daniel</div>');
  assert.doesNotMatch(html, /font-family|font-size|line-height|color/i);
}

{
  const formatted = '<span style="font-family:Georgia;font-size:18px;color:#c62828;font-weight:bold">Hola</span>';
  const html = wrapGmailDefaultEmailHtml(formatted);

  assert.match(html, /font-family:Georgia/);
  assert.match(html, /font-size:18px/);
  assert.match(html, /color:#c62828/);
  assert.match(html, /font-weight:bold/);
}

console.log('gmail-compose-html tests passed');
