export function encodeUtf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join('\r\n') || '';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function linkifyEmailText(value: string) {
  const withMarkdownLinks = value.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>',
  );
  return withMarkdownLinks.replace(
    /(^|[\s>])((https?:\/\/|www\.)[^\s<]+)/g,
    (match, prefix: string, url: string) => {
      if (match.includes('href=')) return match;
      const href = url.startsWith('www.') ? `https://${url}` : url;
      return `${prefix}<a href="${href}">${url}</a>`;
    },
  );
}

export function textToEmailHtml(value: string) {
  if (/<[a-z][\s\S]*>/i.test(value)) return value;
  return linkifyEmailText(escapeHtml(value)).replace(/\r?\n/g, '<br>');
}

export function sanitizeEmailHtml(value: string) {
  const html = textToEmailHtml(value);
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('script, style, iframe, object, embed, form, input, button').forEach(
    (element) => element.remove(),
  );
  container.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const attributeValue = attribute.value.trim().toLowerCase();
      if (name.startsWith('on')) element.removeAttribute(attribute.name);
      if (
        (name === 'href' || name === 'src')
        && (attributeValue.startsWith('javascript:') || attributeValue.startsWith('data:text/html'))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName === 'A') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return container.innerHTML;
}

export function emailHtmlToText(value: string) {
  if (!/<[a-z][\s\S]*>/i.test(value)) return value;
  const withBreaks = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|blockquote|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  const textarea = document.createElement('textarea');
  textarea.innerHTML = withBreaks;
  return textarea.value.replace(/\n{3,}/g, '\n\n').trim();
}

export function isEmailContentEmpty(value: string) {
  return !emailHtmlToText(value).trim();
}

function normalizedSignatureLines(value: string) {
  const plainValue = /<[a-z][\s\S]*>/i.test(value) ? emailHtmlToText(value) : value;
  return plainValue
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean);
}

function trailingSignatureMatchCount(content: string, signature: string) {
  const bodyLines = normalizedSignatureLines(content);
  const signatureLines = normalizedSignatureLines(signature);
  const maxMatch = Math.min(bodyLines.length, signatureLines.length);

  for (let count = maxMatch; count >= 1; count -= 1) {
    const bodyTail = bodyLines.slice(-count);
    const signaturePrefix = signatureLines.slice(0, count);
    if (bodyTail.every((line, index) => line === signaturePrefix[index])) return count;
  }
  return 0;
}

export function stripConfiguredEmailSignature(content: string, signature?: string) {
  let body = content.replace(/\r\n/g, '\n').trimEnd();
  const signatureText = signature?.trim();
  if (!body || !signatureText) return body;

  while (body) {
    const matchCount = trailingSignatureMatchCount(body, signatureText);
    if (!matchCount) break;

    const lines = body.split('\n');
    const nonEmptyLineIndexes = lines
      .map((line, index) => line.trim() ? index : -1)
      .filter((index) => index >= 0);
    const removeFrom = nonEmptyLineIndexes[nonEmptyLineIndexes.length - matchCount];
    body = lines.slice(0, removeFrom).join('\n').trimEnd();
  }
  return body;
}

export function applyPlainTextEmailSignature(content: string, signature?: string) {
  const signatureText = signature?.trim();
  const body = stripConfiguredEmailSignature(content, signatureText);
  if (!signatureText) return body;
  return body ? `${body}\n\n${signatureText}` : signatureText;
}

function removeTrailingEmptyNodes(container: HTMLElement) {
  while (container.lastChild) {
    const lastChild = container.lastChild;
    if (lastChild.nodeType === Node.TEXT_NODE && !lastChild.textContent?.trim()) {
      lastChild.remove();
      continue;
    }
    if (lastChild instanceof HTMLElement) {
      const isBreak = lastChild.tagName === 'BR';
      const isEmptyBlock = !lastChild.textContent?.trim()
        && !lastChild.querySelector('img, video, audio, table, hr');
      if (isBreak || isEmptyBlock) {
        lastChild.remove();
        continue;
      }
    }
    break;
  }
}

function stripConfiguredSignatureFromHtml(container: HTMLElement, signature: string) {
  const bodyText = emailHtmlToText(container.innerHTML);
  const matchCount = trailingSignatureMatchCount(bodyText, signature);
  if (!matchCount) return false;

  const matchedLines = normalizedSignatureLines(bodyText).slice(-matchCount);
  const firstLine = matchedLines[0];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (let index = textNodes.length - 1; index >= 0; index -= 1) {
    const node = textNodes[index];
    const nodeValue = node.nodeValue || '';
    const startOffset = nodeValue.toLowerCase().indexOf(firstLine);
    if (startOffset < 0) continue;

    const range = document.createRange();
    range.setStart(node, startOffset);
    range.setEnd(container, container.childNodes.length);
    const preview = document.createElement('div');
    preview.append(range.cloneContents());
    const previewLines = normalizedSignatureLines(preview.innerHTML);
    if (
      previewLines.length === matchedLines.length
      && previewLines.every((line, lineIndex) => line === matchedLines[lineIndex])
    ) {
      range.deleteContents();
      removeTrailingEmptyNodes(container);
      return true;
    }
  }
  return false;
}

export function appendEmailSignature(content: string, signature?: string) {
  const signatureText = signature?.trim();
  if (!/<[a-z][\s\S]*>/i.test(content)) {
    return textToEmailHtml(applyPlainTextEmailSignature(content, signatureText));
  }

  const container = document.createElement('div');
  container.innerHTML = sanitizeEmailHtml(content.trim());
  container.querySelectorAll('[data-app-email-signature]').forEach((element) => element.remove());
  removeTrailingEmptyNodes(container);
  if (!signatureText) return container.innerHTML;

  while (stripConfiguredSignatureFromHtml(container, signatureText)) {
    // Remove legacy duplicate signatures before adding the single configured signature.
  }
  const separator = container.innerHTML ? '<br><br>' : '';
  return `${container.innerHTML}${separator}<span data-app-email-signature="true">${textToEmailHtml(signatureText)}</span>`;
}

export function toBase64Url(value: string) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function buildRichRawEmail({
  to,
  subject,
  htmlBody,
  inReplyTo,
  references,
  attachments,
}: {
  to: string;
  subject: string;
  htmlBody: string;
  inReplyTo?: string;
  references?: string;
  attachments: File[];
}) {
  const safeHtmlBody = sanitizeEmailHtml(htmlBody);
  const headers = [
    `To: ${to.replace(/[\r\n]/g, '')}`,
    `Subject: =?utf-8?B?${encodeUtf8Base64(subject)}?=`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo.replace(/[\r\n]/g, '')}`] : []),
    ...(references ? [`References: ${references.replace(/[\r\n]/g, ' ')}`] : []),
    'MIME-Version: 1.0',
  ];
  const textBody = emailHtmlToText(safeHtmlBody);
  const alternativeBoundary = `alternative-${crypto.randomUUID()}`;
  const alternativeParts = [
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(encodeUtf8Base64(textBody)),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(encodeUtf8Base64(`<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;word-break:break-word">${safeHtmlBody}</div>`)),
    `--${alternativeBoundary}--`,
  ];

  if (attachments.length === 0) {
    return [...headers, ...alternativeParts].join('\r\n');
  }

  const mixedBoundary = `mixed-${crypto.randomUUID()}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    ...alternativeParts,
  ];

  for (const file of attachments) {
    const encodedName = encodeUtf8Base64(file.name.replace(/[\r\n]/g, ' '));
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${file.type || 'application/octet-stream'}; name="=?utf-8?B?${encodedName}?="`,
      `Content-Disposition: attachment; filename="=?utf-8?B?${encodedName}?="`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(arrayBufferToBase64(await file.arrayBuffer())),
    );
  }

  parts.push(`--${mixedBoundary}--`, '');
  return parts.join('\r\n');
}
