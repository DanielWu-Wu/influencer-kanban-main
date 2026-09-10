import { OUTREACH_LANGUAGE_OPTIONS } from './outreach-languages';

export function parseTranslationLanguage(content: string, complete = true) {
  const match = content.match(/^\s*\[LANG:([a-z-]+)\]\s*\r?\n/i);
  if (match) {
    const code = match[1].toLowerCase();
    return { sourceLang: OUTREACH_LANGUAGE_OPTIONS.some(item => item.code === code) ? code : 'auto',
      translatedText: content.slice(match[0].length) };
  }
  if (!complete && !content.includes('\n') && content.length < 128) {
    return { sourceLang: 'auto', translatedText: '' };
  }
  return { sourceLang: 'auto', translatedText: content.replace(/^\s*\[LANG:[^\]]*\]\s*/i, '') };
}
