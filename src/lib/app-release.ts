export type AppRelease = {
  version: string;
  releasedAt: string;
  title: string;
  highlights: string[];
};

export const APP_RELEASE_LAST_SEEN_STORAGE_KEY = 'influencer-board-last-seen-release';

export const APP_RELEASES: readonly AppRelease[] = [
  {
    version: '1.1.1',
    releasedAt: '2026-08-17',
    title: '用户使用体验优化',
    highlights: [
      '账号后台保持长时间登录',
      '开发信生成记录保存从浏览器缓存改为云端',
    ],
  },
  {
    version: '1.1.0',
    releasedAt: '2026-08-15',
    title: '邮件处理体验更新',
    highlights: [
      'Gmail 登录和邮件列表更加稳定',
      '修复切换邮箱视图时的缓存问题',
      '新增邮件生成进度和后台任务处理，并可在上方查看邮件生成进度',
      '邮件视图可通过移动分割线调整标题和邮件正文的画面比例',
    ],
  },
];

const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function parseAppVersion(version: string) {
  if (!APP_VERSION_PATTERN.test(version)) return null;
  return version.split('.').map(Number);
}

export function isValidAppVersion(version: string) {
  return parseAppVersion(version) !== null;
}

export function compareAppVersions(left: string, right: string) {
  const leftParts = parseAppVersion(left);
  const rightParts = parseAppVersion(right);
  if (!leftParts || !rightParts) return 0;

  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function getUnseenAppReleases(
  lastSeenVersion: string | null,
  releases: readonly AppRelease[] = APP_RELEASES,
) {
  if (lastSeenVersion !== null && !isValidAppVersion(lastSeenVersion)) return [];

  return releases
    .filter((release) => (
      lastSeenVersion === null || compareAppVersions(release.version, lastSeenVersion) > 0
    ))
    .slice()
    .sort((left, right) => compareAppVersions(right.version, left.version));
}

export const CURRENT_APP_RELEASE = APP_RELEASES
  .slice()
  .sort((left, right) => compareAppVersions(right.version, left.version))[0];
