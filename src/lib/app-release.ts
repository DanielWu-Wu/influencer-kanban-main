export type AppRelease = {
  version: string;
  releasedAt: string;
  title: string;
  highlights: string[];
};

export const APP_RELEASE_LAST_SEEN_STORAGE_KEY = 'influencer-board-last-seen-release';

export const APP_RELEASES: readonly AppRelease[] = [
  {
    version: '1.2.4',
    releasedAt: '2026-08-29',
    title: '邮件处理体验与稳定性优化',
    highlights: [
      '优化 Gmail 与腾讯企业邮箱的待办邮件预翻译，打开来信时更快看到中文内容。',
      '支持恢复近期生成的 AI 邮件内容，减少重复生成和等待。',
      '提升红人识别稳定性，避免翻译或页面刷新时重复匹配。',
      '优化未读邮件样式、AI 回复布局和邮件草稿状态提示。',
    ],
  },
  {
    version: '1.2.3',
    releasedAt: '2026-08-28',
    title: '邮件处理与工作流体验优化',
    highlights: [
      '手动回复、AI 模板起草和 AI 辅助回复统一使用更舒适的编辑空间。',
      '恢复开发信正文中的产品图片预览，同时保留正文直接编辑能力。',
      '修复部分来信正文无法被 AI 正确读取、被误判为空白的问题。',
      '优化“下一步”流转逻辑：当前阶段还有待处理线索时继续停留，全部完成后自动进入下一阶段。',
      '优化邮件生成进度弹窗，来源邮箱展示更加紧凑，历史记录支持鼠标滚动查看。',
      '完善多处界面细节和交互体验。',
    ],
  },
  {
    version: '1.2.2',
    releasedAt: '2026-08-26',
    title: '邮件时间与生成体验优化',
    highlights: [
      '修复 Gmail 与腾讯企业邮箱部分邮件时间显示异常、最新邮件排序混乱的问题。',
      '邮件生成进度新增百分比和阶段进度条，可以更清楚地查看每封邮件的生成状态。',
      '红人开发台生成开发信后，标题、外文正文和中文对照现在可以直接修改，无需再点击“编辑邮件”。',
    ],
  },
  {
    version: '1.2.1',
    releasedAt: '2026-08-24',
    title: '邮箱与工作流稳定性优化',
    highlights: [
      '修复 Gmail 与腾讯企业邮箱 AI 回复可能引用其他邮件会话的问题，AI 现在只读取当前打开的真实会话。',
      '开发信跟进支持在表头统一选择写信邮箱，单行或批量修改后不再重新加载整张飞书列表。',
      '每日待办优先显示已保存结果并在后台静默更新，切换页面不再重复读取，邮件任务显示也更加简洁。',
      'Gmail 与腾讯邮件打开后自动标记为已读，当前邮件使用白色背景和左侧蓝线显示。',
      '点击“根据中文更新外文”后，邮件编辑器会立即显示绿色的翻译进度提示。',
      '优化账号登录状态恢复，长时间离开后返回页面会优先静默恢复登录。',
    ],
  },
  {
    version: '1.2.0',
    releasedAt: '2026-08-23',
    title: 'Gmail 与腾讯企业邮箱双邮箱升级',
    highlights: [
      '新增腾讯企业邮箱完整工作台。',
      'Gmail 与腾讯企业邮箱可快速切换。',
      '腾讯邮箱全面支持翻译、AI 辅助回复、AI 模板回复和中外文同步更新',
      'Gmail 与腾讯草稿支持无损编辑，保留收件人、抄送、密送、附件、内嵌图片和原有签名',
      '每日待办同时读取 Gmail 和腾讯来信，并显示完整来源邮箱',
    ],
  },
  {
    version: '1.1.6',
    releasedAt: '2026-08-19',
    title: '邮件中文同步外文后台翻译',
    highlights: [
      '“根据中文更新外文”现已加入邮件生成进度',
    ],
  },
  {
    version: '1.1.5',
    releasedAt: '2026-08-18',
    title: 'Gmail 草稿格式优化',
    highlights: [
      '优化邮件默认字体格式，保存到 Gmail 后自动使用 Gmail 原生默认样式。',
    ],
  },
  {
    version: '1.1.4',
    releasedAt: '2026-08-18',
    title: 'Gmail 邮件处理体验优化',
    highlights: [
      '主要收件箱支持后台预翻译近期未读来信，打开邮件时更快看到中文内容',
      '优化邮件已读状态：正文显示后立即标记已读，邮件列表状态同步更加及时',
      '优化 AI 回复语言识别：无需等待红人画像分析完成，也能根据当前来信生成对应语言的邮件',
    ],
  },
  {
    version: '1.1.2',
    releasedAt: '2026-08-17',
    title: '邮件回复体验优化',
    highlights: [
      '“重新生成”会重新起草邮件，并直接覆盖为最新版本',
      '“根据中文更新外文”只更新外文邮件，不影响中文内容',
      '邮件生成进度新增红人频道头像，查找任务更加直观',
      '优化生成任务的保存与恢复体验',
    ],
  },
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
