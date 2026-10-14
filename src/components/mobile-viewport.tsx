'use client';

import { useEffect } from 'react';
import { MOBILE_QUERY } from '@/lib/use-mobile-layout';

export function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let pendingFrame = 0;
    const update = () => {
      const mobile = window.matchMedia(MOBILE_QUERY).matches;
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && active.matches('input, textarea, [contenteditable="true"]');
      // A zoomed viewport alone is not a keyboard. Scale back to layout pixels
      // to distinguish pinch zoom from the extra height lost to an input method.
      const normalScale = viewport && Math.abs(viewport.scale - 1) < 0.01;
      const keyboard = Boolean(mobile && editing && viewport && window.innerHeight - viewport.height * viewport.scale > 150);
      const followViewport = viewport && (normalScale || keyboard);
      const height = followViewport ? viewport.height : window.innerHeight;
      root.style.setProperty('--mobile-visible-height', `${height}px`);
      root.style.setProperty('--mobile-visible-top', `${followViewport ? viewport.offsetTop : 0}px`);
      root.dataset.mobileKeyboard = keyboard ? 'true' : 'false';
      root.dataset.mobileEditing = mobile && editing ? 'true' : 'false';
      cancelAnimationFrame(pendingFrame);
      if (!keyboard || !editing) return;
      pendingFrame = requestAnimationFrame(() => {
        if (document.activeElement !== active) return;
        // Scroll the form or reply pane, never the entire workbench. Keep the
        // focused field visible after its container shrinks under the keyboard.
        for (let parent = active.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight + 1) continue;
          const field = (active.closest('.rich-email-editor') || active).getBoundingClientRect();
          const pane = parent.getBoundingClientRect();
          if (field.height > pane.height - 16 || field.top < pane.top + 8) parent.scrollTop += field.top - pane.top - 8;
          else if (field.bottom > pane.bottom - 8) parent.scrollTop += field.bottom - pane.bottom + 8;
          break;
        }
      });
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      cancelAnimationFrame(pendingFrame);
      root.style.removeProperty('--mobile-visible-height');
      root.style.removeProperty('--mobile-visible-top');
      delete root.dataset.mobileKeyboard;
      delete root.dataset.mobileEditing;
    };
  }, []);
  return null;
}
