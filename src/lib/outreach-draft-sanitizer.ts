const INTERNAL_REVIEW_HEADING = /^(?:[-*#\s]*)(?:\*{1,2}\s*)?(?:注意|风险提示|缺失信息|产品事实|合作承诺|称呼|语言与匹配度|语言匹配|邮件审查|人工核对|资料核对|审核提醒)\s*[：:]/;
const STANDALONE_NAME_PLACEHOLDER = /^(?:\[|\{|<|\()\s*(?:tu\s+nombre|su\s+nombre|your\s+name|my\s+name|our\s+name|name|nombre|dein\s+name|ihr\s+name|votre\s+nom|uw\s+naam)\s*(?:\]|\}|>|\))$/i;

function normalizedLine(line: string) {
  return line
    .trim()
    .replace(/^[\s[*（(【「『]+|[\s\]*）)】」』]+$/g, '')
    .toLowerCase();
}

function isSignaturePlaceholder(line: string) {
  if (STANDALONE_NAME_PLACEHOLDER.test(line.trim())) return true;
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
 * Chinese review checklist or a placeholder signature after the body.
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
