'use client';

import { useSyncExternalStore } from 'react';

// Include short, touch-only landscape viewports without changing mouse desktops.
export const MOBILE_QUERY = '(max-width: 767px), (max-width: 1023px) and (max-height: 600px) and (pointer: coarse)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

// A presentation breakpoint only: authentication and API permissions are unchanged.
export function useMobileLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
}
