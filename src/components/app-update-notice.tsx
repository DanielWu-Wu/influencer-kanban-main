'use client';

import { useEffect, useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scopedLocalStorageKeyFor } from '@/lib/account-cache-scope';
import {
  APP_RELEASE_LAST_SEEN_STORAGE_KEY,
  CURRENT_APP_RELEASE,
  compareAppVersions,
  getUnseenAppReleases,
  isValidAppVersion,
  type AppRelease,
} from '@/lib/app-release';

const UPDATE_NOTICE_DELAY_MS = 800;

export function AppUpdateNotice({ accountUserId }: { accountUserId: string }) {
  const [unseenReleases, setUnseenReleases] = useState<AppRelease[]>([]);

  useEffect(() => {
    setUnseenReleases([]);
    const storageKey = scopedLocalStorageKeyFor(
      APP_RELEASE_LAST_SEEN_STORAGE_KEY,
      accountUserId,
    );

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      if (
        isValidAppVersion(event.newValue)
        && compareAppVersions(event.newValue, CURRENT_APP_RELEASE.version) >= 0
      ) {
        setUnseenReleases([]);
      }
    };

    window.addEventListener('storage', handleStorage);
    const timer = window.setTimeout(() => {
      try {
        const lastSeenVersion = window.localStorage.getItem(storageKey);
        if (lastSeenVersion !== null && !isValidAppVersion(lastSeenVersion)) return;

        const releases = getUnseenAppReleases(lastSeenVersion);
        if (releases.length === 0) return;

        window.localStorage.setItem(storageKey, CURRENT_APP_RELEASE.version);
        setUnseenReleases(releases);
      } catch {
        // The notice is optional. Storage failures must never block the workspace.
      }
    }, UPDATE_NOTICE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('storage', handleStorage);
    };
  }, [accountUserId]);

  if (unseenReleases.length === 0) return null;

  const latestRelease = unseenReleases[0];
  const dismiss = () => setUnseenReleases([]);

  return (
    <aside
      aria-labelledby="app-update-notice-title"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[80] flex max-h-[min(70dvh,32rem)] flex-col overflow-hidden rounded-lg border border-border/65 bg-background/96 shadow-xl backdrop-blur-xl md:bottom-auto md:left-auto md:right-5 md:top-[4.5rem] md:w-[360px]"
    >
      <div className="flex items-start gap-3 border-b border-border/60 px-4 py-3.5">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-primary">已更新到 {latestRelease.version}</p>
          <h2 id="app-update-notice-title" className="mt-0.5 text-sm font-semibold text-foreground">
            {latestRelease.title}
          </h2>
          {unseenReleases.length > 1 && (
            <p className="mt-1 text-xs text-muted-foreground">
              汇总了你尚未看过的 {unseenReleases.length} 次版本更新
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="关闭版本更新提醒"
          title="关闭"
          onClick={dismiss}
          className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3.5">
        {unseenReleases.map((release) => (
          <section key={release.version} aria-label={`${release.version} 版本更新`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-medium text-foreground">{release.version} · {release.title}</h3>
              <time className="text-xs tabular-nums text-muted-foreground" dateTime={release.releasedAt}>
                {release.releasedAt}
              </time>
            </div>
            <ul className="mt-2 space-y-1.5">
              {release.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2 text-sm leading-5 text-muted-foreground">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="border-t border-border/60 px-4 py-3">
        <Button type="button" className="h-11 w-full" onClick={dismiss}>
          <Check className="h-4 w-4" aria-hidden="true" />
          知道了
        </Button>
      </div>
    </aside>
  );
}
