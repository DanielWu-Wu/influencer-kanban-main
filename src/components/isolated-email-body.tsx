'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buildIsolatedEmailDocument, clampEmailBodyHeight, EMAIL_BODY_MIN_HEIGHT, EMAIL_BODY_SANDBOX } from '@/lib/isolated-email-document';

type IsolatedEmailBodyProps = {
  messageIdentity: string;
  html: string;
  plainText: string;
  title: string;
  blockRemoteContent: boolean;
  mobile?: boolean;
};

// A keyed child gives each account/message/content its own observers and state.
// Ordinary parent renders keep the same iframe document and selection.
export const IsolatedEmailBody = memo(function IsolatedEmailBody(props: IsolatedEmailBodyProps) {
  return <EmailBodyFrame key={JSON.stringify([props.messageIdentity, props.html, props.blockRemoteContent, props.mobile])} {...props} />;
});

function EmailBodyFrame({ html, plainText, title, blockRemoteContent, mobile = false }: IsolatedEmailBodyProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);
  const [wideContent, setWideContent] = useState(false);
  const source = useMemo(() => buildIsolatedEmailDocument(html, title, blockRemoteContent, mobile), [html, title, blockRemoteContent, mobile]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || failed) return;
    let disposed = false;
    let pendingFrame = 0;
    let detachDocument: (() => void) | undefined;
    let initialized = false;
    const initialize = () => {
      if (disposed) return;
      detachDocument?.();
      try {
        const doc = frame.contentDocument;
        const root = doc?.querySelector<HTMLElement>('[data-isolated-email-root]');
        if (!doc || !root) return;
        initialized = true;
        let active = true;
        const measure = () => {
          if (pendingFrame || !active || disposed) return;
          pendingFrame = requestAnimationFrame(() => {
            pendingFrame = 0;
            if (!active || disposed || frame.contentDocument !== doc) return;
            // Measuring the content root (not document.scrollHeight) allows
            // tall mail to shrink again when images/column width change.
            const height = clampEmailBodyHeight(root.getBoundingClientRect().height);
            if (Number(frame.getAttribute('height')) !== height) frame.setAttribute('height', String(height));
            if (mobile) setWideContent(root.scrollWidth > root.clientWidth + 1
              || Array.from(root.querySelectorAll('pre')).some((element) => element.scrollWidth > element.clientWidth + 1));
          });
        };
        const resize = new ResizeObserver(measure);
        resize.observe(root);
        resize.observe(frame);
        const mutations = new MutationObserver(measure);
        mutations.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
        doc.addEventListener('load', measure, true);
        doc.addEventListener('error', measure, true);
        doc.fonts?.ready.then(() => { if (active) measure(); });
        measure();
        detachDocument = () => {
          active = false;
          resize.disconnect();
          mutations.disconnect();
          doc.removeEventListener('load', measure, true);
          doc.removeEventListener('error', measure, true);
          cancelAnimationFrame(pendingFrame);
          pendingFrame = 0;
        };
      } catch {
        setFailed(true);
      }
    };
    frame.addEventListener('load', initialize);
    // A cached srcDoc can be ready before the effect attaches its load handler.
    initialize();
    const timeout = setTimeout(() => { if (!initialized && !disposed) setFailed(true); }, 5000);
    return () => {
      disposed = true;
      clearTimeout(timeout);
      frame.removeEventListener('load', initialize);
      detachDocument?.();
    };
  }, [source, failed, mobile]);

  return (
    <div className="mobile-isolated-email min-w-0 max-w-full overflow-hidden rounded-lg border border-border/55 bg-white p-4 shadow-sm [contain:inline-size_paint]">
      {mobile && wideContent && !failed && <p className="mb-2 text-xs text-muted-foreground">宽表格或原始格式可在正文内左右滑动查看。</p>}
      {failed ? (
        <div className="flex flex-col gap-2">
          <Alert><AlertDescription>邮件排版无法安全显示，已改为纯文本原文。</AlertDescription></Alert>
          <pre className="max-w-full whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{plainText}</pre>
        </div>
      ) : (
        <iframe
          ref={frameRef}
          title={`邮件原文：${title}`}
          sandbox={EMAIL_BODY_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={source}
          height={EMAIL_BODY_MIN_HEIGHT}
          className="block w-full min-w-0 max-w-full border-0"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
