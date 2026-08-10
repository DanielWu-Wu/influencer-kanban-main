const HAN_CHARACTER_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_CHARACTER_PATTERN = /[A-Za-z]/g;

function normalizeComparableText(value: string) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

export type ChineseTranslationValidation = {
  valid: boolean;
  reason: string;
  hanCharacters: number;
  chineseRatio: number;
};

/**
 * Rejects empty, copied, or overwhelmingly non-Chinese "translations" while
 * allowing product names, email addresses, model numbers, and links to remain.
 */
export function validateChineseTranslation(
  sourceText: string,
  translatedText: string,
): ChineseTranslationValidation {
  const source = String(sourceText || '').trim();
  const translated = String(translatedText || '').trim();
  const hanCharacters = translated.match(HAN_CHARACTER_PATTERN)?.length || 0;
  const latinCharacters = translated.match(LATIN_CHARACTER_PATTERN)?.length || 0;
  const chineseRatio = hanCharacters / Math.max(1, hanCharacters + latinCharacters);

  if (!translated) {
    return { valid: false, reason: '中文对照为空。', hanCharacters, chineseRatio };
  }

  const normalizedSource = normalizeComparableText(source);
  const normalizedTranslation = normalizeComparableText(translated);
  if (normalizedSource && normalizedSource === normalizedTranslation) {
    return {
      valid: false,
      reason: '中文对照与外文原文相同，可能直接复制了原文。',
      hanCharacters,
      chineseRatio,
    };
  }

  const sourceLetters = source.match(LATIN_CHARACTER_PATTERN)?.length || 0;
  const minimumHanCharacters = Math.min(6, Math.max(2, Math.ceil(sourceLetters * 0.04)));
  if (hanCharacters < minimumHanCharacters) {
    return {
      valid: false,
      reason: '中文字符过少，无法确认这是完整的简体中文对照。',
      hanCharacters,
      chineseRatio,
    };
  }

  if (latinCharacters >= 12 && chineseRatio < 0.25) {
    return {
      valid: false,
      reason: '中文占比过低，结果可能仍然主要是外文原文。',
      hanCharacters,
      chineseRatio,
    };
  }

  return { valid: true, reason: '', hanCharacters, chineseRatio };
}

export type StreamingJsonString = {
  found: boolean;
  complete: boolean;
  value: string;
};

/** Extracts a JSON string property even while the model is still streaming it. */
export function extractStreamingJsonString(
  content: string,
  propertyName: string,
): StreamingJsonString {
  const escapedPropertyName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propertyMatch = new RegExp(`"${escapedPropertyName}"\\s*:\\s*"`).exec(content);
  if (!propertyMatch) return { found: false, complete: false, value: '' };

  const start = propertyMatch.index + propertyMatch[0].length;
  let value = '';
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') return { found: true, complete: true, value };
    if (character !== '\\') {
      value += character;
      continue;
    }

    if (index + 1 >= content.length) break;
    const escaped = content[index + 1];
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    if (escaped === 'u') {
      const hex = content.slice(index + 2, index + 6);
      if (hex.length < 4 || !/^[0-9a-f]{4}$/i.test(hex)) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    value += simpleEscapes[escaped] ?? escaped;
    index += 1;
  }

  return { found: true, complete: false, value };
}
