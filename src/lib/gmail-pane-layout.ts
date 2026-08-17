export const GMAIL_THREAD_LIST_DEFAULT_WIDTH = 460;
export const GMAIL_THREAD_LIST_MIN_WIDTH = 88;
export const GMAIL_THREAD_LIST_MAX_WIDTH = 680;
export const GMAIL_THREAD_LIST_MIN_DETAIL_WIDTH = 480;
export const GMAIL_THREAD_LIST_AVATAR_ONLY_WIDTH = 240;

export function getGmailThreadListMaxWidth(availableWidth: number) {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return GMAIL_THREAD_LIST_MAX_WIDTH;
  }

  return Math.max(
    GMAIL_THREAD_LIST_MIN_WIDTH,
    Math.min(
      GMAIL_THREAD_LIST_MAX_WIDTH,
      Math.floor(availableWidth * 0.48),
      Math.floor(availableWidth - GMAIL_THREAD_LIST_MIN_DETAIL_WIDTH),
    ),
  );
}

export function clampGmailThreadListWidth(width: number, availableWidth: number) {
  const safeWidth = Number.isFinite(width) ? width : GMAIL_THREAD_LIST_DEFAULT_WIDTH;
  return Math.min(
    getGmailThreadListMaxWidth(availableWidth),
    Math.max(GMAIL_THREAD_LIST_MIN_WIDTH, Math.round(safeWidth)),
  );
}

export function parseStoredGmailThreadListWidth(value: string | null) {
  if (!value) return GMAIL_THREAD_LIST_DEFAULT_WIDTH;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : GMAIL_THREAD_LIST_DEFAULT_WIDTH;
}

export function getGmailThreadListDoubleClickWidth(width: number) {
  return width <= GMAIL_THREAD_LIST_MIN_WIDTH
    ? GMAIL_THREAD_LIST_DEFAULT_WIDTH
    : GMAIL_THREAD_LIST_MIN_WIDTH;
}

export function isGmailThreadListAvatarOnly(width: number) {
  return width < GMAIL_THREAD_LIST_AVATAR_ONLY_WIDTH;
}
