# PROJECT_HANDOFF

## 项目名称和目标

项目名称：**红人推广 / Influencer Ops 工作台**

目标：为跨境电商海外红人推广专员提供一个桌面运营工作台，把 YouTube 红人开发、飞书多维表格记录、Gmail 邮件跟进、AI 辅助生成/翻译/回复、产品资料和合作状态管理集中在一个可控流程中。

核心原则：

- AI 辅助判断和起草，人类负责确认和外部写入。
- Gmail 开发信只创建草稿，绝不自动发送。
- 飞书写入使用字段映射，不硬编码字段名。
- 操作体验优先：减少重复点击，保留清晰确认点。

## 当前产品定位

这是一个 **B2B 海外红人推广运营工作台**，不是营销展示页。用户是没有编程背景的红人开发/商务运营人员，重点需要：

- 快速录入和查重红人。
- 判断红人是否适合开发。
- 生成个性化开发信。
- 把 Gmail 草稿和飞书开发状态保持一致。
- 在一个页面内尽量完成判断，减少来回切换飞书/Gmail/YouTube。

UI 方向是清爽、现代、信息密度高的桌面工作台，轻 Glassmorphism 风格，避免花哨动效和复杂视觉。

## 当前核心业务流程

主流程集中在 **红人开发台**：

1. **红人录入**
   - 批量粘贴 YouTube 频道链接、`@handle`、频道 ID。
   - 点击“识别频道”后解析 YouTube 频道信息。
   - 系统自动进行飞书双表查重。
   - 用户可补充邮箱。
   - 用户判断资源库/开发记录是否已有。
   - 可加入红人资源库或新建红人开发记录。

2. **邀约确认**
   - 选择目标产品。
   - 选择合作形式。
   - 填写合作想法。
   - 选择开发信语言。
   - AI 可识别联系人姓名和语言，用户可手工修改。
   - 必填信息齐全后才能进入生成开发信。

3. **开发信**
   - AI 根据红人频道资料、最近长视频、目标产品、合作想法等生成开发信。
   - 生成 3 个备选标题及中文翻译。
   - 可单独重新生成标题或正文。
   - 可预览产品链接、产品主图、签名链接。
   - 保存 Gmail 草稿后，线索自动移出开发信队列，并自动把飞书双表“初次开发信”标记为“已发”。
   - 邮件仍需用户进入 Gmail 手动检查和发送。

## 当前已完成的功能

### 红人开发台

- 从杂糅工作台重构为 3 个流程 Tab：红人录入、邀约确认、开发信。
- 支持两套飞书表配置：
  - 红人资源库：连接“红人信息数据库”。
  - 红人开发记录表：连接“红人开发情况表”。
- 新增 Supabase 本地表：
  - `creator_prospects`
  - 迁移文件：`supabase/migrations/20260702_creator_prospects.sql`
- 识别 YouTube 频道时拉取最近 8 条超过 3 分钟的长视频。
- 视频标题默认翻译成中文展示。
- 展示播放量、点赞数、评论数、ER。
- Shorts / 不超过 3 分钟视频不补足。
- 点击“识别频道”后自动进行飞书查重。
- 国家/语言在红人开发台中以中文展示，避免直接显示国家代码。
- 邮箱可在红人录入列表里直接填写，并参与双表写入。
- 新建开发记录时，若已关联资源库且资源库邮箱为空或缺少当前邮箱，会自动补写/换行追加邮箱。
- 资源库疑似收录时，hover 可查看飞书资源库疑似记录预览。
- “确认可建”已改为“确认为新红人”，减少歧义。

### 查重逻辑

精确匹配会判定为已收录：

- YouTube `channelId` 与飞书资源库字段映射中的频道 ID 一致。
- 标准化 YouTube 频道链接一致。
- 联系邮箱一致。

疑似匹配需要人工确认：

- YouTube handle 相同。
- 频道名相同。

### 邀约确认

- 增加联系人姓名字段。
- AI 根据频道名和频道简介识别联系人姓名，并显示置信度。
- 人工修改姓名后视为人工确认。
- 增加开发信语言字段。
- AI 根据频道简介/视频标题识别语言，例如波兰语、瑞典语、荷兰语。
- 未选择目标产品、合作形式、合作想法、开发信语言时，不能进入生成开发信。
- “确认生成开发信”已优化为点击后直接开始生成开发信，不再要求多点一次。

### 开发信

- “查看邮件提示词”弹窗分为：
  - 邮件生成规则
  - 本次红人资料
- 本次红人资料和实际传给 AI 的数据使用同一套构建逻辑。
- AI 输入包括联系人姓名、频道简介、最近长视频、目标产品、合作形式、合作想法、开发备注、开发信语言。
- 产品下拉最多读取前 20 个启用产品。
- AI 只接收当前选中的产品资料。
- 支持 3 个备选标题及中文翻译。
- 支持邮件标题和正文分别重新生成。
- 开发信正文预览支持：
  - 产品型号自动链接到产品页面。
  - 插入产品主图。
  - 产品主图可在段落间调整位置。
  - 签名链接。
- 修复过开发信正文中残留 HTML/占位文案的问题。
- 保存 Gmail 草稿后：
  - 线索移出开发信队列。
  - 自动写回飞书双表“初次开发信 = 已发”。
  - Gmail 不自动发送。

### 产品数据库

- 设置页产品数据库从复杂市场配置简化为产品资料卡。
- 默认显示：
  - 产品名称
  - 产品型号
  - 产品页面链接
  - 产品描述/卖点
  - 产品主图上传
  - 产品状态
- 技术参数、内部备注、市场/站点资料放到高级资料折叠区。
- 支持 1 张产品主图，前端压缩后保存到现有 `imageAndResourceLinks` 字段。
- 不新增 Supabase Storage，不改数据库结构。
- 产品卡片展示主图缩略图、产品名/型号、链接、卖点摘要、状态。

### Gmail

- Gmail 页面支持收件箱、未读、星标、已发送、草稿等基础视图。
- 支持翻译、AI 辅助回复、草稿、延迟发送等流程。
- Gmail 翻译做过提速：
  - 默认优先当前邮件正文。
  - 引用历史可后续扩展。
  - 复用翻译缓存。
- AI 回复默认读取最近较少历史邮件，避免过慢。
- Gmail 红人频道头像：
  - 详情页显示红人 YouTube 头像。
  - 邮件列表星标旁显示小头像。
  - 浏览器 `localStorage` 缓存头像 30 天。
  - 当前页预取头像，限制并发，降低 YouTube API 消耗。

### 飞书

- 支持红人资源库和红人开发记录表。
- 支持字段检查和字段映射。
- 支持写入预览和确认。
- 支持内容类型字段读取飞书选项，并自动根据频道内容做初步标签推断。
- 写入资源库时备注默认简化为 `来源：红人开发台`，并允许用户在确认弹窗中修改备注。
- 写入资源库时平台字段写入 `YouTube`，多选字段也允许写单项。

### AI 助手入口

- 从右下角长条按钮改成可拖动圆形悬浮球。
- 靠近屏幕边缘自动半隐藏。
- 鼠标悬停后自动浮出。
- 图标改为居中的机器人图标。

## 当前代码结构和关键文件

重点文件：

- `src/components/creator-prospecting-page.tsx`
  - 红人开发台主容器。
  - 维护 prospects 状态、YouTube 识别、飞书查重、写入飞书、生成开发信、保存 Gmail 草稿等主流程。
- `src/components/creator-prospecting/influencer-import-tab.tsx`
  - 红人录入 Tab。
  - 展示批量识别结果、邮箱输入、飞书双表状态、疑似收录 HoverCard、操作按钮。
- `src/components/creator-prospecting/invitation-confirm-tab.tsx`
  - 邀约确认 Tab。
  - 产品、合作形式、合作想法、语言、联系人姓名等确认。
- `src/components/creator-prospecting/outreach-email-tab.tsx`
  - 开发信审核 Tab。
  - 标题、正文、预览、产品主图位置、保存 Gmail 草稿。
- `src/lib/creator-prospecting.ts`
  - 红人开发台类型、状态、迁移、格式化、业务判断。
- `src/lib/outreach-context.ts`
  - 构建 AI 开发信上下文。
- `src/lib/outreach-email-rendering.ts`
  - 邮件 HTML 渲染、产品主图/链接处理。
- `src/lib/outreach-languages.ts`
  - 开发信语言展示和推断相关工具。
- `src/app/api/youtube/resolve/route.ts`
  - YouTube 频道解析和最近视频获取。
- `src/app/api/ai/route.ts`
  - AI 生成和分析入口。
- `src/app/api/gmail/route.ts`
  - Gmail 草稿/发送/邮件操作入口。
- `src/components/feishu-settings.tsx`
  - 飞书连接和字段映射设置。
- `src/components/record-assistant-provider.tsx`
  - AI 助手入口和记录辅助。

## 重要状态和字段

红人开发台主要状态：

- `workflowStatus`
  - `recorded`
  - `resolved`
  - `dedupe_completed`
  - `invitation_pending`
  - `outreach_pending`
  - `outreach_generated`
  - `gmail_draft_saved`
  - `skipped`
  - `error`
- `resourceStatus`
  - `unchecked`
  - `checking`
  - `missing`
  - `exists`
  - `suspected`
  - `error`
- `developmentStatus`
  - `unchecked`
  - `checking`
  - `missing`
  - `exists`
  - `suspected`
  - `error`
- `emailStatus`
  - `missing`
  - `available`
  - `manual`
- 关键 ID：
  - `resourceRecordId`
  - `feishuRecordId`
  - `duplicateRecordId`
  - `gmailDraftId`

飞书字段语义必须走 `src/lib/feishu-mapping.ts` 中的 mapping key，例如：

- `channelName`
- `email`
- `channelUrl`
- `channelId`
- `region`
- `platform`
- `contentType`
- `recentAverageViews`
- `developmentDate`
- `firstOutreach`
- `prospectingStatus`
- `targetProduct`
- `cooperationType`
- `cooperationIdea`
- `priority`
- `gmailDraftId`
- `notes`

## 已确认 UI/UX 方向

- 工作台式布局，信息密度高，适合每天重复操作。
- 避免 landing page、营销式大卡片、过度动画。
- 按钮文案必须直接表达业务动作。
- 外部写入前要清晰提示，但不要制造多余步骤。
- 能在当前页面判断的，就不要逼用户跳去飞书/YouTube/Gmail。
- 状态文字要中文化，避免裸露 `SE`、`sv` 这类代码影响判断。

## 当前未完成问题

- 部分历史代码里曾出现乱码文案，需持续顺手清理，但不要大规模无关重构。
- Gmail 草稿创建偶尔可能失败后重试成功，需要继续观察 API 错误细节。
- Gmail 邮件翻译和 AI 回复仍可能偏慢，后续可考虑流式输出、缓存拆分、模型策略优化。
- 资源库疑似收录 Hover 已完成，开发记录疑似重复还没有同类 Hover 预览。
- YouTube API 头像缓存目前是浏览器本地缓存，换设备/清缓存会重新调用 API。
- 产品主图是 base64/压缩预览方式保存在现有字段中，适合第一版，不适合长期素材库。

## 下一步建议开发任务

建议新对话优先从测试和小修开始：

1. 实测“资源库疑似收录” Hover 预览。
2. 实测“确认为新红人”和“关联资源记录”两个分支。
3. 实测保存 Gmail 草稿后，飞书两个表“初次开发信”是否都自动标为“已发”。
4. 如果第 1-3 步稳定，再给“开发记录疑似重复”增加同类 Hover 预览。
5. 优化 Gmail 草稿创建失败提示，尽量把 Gmail API 返回的真实原因展示出来。
6. 整理设置页字段映射状态，让用户更清楚哪些字段缺失会影响哪些流程。

## 不要随意改动

- 不要自动发送 Gmail 邮件。
- 不要硬编码飞书字段名。
- 不要随意修改 Supabase 表结构、飞书字段结构、OAuth 权限、环境变量。
- 不要删除或覆盖用户本地未提交修改。
- 不要把 YouTube API 当作隐藏邮箱来源。
- 不要把 DeepSeek 当作项目内置服务。
- 不要为了“高级感”引入新框架、新依赖或复杂架构。
- 不要把产品主图直接传给 AI；AI 只需要知道是否有主图，图片主要用于人工预览和邮件 HTML。

## 已讨论但暂时不做

- 开发信质检面板：当前“邮件审核队列”已经够用，暂时不做，避免功能过多。
- 完整产品素材库：第一版只支持 1 张产品主图，不做多图/素材管理。
- 服务器版 YouTube 头像缓存：先用浏览器本地缓存，后续若要做 Supabase 服务器缓存，必须先确认数据库结构变更。
- 自动发送开发信：明确不做。
- 自动批量写飞书/自动批量发邮件：不做，关键外部写入保留人工确认或明确动作触发。
- 大规模重构 UI/状态管理：暂时不做，优先保证业务流程稳定。

## 给新 Codex 对话的建议开场

```text
请继续优化 C:\Users\Admin\Documents\Codex\influencer-kanban-main 项目。
请先阅读 README.md、PROJECT_HANDOFF.md、TODO.md 和 docs/AI_HANDOFF.md。
当前重点是测试和小步优化红人开发台，不要自动发送 Gmail，不要硬编码飞书字段，不要改数据库结构。
```
