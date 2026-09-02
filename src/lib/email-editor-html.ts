import { textToEmailHtml } from './email-content';

const ALLOWED_TAGS = new Set('a abbr b blockquote br caption center code col colgroup dd del div dl dt em figcaption figure font h1 h2 h3 h4 h5 h6 hr i img ins li ol p pre s small span strike strong sub sup table tbody td tfoot th thead tr u ul'.split(' '));
const ALLOWED_ATTRIBUTES = new Set('href src alt title width height colspan rowspan cellpadding cellspacing border align valign color face size start type target rel referrerpolicy data-app-email-signature data-mail-inline-id'.split(' '));
const ALLOWED_STYLES = new Set(('color background-color font font-family font-size font-style font-weight font-variant line-height letter-spacing word-spacing text-align text-decoration text-decoration-color text-decoration-line text-decoration-style text-indent text-transform vertical-align white-space overflow-wrap word-break ' +
  'margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left ' +
  'border border-top border-right border-bottom border-left border-width border-style border-color border-collapse border-spacing border-radius ' +
  'width height max-width max-height min-width min-height list-style-type list-style-position table-layout').split(' '));

export function isSafeEditorUrl(value: string, image = false) {
  return image
    ? /^(?:https?:\/\/|\/\/|cid:|blob:|data:image\/(?:png|jpe?g|gif|webp|avif|bmp);)/i.test(value.trim())
    : /^(?:https?:\/\/|mailto:)/i.test(value.trim());
}

export function isSafeEditorStyle(property: string, value: string) {
  return ALLOWED_STYLES.has(property.toLowerCase()) && !/(?:url\s*\(|expression\s*\(|var\s*\(|[\\@<>])/i.test(value);
}

// Parse in an inert template. Never mount an external fragment just to clean it:
// even a short-lived style/link in the live document can restyle the workspace.
export function sanitizeEmailHtmlForEditor(value: string): { html: string; simplified: boolean } {
  if (typeof document === 'undefined') return { html: '', simplified: false };
  const template = document.createElement('template');
  template.innerHTML = textToEmailHtml(value);
  let simplified = false;
  template.content.querySelectorAll('style,link,meta,base,script,iframe,object,embed,form,input,button,textarea,select,template,svg,math,video,audio').forEach((element) => {
    simplified = true;
    element.remove();
  });
  template.content.querySelectorAll<HTMLElement>('*').forEach((element) => {
    const tag = element.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      simplified = true;
      element.replaceWith(...element.childNodes);
      return;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name === 'style') {
        for (const property of Array.from(element.style)) {
          if (!isSafeEditorStyle(property, element.style.getPropertyValue(property))) {
            element.style.removeProperty(property);
            simplified = true;
          } else if (element.style.getPropertyPriority(property)) {
            element.style.setProperty(property, element.style.getPropertyValue(property));
          }
        }
      } else if (!ALLOWED_ATTRIBUTES.has(name) ||
        (name === 'href' && (tag !== 'a' || !isSafeEditorUrl(attribute.value))) ||
        (name === 'src' && (tag !== 'img' || !isSafeEditorUrl(attribute.value, true)))) {
        element.removeAttribute(attribute.name);
        // The generated safe link attributes are reapplied below.
        if (!['target', 'rel', 'loading', 'referrerpolicy'].includes(name)) simplified = true;
      }
    }
    if (tag === 'a') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
    if (element.hasAttribute('referrerpolicy')) element.setAttribute('referrerpolicy', 'no-referrer');
    if (tag === 'img') {
      element.style.maxWidth = '100%';
      element.style.height = 'auto';
      element.setAttribute('referrerpolicy', 'no-referrer');
    }
  });
  return { html: template.innerHTML, simplified };
}
