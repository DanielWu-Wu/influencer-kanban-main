'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CompactPopoverVariant } from './variant-compact-popover';
import { TaskDrawerVariant } from './variant-task-drawer';
import { TopProgressRailVariant } from './variant-top-progress-rail';
import './prototype-picker.css';

const VARIANTS = [
  { name: '轻量下拉', component: CompactPopoverVariant },
  { name: '任务抽屉', component: TaskDrawerVariant },
  { name: '顶部进度带', component: TopProgressRailVariant },
] as const;

export default function EmailGenerationProgressPrototypePage() {
  const [current, setCurrent] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const pickerRef = useRef<HTMLElement>(null);

  const moveHighlight = useCallback(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const highlight = picker.querySelector<HTMLElement>('.proto-picker-highlight');
    const items = Array.from(picker.querySelectorAll<HTMLElement>('.proto-picker-item:not(.proto-picker-replay)'));
    const active = items[current];
    if (!highlight || !active) return;
    highlight.style.width = `${active.offsetWidth}px`;
    highlight.style.transform = `translateX(${active.offsetLeft}px)`;
  }, [current]);

  const setActive = useCallback((index: number) => {
    if (index < 0 || index >= VARIANTS.length) return;
    setCurrent(index);
    setReplayKey((value) => value + 1);
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(index + 1));
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    const requested = Number.parseInt(new URLSearchParams(window.location.search).get('v') || '1', 10) - 1;
    if (Number.isInteger(requested) && requested >= 0 && requested < VARIANTS.length) {
      setCurrent(requested);
    }
  }, []);

  useLayoutEffect(() => {
    moveHighlight();
  }, [moveHighlight]);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return undefined;
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => picker.setAttribute('data-ready', ''));
      picker.dataset.secondFrame = String(secondFrame);
    });
    const handleResize = () => moveHighlight();
    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (picker.dataset.secondFrame) window.cancelAnimationFrame(Number(picker.dataset.secondFrame));
      window.removeEventListener('resize', handleResize);
    };
  }, [moveHighlight]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const number = Number.parseInt(event.key, 10);
      if (number >= 1 && number <= VARIANTS.length) setActive(number - 1);
      else if (event.key === 'ArrowRight') setActive((current + 1) % VARIANTS.length);
      else if (event.key === 'ArrowLeft') setActive((current - 1 + VARIANTS.length) % VARIANTS.length);
      else if (event.key === 'r' || event.key === 'R') setReplayKey((value) => value + 1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [current, setActive]);

  const Variant = VARIANTS[current].component;

  return (
    <>
      <div id="stage" className="h-dvh overflow-hidden">
        <Variant key={`${current}-${replayKey}`} />
      </div>
      <nav ref={pickerRef} className="proto-picker" aria-label="Prototype variants">
        <span className="proto-picker-highlight" aria-hidden="true" />
        {VARIANTS.map((variant, index) => (
          <button
            key={variant.name}
            className="proto-picker-item"
            data-active={index === current ? '' : undefined}
            aria-current={index === current ? 'true' : undefined}
            onClick={() => setActive(index)}
          >
            {variant.name}
          </button>
        ))}
        <span className="proto-picker-divider" aria-hidden="true" />
        <button
          className="proto-picker-item proto-picker-replay"
          aria-label="Replay animation (R)"
          onClick={() => setReplayKey((value) => value + 1)}
        >
          ↻
        </button>
      </nav>
    </>
  );
}
