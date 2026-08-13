export type EmailHtmlDisplaySanitizationResult = {
  html: string;
  blockedRemoteResourceCount: number;
};

const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?(?:(['"])(.*?)\1|([^;\s)]+))\s*\)?[^;]*;?/gi;
const CSS_URL_PATTERN = /url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/gi;

export function isRemoteEmailResourceUrl(value: string) {
  return /^(?:https?:)?\/\//i.test(value.trim());
}

export function hasRemoteEmailResourceReference(value: string) {
  return value.split(',').some((candidate) => {
    const normalized = candidate.trim();
    if (/^(?:cid:|data:|blob:)/i.test(normalized)) return false;
    return /(?:^|\s)(?:https?:)?\/\//i.test(normalized);
  });
}

export function shouldBlockRemoteEmailContent(
  labels: readonly string[],
  remoteContentAllowed: boolean,
) {
  return labels.includes('SENT') && !remoteContentAllowed;
}

export function stripRemoteCssResources(value: string) {
  let blockedRemoteResourceCount = 0;
  const withoutImports = value.replace(
    CSS_IMPORT_PATTERN,
    (match, _quote: string | undefined, quotedUrl: string | undefined, unquotedUrl: string | undefined) => {
      const url = String(quotedUrl || unquotedUrl || '').trim();
      if (!isRemoteEmailResourceUrl(url)) return match;
      blockedRemoteResourceCount += 1;
      return '';
    },
  );
  const css = withoutImports.replace(
    CSS_URL_PATTERN,
    (match, _quote: string | undefined, quotedUrl: string | undefined, unquotedUrl: string | undefined) => {
      const url = String(quotedUrl || unquotedUrl || '').trim();
      if (!isRemoteEmailResourceUrl(url)) return match;
      blockedRemoteResourceCount += 1;
      return 'none';
    },
  );
  return { css, blockedRemoteResourceCount };
}

function removeRemoteResourceAttribute(element: Element, attributeName: string) {
  const value = element.getAttribute(attributeName) || '';
  if (!hasRemoteEmailResourceReference(value)) return false;
  element.removeAttribute(attributeName);
  return true;
}

export function sanitizeEmailHtmlForDisplay(
  html: string,
  { blockRemoteContent }: { blockRemoteContent: boolean },
): EmailHtmlDisplaySanitizationResult {
  if (typeof document === 'undefined') {
    return { html: '', blockedRemoteResourceCount: 0 };
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  let blockedRemoteResourceCount = 0;

  content.querySelectorAll<HTMLLinkElement>('link[href]').forEach((link) => {
    if (blockRemoteContent && isRemoteEmailResourceUrl(link.getAttribute('href') || '')) {
      blockedRemoteResourceCount += 1;
      link.remove();
    }
  });
  content
    .querySelectorAll('script, iframe, object, embed, form, input, button, meta, base')
    .forEach((element) => element.remove());

  content.querySelectorAll<HTMLStyleElement>('style').forEach((styleElement) => {
    if (!blockRemoteContent) return;
    const cleaned = stripRemoteCssResources(styleElement.textContent || '');
    blockedRemoteResourceCount += cleaned.blockedRemoteResourceCount;
    styleElement.textContent = cleaned.css;
  });

  content.querySelectorAll<HTMLElement>('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith('on')) {
        element.removeAttribute(attribute.name);
      }
    });

    let style = element.getAttribute('style');
    if (style) {
      style = style
        .replace(/position\s*:\s*(fixed|sticky)/gi, 'position: static')
        .replace(/z-index\s*:[^;]+;?/gi, '');
      if (blockRemoteContent) {
        const cleaned = stripRemoteCssResources(style);
        blockedRemoteResourceCount += cleaned.blockedRemoteResourceCount;
        style = cleaned.css;
      }
      if (style.trim()) element.setAttribute('style', style);
      else element.removeAttribute('style');
    }

    if (!blockRemoteContent) return;

    const tagName = element.tagName.toLowerCase();
    const blocksPrimaryImage = tagName === 'img'
      && isRemoteEmailResourceUrl(element.getAttribute('src') || '');
    const resourceAttributes = ['src', 'srcset', 'poster', 'background'];
    resourceAttributes.forEach((attributeName) => {
      if (removeRemoteResourceAttribute(element, attributeName)) {
        blockedRemoteResourceCount += 1;
      }
    });

    if (['image', 'use', 'feimage'].includes(tagName)) {
      ['href', 'xlink:href'].forEach((attributeName) => {
        if (removeRemoteResourceAttribute(element, attributeName)) {
          blockedRemoteResourceCount += 1;
        }
      });
    }

    Array.from(element.attributes).forEach((attribute) => {
      if (!/url\s*\(/i.test(attribute.value)) return;
      const cleaned = stripRemoteCssResources(attribute.value);
      if (!cleaned.blockedRemoteResourceCount) return;
      blockedRemoteResourceCount += cleaned.blockedRemoteResourceCount;
      if (cleaned.css.trim()) element.setAttribute(attribute.name, cleaned.css);
      else element.removeAttribute(attribute.name);
    });

    if (blocksPrimaryImage) element.remove();
  });

  content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!/^(https?:|mailto:)/i.test(href)) {
      link.removeAttribute('href');
    } else {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  });

  content.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const source = image.getAttribute('src') || '';
    if (!/^(https?:|\/\/|data:image\/|blob:|cid:)/i.test(source)) {
      image.remove();
      return;
    }
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.style.maxWidth = '100%';
    image.style.height = 'auto';
  });

  return {
    html: template.innerHTML,
    blockedRemoteResourceCount,
  };
}
