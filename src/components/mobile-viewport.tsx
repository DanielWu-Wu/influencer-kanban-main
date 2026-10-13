'use client';

import { useEffect } from 'react';

export function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      const mobile = window.matchMedia('(max-width: 767px)').matches;
      // Keep pinch zoom native; only use the visible height at normal scale.
      const normalScale = viewport && Math.abs(viewport.scale - 1) < 0.01;
      const height = normalScale ? viewport.height : window.innerHeight;
      root.style.setProperty('--mobile-visible-height', `${height}px`);
      root.style.setProperty('--mobile-visible-top', `${normalScale ? viewport.offsetTop : 0}px`);
      const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
      root.dataset.mobileKeyboard = mobile && editing && window.innerHeight - height > 150 ? 'true' : 'false';
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
      root.style.removeProperty('--mobile-visible-height');
      root.style.removeProperty('--mobile-visible-top');
      delete root.dataset.mobileKeyboard;
    };
  }, []);
  return null;
}
