'use client';

import { useEffect, useState } from 'react';
import { Loader2, UserRound } from 'lucide-react';
import {
  invalidateChannelAvatarCache,
  type ChannelAvatarState,
} from '@/lib/youtube-channel-avatar';

export function YouTubeChannelAvatar({
  avatar,
  fallback,
  label,
  size = 'md',
  clickable = true,
}: {
  avatar: ChannelAvatarState;
  fallback?: string;
  label: string;
  size?: 'xs' | 'sm' | 'md';
  clickable?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const sizeClass = size === 'xs' ? 'h-7 w-7' : size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
  const iconClass = size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const canOpen = clickable && avatar.status === 'ready' && !imageFailed && Boolean(avatar.channelUrl);
  const fallbackText = fallback?.trim().charAt(0).toUpperCase();
  const title = imageFailed
    ? `${label}：头像图片加载失败，刷新后将重新获取`
    : avatar.status === 'failed' && avatar.error
      ? `${label}：${avatar.error}`
      : label;

  useEffect(() => {
    setImageFailed(false);
  }, [avatar.avatarUrl]);

  const content = (
    <>
      {avatar.status === 'loading' ? (
        <Loader2 className={`${iconClass} animate-spin text-primary`} />
      ) : avatar.status === 'ready' && avatar.avatarUrl && !imageFailed ? (
        // YouTube returns dynamic CDN hosts, so a plain img avoids maintaining a brittle host allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar.avatarUrl}
          alt={label}
          className="h-full w-full rounded-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => {
            invalidateChannelAvatarCache(avatar.cacheKey);
            setImageFailed(true);
          }}
        />
      ) : fallbackText ? (
        <span className="text-xs font-medium text-primary">{fallbackText}</span>
      ) : (
        <UserRound className={`${iconClass} text-primary`} />
      )}
    </>
  );
  const className = `${sizeClass} flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 ring-1 ring-primary/10`;

  if (!canOpen) {
    return (
      <div className={className} title={title}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${className} transition hover:ring-primary/35`}
      title={`${title}，点击打开 YouTube 频道`}
      onClick={(event) => {
        event.stopPropagation();
        window.open(avatar.channelUrl, '_blank', 'noopener,noreferrer');
      }}
    >
      {content}
    </button>
  );
}
