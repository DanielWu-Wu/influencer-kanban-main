# 红人推广工作台交接文档

> **唯一现役交接版本**
>
> 更新时间：2026-08-11
>
> 当前已提交基线：`main` / `48437c9`（增加对多个飞书主体的多维表格授权支持），与 `origin/main` 一致。
> 本次洁癖收尾开始前无未提交业务代码；只有未跟踪的团队配置操作手册。收尾只同步 `.env.example`、`README.md` 和本文件，不提交代码。
>
> 根目录 `HANDOFF.md`、`PROJECT_HANDOFF.md`、`TODO.md` 与 `docs/AI_HANDOFF.md`
> 仅为历史入口，不代表当前代码状态或优先级。

## 0. 新对话接手顺序

1. 完整阅读根目录 `AGENTS.md` 和本文件。
2. 运行 `git status --short --branch`、`git log -5 --oneline`，检查当前差异并保留所有既有修改。
3. 根据用户的新需求阅读真实入口代码；不要只依据旧截图、提交说明或历史交接推断。
4. 修改前先用中文说明业务目标、涉及模块、影响范围和最小实现方案。
5. Gmail 草稿/发送、飞书写回、字段结构、密钥和部署仍属于高风险动作；必须保留现有人工确认边界。

## 1. 项目定位与核心入口

这是面向跨境电商海外红人推广专员的桌面 CRM 工作台，覆盖：YouTube 红人发现、
飞书双表建档、Gmail 开发信与 Follow Up、AI 翻译/起草、每日待办、工作日历、
合作履约跟进和邮件告知。AI 负责辅助判断和生成，真实外部动作由用户确认。

主要入口：

- 应用壳与导航：`src/app/page.tsx`
- 红人开发台：`src/components/creator-prospecting-page.tsx`
- 开发信 Follow Up：`src/components/creator-prospecting/outreach-follow-up-tab.tsx`
- Gmail：`src/components/gmail-page.tsx`、`email-composer.tsx`、`new-email-composer.tsx`
- 每日待办：`src/components/todo-board.tsx`、`src/lib/use-daily-gmail-todos.ts`
- 工作日历：`src/components/work-calendar.tsx`、`src/lib/local-date.ts`
- 合作项目：`src/components/cooperation-projects-page.tsx`、`src/lib/cooperation-projects.ts`
- 飞书：`src/lib/feishu-record-index.ts`、`feishu-batch.ts`、`feishu-mapping.ts`
- 飞书成员应用授权：`src/components/feishu-settings.tsx`、`src/lib/feishu-app-credentials.ts`、`src/lib/server-secret-envelope.ts`
- 设置：`src/components/settings-panel.tsx`、`gmail-signature-settings.tsx`
- AI 邮件回复与模板：`src/components/email-detail.tsx`、`email-composer.tsx`、`ai-template-reply-composer.tsx`、`ai-reply-template-manager.tsx`
- 账号与权限：`src/components/auth-provider.tsx`、`admin-accounts-panel.tsx`、`src/app/api/account/**`、`src/app/api/admin/accounts/route.ts`

### 账号管理与完全隔离

- 使用 Supabase Auth 登录，唯一主管理员由服务端 `APP_ADMIN_USER_ID` 指定；管理员不能在页面转让或新增管理员。
- 管理员可手动创建账号、填写或修改姓名备注、停用、恢复和重置临时密码；不发送邀请邮件，也不提供永久删除。
- 新账号及被重置密码的账号必须先修改临时密码；未完成改密或已停用账号不能访问业务数据。
- `account_profiles` 保存账号元数据，`user_data` 以 `user_id + data_key` 保存账号业务数据；设置、产品、红人开发及用户密钥均由 RLS 限制为当前正常账号。
- 管理员页面只读取账号元数据，不能读取成员密码、业务数据、Gmail 内容、飞书授权或密钥。
- Gmail、飞书、AI/YouTube 密钥与缓存均绑定当前账号；同一浏览器切换账号不会复用其他账号的资料或授权。
- 账号状态检查已区分明确停用/未开通/会话失效和临时网络或服务异常。临时异常保留同一账号已加载的工作台并允许重试，不再自动当作账号停用退出。
- 账号管理依赖 `20260806_account_management.sql`、`20260807_account_admin_permissions.sql`、`SUPABASE_SECRET_KEY` 和 `APP_ADMIN_USER_ID`；Secret Key 仅允许服务端使用。
- 每位成员可配置自己企业的飞书自建应用。App Secret 使用服务端 `APP_SECRET_ENCRYPTION_KEY` 加密后保存在当前账号私密空间；管理员和其他成员不能读取。

## 2. 当前已实现能力

### 红人录入与飞书建档

- 支持批量识别 YouTube 频道、头像、近期长视频、公开邮箱、国家和推荐开发信语言。
- 飞书资源库/开发记录双表查重使用 60 秒快照和一次性索引；精确键冲突会阻止静默写入。
- “加入资源库”“新建开发记录”“快速建档”均先展示确认预览，确认后弹窗立即关闭，后台批量写入。
- 写入前按当前红人重新校验，其他红人的正常写入不再触发错误的“飞书数据已变化”提醒。
- 欧洲国家代码写入中文国家名；乌克兰等西里尔文本不会再因 `.com` 邮箱误判为葡萄牙语。
- 新建资源、开发记录和邮箱补写统一提取有效邮箱；飞书富文本对象不会再写成 `[object Object]`。
  服务端还会拦截任何包含该异常标记的待写字段。
- 邮箱候选会合并 YouTube 公开简介、资源库和开发历史记录，忽略大小写去重；来源冲突或多邮箱要求人工选择，手动填写/清空/选择后自动锁定，后续识别不会覆盖。
- 飞书写入必须使用用户保存的字段映射；不得硬编码字段名或自动修改表结构。

### 开发信、Follow Up 与 Gmail

- 首封开发信可按中文对照修改后重新翻译为目标语言；保存 Gmail 草稿前仍需人工检查。
- 当前单人流程约定：首封开发信草稿保存成功后，用户立即前往 Gmail 手动发送；系统不得自动发送。
- 一次/二次 Follow Up 读取真实 Gmail `SENT`、`DRAFT`、人工回复、自动回复和退信状态。
- 单条和批量按钮只在当前浏览器标签页后台生成目标语言正文与中文对照，不立即创建 Gmail 草稿或写飞书；结果按账号缓存 30 天，关闭/刷新标签页不保证任务继续。
- 审核窗口允许修改中文，必须点击“根据中文更新外文”后才能保存；批量结果逐封审核、逐封保存，不提供全部直接保存。
- 用户明确点击“保存到 Gmail 草稿”前会再次检查回复、退信和重复跟进；草稿成功后按当前运营约定写回对应 Follow Up 状态和当天日期。Gmail 成功而飞书失败时只重试写回，不重复创建草稿。
- Gmail AI 回复读取同一联系人最近 10 封往来，复用线程正文、缓存分析结果并支持 SSE 流式正文；
  不支持流式时回退普通 AI 路由。
- Gmail 搜索直接使用 Gmail 全局查询，可搜索较早邮件；每日待办箭头可打开指定线程。
- 每封真实 Gmail 邮件都可被选择为回复上下文锚点，即使没有飞书红人匹配；线程展示 From/To/Cc 参与者，自发邮件有多个候选收件人时要求人工选择，未确认收件人仍可生成但不能保存草稿。
- AI 回复的中文对照要求完整简体中文，并做中文比例和英文复制校验；外文正文与中文对照均支持流式显示。中文可编辑，确认后重新翻译目标语言。
- AI 回复模板提供物流、折扣、常规合作和联盟邀请等内置规则，也支持当前账号独立的个人模板；模板管理使用编辑入口而非复制图标。
- Mailsuite/Mailtrack 等通知地址在联系人解析和 Gmail 草稿 API 两层拦截。
- Gmail 签名新增三选一范围：仅开发信、仅正常邮件、两者都生效；旧配置默认按两者都生效。
  AI 提示词明确禁止签名，程序还会按当前账号配置的签名内容移除 AI 末尾重复姓名/落款，再由统一渲染逻辑追加项目内签名。
- 合作项目的物流/折扣告知邮件支持中文对照编辑、重新润色翻译、后台生成和回复最近邮件线程；
  只创建 Gmail 草稿，不自动发送；用户确认保存草稿成功后，自动勾选飞书中对应的“物流信息已告知”或“折扣信息已告知”。
  Gmail 成功而飞书同步失败时保留已创建的草稿，并提供仅重试飞书同步的入口，不重复创建草稿。
  发货日期在交给 AI 前统一转换为上海业务时区的 `YYYY-MM-DD`，不允许模型自行换算时间戳、时区或从物流编号推断日期。

### 合作项目

- 读取飞书“详细合作记录表”，提供列表、看板、日历、搜索、风险和阶段多选筛选。
- 七阶段由日期与业务字段自动计算；视频已发布等已完成合作不再显示阶段停留天数。
- 阶段日期统一显示为中文年月日；发货、到货、拍摄完成和实际上线日期可在详情中修改。
- “物流信息已告知”“折扣信息已告知”可勾选或撤销；日期和复选框均在后台静默写回，成功/失败提示。
- 频道头像优先由映射的频道链接解析 Channel ID 后调用 YouTube API，列表缓存结果并回退字母头像。
- 合作项目与红人列表切换使用缓存和显式刷新，减少重复读取飞书。

### 每日待办与工作日历

- 手动任务支持标题、放大描述、优先级、默认当日截止日期、截止时间、编辑、删除、完成和恢复；高密度行布局可在一屏显示更多任务。
- 待办分为“待完成、今日已完成、历史已完成”三组，三组均可折叠；已完成任务可以恢复，未手动完成的任务持续保留。
- Gmail 任务查询收件箱最近三天活跃线程，排除推广/社交、本人发信、自动回复、退信及 Mailsuite/Mailtrack 通知；每个线程只保留最新外部来信，再严格校验近 72 小时和飞书红人联系邮箱匹配。
- Gmail 任务会匹配资源库红人、显示频道头像并使用 AI 生成一句话中文摘要；历史完成项保留与待完成时相同的摘要。
- 回到每日待办或点击“刷新来信”会检查线程是否已由当前账号回复；已回复任务自动完成，新外部来信晚于上次完成时间时重新进入待完成。完成状态不修改 Gmail 已读状态或飞书数据。
- Gmail 任务、摘要和完成记录通过当前账号的 `user_data` 保存，不与其他账号共享。
- 工作日历同时展示手动日程、未完成待办和飞书合作项目六类只读节点：确认合作、发货、到货、拍摄完成、预计上线、实际上线。
- 合作节点按需读取，普通进入复用 60 秒飞书缓存，支持手动刷新；失败只提示错误，不影响原有日程和待办。
- 月历单格最多展示 2 条合作节点，超出显示“还有 N 项”；预计上线已过期且缺少实际上线日期时显示红色。
- 点击日期只打开当天只读详情，不会自动创建日程；独立“新增日程”按钮位于“刷新项目”左侧。合作节点显示频道头像。
- 点击合作节点可切换到合作项目并自动打开对应详情；工作日历不修改合作节点，也不改变原有飞书写回流程。
- 日期构造使用本地日期工具，避免 UTC 转换导致工作日历偏移一天。

## 3. 外部写入与数据边界

- 不自动发送 Gmail，不自动群发开发信。
- Gmail 草稿、飞书创建/更新仍由用户明确点击确认；后台执行只改变等待体验，不扩大授权。
- 不自动清理历史 Gmail 草稿或飞书异常数据。现有 `[object Object]` 邮箱记录如需批量修复，
  应另做“只读扫描 → 变更预览 → 用户确认 → 批量写回”。
- YouTube API 只能读取公开频道资料；隐藏邮箱不可获取，邮箱只能从公开内容提取或人工填写。
- AI 模型由用户配置 OpenAI-compatible 接口；项目不内置 DeepSeek，也不能假设任意代理地址兼容。
- 设置页可按提供商自动填充常用 API 地址和推荐模型，并提供三步指引与连接测试；自定义兼容接口仍需用户核对真实 Base URL/完整 endpoint 和模型名。
- `APP_SECRET_ENCRYPTION_KEY` 只允许保存在服务端并保持稳定；更换后既有成员的飞书 App Secret 无法解密，需要逐人重新配置。

## 4. 当前验证状态

| 事实面 | 状态 | 当前证据 |
| --- | --- | --- |
| 代码基线 | verified-current | `main` / `48437c9`，与 `origin/main` 对齐 |
| TypeScript | changed-and-verified | 2026-08-11：`tsc -p tsconfig.json --noEmit` 通过 |
| ESLint | changed-and-verified | 2026-08-11：全仓库 0 error、7 个 warning |
| 纯逻辑测试 | pending | 2026-08-11：整套 `node:test` 仍被本机 `esbuild spawn EPERM` 阻止，不能写成当前整套已通过 |
| 生产构建 | pending | 本轮未运行；此前本机曾在 Next.js worker 阶段遇到 `spawn EPERM`/内存限制 |
| Supabase 账号迁移 | verified-current | 2026-08-07：用户在生产 SQL Editor 执行迁移，校验查询显示账号表、用户数据表、RLS、策略和检查函数均存在 |
| 浏览器交互 | partially-verified | 用户已通过生产页面使用部分 Gmail/AI 功能并反馈；本轮没有逐项复验本次对话全部功能 |
| Gmail/飞书真实写入 | pending | 本轮未自动创建草稿、发送邮件或写飞书；Follow Up 幂等重试、任意邮件回复、老邮件搜索和多人飞书仍需真实端到端验收 |
| 多人飞书 | pending | 代码已支持逐账号企业应用凭证、加密和 OAuth；仍需至少一个真实成员完成保存凭证、授权、三表映射、读写及账号切换隔离验收 |
| 部署 | deployed-unverified | 用户说明 `48437c9` 已提交并重新部署；本轮未读取 Vercel deployment marker 或 canonical 生产页面，不能写成 live verified |

现有 7 个 ESLint warning：

- `email-detail.tsx`：1 个原生 `<img>` 性能提示。
- `reminder-panel.tsx`：6 个未使用图标导入。

## 5. 下一轮优先验收

1. 用一个真实成员账号完整验证：保存自己的飞书 App ID/App Secret → 一键授权 → 配置三张表 → 只读检查/自动映射 → 人工确认一次写回 → 切换管理员确认数据、授权和密钥不串号。
2. Follow Up 单条和批量分别验证：后台生成不建草稿、中文修改后必须翻译、保存前二次检查、Gmail 草稿成功后写回飞书、写回失败重试不重复建草稿。
3. Gmail 验证较早邮件全局搜索、选择较早来信回复、自己发出的多收件人邮件、无飞书匹配邮件，以及草稿是否进入正确线程。
4. Gmail 签名三种范围分别检查开发信、Follow Up、正常新邮件/回复和合作项目邮件，确认 AI 不再重复姓名/落款。
5. 每日待办验证回到页面和点击“刷新来信”均能把已回复线程自动完成，三组折叠、中文摘要和箭头跳转保持正确。
6. 工作日历验证点击日期只查看详情，“新增日程”独立工作，合作节点头像和项目跳转正确。
7. 真实账号验收必须由用户在页面明确点击；不得用自动化测试创建 Gmail 草稿或写飞书。

## 6. Git、工作区与清场预览

- 主工作区：`main...origin/main`，基线 `48437c9`；本次收尾前无未提交业务代码。
- 本次洁癖只修改 `.env.example`、`README.md` 与 `docs/HANDOFF.md`，不会提交、推送或部署。
- `docs/团队成员三项服务零基础配置操作手册.docx` 是未跟踪文件，包含本次团队接入说明；本轮保护现场，不提交、不移动、不删除。
- 另有 detached worktree：`C:/Users/Admin/.codex/worktrees/347c/influencer-kanban-main`，
  HEAD `de11118`，其中有 4 个未提交文件。该 worktree 含唯一修改，绝对不能自动删除。
- 根目录两个 `.codex-dev-server.*.log` 当前均为 0 字节且已被 Git 忽略，可列为删除候选；
  本轮保留现场，等待用户看完汇报后另行确认。
- `.env.local`、`.next`、`node_modules`、本地 pnpm 运行包和 `tsconfig.tsbuildinfo` 均已忽略；
  不属于本次文档收尾的清理范围。

## 7. 常用验证命令

```powershell
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\eslint\bin\eslint.js .
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --import tsx tests\run-tests.ts
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe status --short --branch
```

如果纯逻辑测试或 Next.js 构建出现 `spawn EPERM`，应标记为环境受限并保留 `pending`；
不要把 TypeScript 通过等同于整套测试或生产构建通过。

## 8. 明确尚未实现的后续需求

- AI 识别到可写回飞书的信息后，形成变更预览并提醒用户确认写回。
- AI 识别到合作状态变化后，形成状态变更建议并提醒用户确认更新合作项目。
- 上述两项必须沿用“AI 只建议 → 用户确认 → 执行写回 → 保留成功/失败反馈”的边界，不能自动修改飞书。

## 9. 下一对话建议开场

```text
请接手并继续维护这个项目：
C:\Users\Admin\Documents\Codex\influencer-kanban-main

开始任何修改前，请完整读取项目根目录的 AGENTS.md 和 docs/HANDOFF.md，并检查：
1. 当前 Git 分支、最近提交、是否与 origin/main 对齐；
2. 所有未提交改动和完整 diff；
3. 与新需求直接相关的真实代码和现有业务流程；
4. 账号隔离、Supabase RLS、缓存、Gmail 人工确认和飞书字段映射边界。

当前交接基线是 main / 48437c9，与 origin/main 对齐。上次洁癖收尾只修改了
.env.example、README.md、docs/HANDOFF.md，没有提交、推送或部署。
另有未跟踪文件 docs/团队成员三项服务零基础配置操作手册.docx，请保护它，不要删除、移动或擅自提交。
另有 detached worktree：
C:\Users\Admin\.codex\worktrees\347c\influencer-kanban-main
其中包含未提交代码，绝对不要触碰、清理、移动或回退。

当前 TypeScript 已通过；ESLint 为 0 error、7 warning；整套纯逻辑测试仍受本机
esbuild spawn EPERM 限制。用户说明当前版本已重新部署，但尚未核对 Vercel marker 和完整生产验收。

下一阶段优先事项：
- 先用真实团队成员账号验收每人独立飞书企业应用授权、三表映射和账号隔离；
- 验收 Follow Up 审核/保存/飞书幂等写回、Gmail 老邮件搜索和任意邮件回复；
- 后续待开发：AI 识别可写回信息后的飞书确认提醒，以及识别合作状态变化后的项目状态确认提醒。

工作原则：用中文沟通，把我视为不懂编程的用户；先说明业务目标、涉及模块、影响范围和最小低风险方案。
不安装新依赖，不做无关重构，不自动发送 Gmail，不绕过飞书字段映射，不擅自修改数据库、权限、环境变量、部署或外部数据。
涉及高风险操作必须先征求确认；不要提交、推送或部署，除非我明确要求。
```
