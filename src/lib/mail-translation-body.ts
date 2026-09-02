import { emailHtmlBodyToPlainText, repairTextEncoding } from './email-text';

/** Formatting-only normalization. Never remove quoted content or meaningful text. */
export function normalizeMailTranslationText(value: string) {
  return repairTextEncoding(value).replace(/\r\n?/g, '\n')
    .replace(/[\t ]+$/gm, '').trim();
}

export function resolveMailTranslationBody(body: string, htmlBody = '') {
  return normalizeMailTranslationText(body.trim() ? body : emailHtmlBodyToPlainText(htmlBody));
}

/** Both Gmail daily discovery and the actual inbox detail use this exact parser. */
export function readGmailMessageBody(payload: Record<string, unknown>) {
  const text: string[] = [];
  const html: string[] = [];
  const visit = (part: Record<string, unknown>) => {
    const headers = (part.headers || []) as Array<{ name: string; value: string }>;
    const header = (name: string) => headers.find((item) => item.name.toLowerCase() === name)?.value || '';
    if (/attachment/i.test(header('content-disposition')) || part.filename) return;
    const encoded = (part.body as { data?: string } | undefined)?.data;
    const mime = String(part.mimeType || '').toLowerCase();
    if (encoded && (mime === 'text/plain' || mime === 'text/html')) {
      const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const charset = header('content-type').match(/charset=["']?([^;"'\s]+)/i)?.[1] || 'utf-8';
      let decoded: string;
      try { decoded = new TextDecoder(charset).decode(bytes); }
      catch { decoded = new TextDecoder('utf-8').decode(bytes); }
      (mime === 'text/plain' ? text : html).push(decoded);
    }
    (part.parts as Record<string, unknown>[] | undefined)?.forEach(visit);
  };
  visit(payload);
  const htmlBody = repairTextEncoding(html.join('\n'));
  return { body: resolveMailTranslationBody(text.join('\n\n'), htmlBody), htmlBody };
}

export function isUsableMailTranslation(source: string, translated: string) {
  const value = translated.replace(/^【当前邮件翻译】\s*/u, '').trim();
  if (!value) return false;
  // Already-Chinese messages can legitimately be returned unchanged.
  if (/[\u3400-\u9fff]/u.test(source)) return /[\u3400-\u9fff]/u.test(value);
  return /[\u3400-\u9fff]/u.test(value) && normalizeMailTranslationText(source) !== normalizeMailTranslationText(value);
}
