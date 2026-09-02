export const EMAIL_BODY_MIN_HEIGHT = 120;
export const EMAIL_BODY_MAX_HEIGHT = 6000;
export const EMAIL_BODY_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

export function clampEmailBodyHeight(height: number) {
  if (!Number.isFinite(height)) return EMAIL_BODY_MIN_HEIGHT;
  return Math.min(EMAIL_BODY_MAX_HEIGHT, Math.max(EMAIL_BODY_MIN_HEIGHT, Math.ceil(height)));
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The caller must sanitize first. CSP is a second boundary, including CSS URLs
// which are not reliably handled by regex alone. Never add allow-scripts.
export function buildIsolatedEmailDocument(html: string, title: string, blockRemoteContent: boolean) {
  const remote = blockRemoteContent ? '' : ' https: http:';
  const csp = [
    "default-src 'none'", "script-src 'none'", "connect-src 'none'",
    "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'",
    `img-src data: blob:${remote}`, `font-src data:${remote}`,
    `style-src 'unsafe-inline'${remote}`,
  ].join('; ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}"><meta name="referrer" content="no-referrer"><title>${escapeAttribute(title)}</title><style>
html { overflow: auto; }
body { font: 14px/1.5 Arial, sans-serif; color: #202124; overflow-wrap: anywhere; }
img { max-width: 100% !important; height: auto !important; }
a { color: #2563eb; }
</style></head><body style="margin:0!important;padding:0!important;min-width:0!important;width:100%!important;height:auto!important;min-height:0!important"><main data-isolated-email-root style="display:flow-root!important;position:relative!important;box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:100%!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow:auto!important">${html}</main></body></html>`;
}
