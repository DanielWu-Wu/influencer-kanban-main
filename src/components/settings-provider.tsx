'use client';

import type { ReactNode } from 'react';
import { SettingsContext, useSettingsProviderValue } from '@/lib/data';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const value = useSettingsProviderValue();
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
