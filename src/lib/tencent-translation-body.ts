import type { MessageStructureObject } from 'imapflow';

/** 常规邮件只下载正文；复杂 MIME 用详情相同的完整解析器，不能拿第一段冒充全文。 */
export function selectTencentTranslationBodyPart(structure?: MessageStructureObject) {
  const candidates: MessageStructureObject[] = [];
  let complex = false;
  const visit = (node: MessageStructureObject) => {
    if (node.disposition?.toLowerCase() === 'attachment') return;
    if (node.type.toLowerCase() === 'message/rfc822') complex = true;
    if (/^text\/(plain|html)$/i.test(node.type)) candidates.push(node);
    node.childNodes?.forEach(visit);
  };
  if (structure) visit(structure);
  const plain = candidates.filter((item) => item.type.toLowerCase() === 'text/plain');
  const html = candidates.filter((item) => item.type.toLowerCase() === 'text/html');
  const preferred = plain[0] || html[0];
  if (complex || plain.length > 1 || html.length > 1 || !preferred?.part
    || preferred.parameters?.format?.toLowerCase() === 'flowed') return undefined;
  return preferred;
}
