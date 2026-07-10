const INTERNAL_REVIEW_HEADING = /^(?:[-*#\s]*)(?:\*{1,2}\s*)?(?:注意|风险提示|缺失信息|产品事实|合作承诺|称呼|语言与匹配度|语言匹配|邮件审查|人工核对|资料核对|审核提醒)\s*[：:]/;

function normalizedLine(line: string) {
  return line
    .trim()
    .replace(/^[\s[*（(【「『]+|[\s\]*）)】」』]+$/g, '')
    .toLowerCase();
}

function isSignaturePlaceholder(line: string) {
  const normalized = normalizedLine(line);
  if (!normalized) return false;
  const mentionsSignature = ['signature', 'signatur', '签名', '署名'].some((keyword) => normalized.includes(keyword));
  const mentionsSystemInstruction = [
    'gmail',
    'system',
    'systemet',
    '系统',
    'automatically',
    'automatic',
    'automatiskt',
    '自动',
    'placeholder',
    '占位',
  ].some((keyword) => normalized.includes(keyword));
  return mentionsSignature && mentionsSystemInstruction;
}

/**
 * Keeps only the email the user can send. Some models occasionally append their
 * Chinese review checklist after the body, usually beginning with "注意：".
 */
export function sanitizeOutreachEmailBody(value: unknown) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .filter((line) => !isSignaturePlaceholder(line));
  const reviewStart = lines.findIndex((line) => INTERNAL_REVIEW_HEADING.test(line.trim()));
  const content = reviewStart < 0 ? lines : lines.slice(0, reviewStart);

  while (content.length && (!content.at(-1)?.trim() || /^[-—]{3,}$/.test(content.at(-1)?.trim() || ''))) {
    content.pop();
  }
  return content.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
