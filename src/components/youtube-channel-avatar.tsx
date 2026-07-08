'use client';

import { Loader2, UserRound } from 'lucide-react';
import type { ChannelAvatarState } from '@/lib/youtube-channel-avatar';

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
  const sizeClass = size === 'xs' ? 'h-7 w-7' : size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
  const iconClass = size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const canOpen = clickable && avatar.status === 'ready' && Boolean(avatar.channelUrl);
  const fallbackText = fallback?.trim().charAt(0).toUpperCase();
  const content = (
    <>
      {avatar.status === 'loading' ? (
        <Loader2 className={`${iconClass} animate-spin text-primary`} />
      ) : avatar.status === 'ready' && avatar.avatarUrl ? (
        <img
          src={avatar.avatarUrl}
          alt={label}
          className="h-full w-full rounded-full object-cover"
          referrerPolicy="no-referrer"
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
      <div className={className} title={label}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${className} transition hover:ring-primary/35`}
      title={`${label}，点击打开 YouTube 频道`}
      onClick={(event) => {
        event.stopPropagation();
        window.open(avatar.channelUrl, '_blank', 'noopener,noreferrer');
      }}
    >
      {content}
    </button>
  );
}
