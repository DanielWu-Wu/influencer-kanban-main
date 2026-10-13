'use client';

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useAuth } from '@/components/auth-provider';

// Retain text in this tab even if browser storage is unavailable. Each key
// includes the system account and the complete reply context, plus editor mode.
const textCache = new Map<string, string>();
const unavailableStorage = new Set<string>();
const storageWarning = '浏览器暂存不可用，文字仅保留在当前网页；请勿刷新或关闭网页。';

export function useLocalReplyText(identity: string, slot: string, initial = '', enabled = true) {
  const { account } = useAuth();
  const key = enabled && account?.userId
    ? `mail-reply-input:v1:${JSON.stringify([account.userId, slot, identity])}` : '';
  const [state, setState] = useState({ key, text: initial, ready: false, hasSavedText: false });
  const [warning, setWarning] = useState('');
  const current = useRef({ key: '', text: initial, edited: false });

  useEffect(() => {
    if (!key || (current.current.key === key && current.current.edited)) return;
    let text = textCache.get(key) ?? initial;
    let hasSavedText = textCache.has(key);
    try {
      const saved = localStorage.getItem(key);
      if (!textCache.has(key) && saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (typeof parsed === 'string') { text = parsed; hasSavedText = true; }
      }
    } catch {
      unavailableStorage.add(key);
    }
    setWarning(unavailableStorage.has(key) ? storageWarning : '');
    current.current = { key, text, edited: false };
    if (hasSavedText) textCache.set(key, text);
    setState({ key, text, ready: true, hasSavedText });
  }, [initial, key]);

  const setText = useCallback((value: SetStateAction<string>) => {
    const previous = current.current.key === key ? current.current.text : initial;
    const text = typeof value === 'function' ? value(previous) : value;
    current.current = { key, text, edited: true };
    if (key) {
      textCache.set(key, text);
      try {
        // Save synchronously on edits, including empty text, so returning to
        // the directory cannot outrun a debounce or resurrect cleared input.
        localStorage.setItem(key, JSON.stringify(text));
        unavailableStorage.delete(key);
        setWarning('');
      } catch {
        unavailableStorage.add(key);
        setWarning(storageWarning);
      }
    }
    setState({ key, text, ready: true, hasSavedText: true });
  }, [initial, key]);

  return [state.key === key ? state.text : initial, setText, warning,
    !key || (state.key === key && state.ready), state.key === key && state.hasSavedText] as const;
}
