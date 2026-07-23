# 红人推广工作台交接文档

> **历史文档**：本文件冻结在 2026-07-13，仅保留早期背景。当前唯一现役交接入口是
> `docs/HANDOFF.md`；继续开发前应以该文件、当前 Git 状态和实际代码为准。

## 1. 项目目标和使用场景

项目名称：红人推广 / Influencer Ops。

这是给跨境电商红人运营人员使用的桌面工作台，聚焦 YouTube 海外创作者合作。目标是把以下工作集中到一个可控流程中：

1. 录入、识别 YouTube 频道和公开联系邮箱。
2. 在飞书“红人信息数据库”和“红人开发情况表”中查重、建档、写回。
3. 用 AI 生成首封开发信、跟进信和 Gmail 回复草稿。
4. 保存 Gmail 草稿，由用户在 Gmail 中人工检查和发送。
5. 检查邮件回复，安排二次、三次跟进。
6. 后续覆盖合作履约、视频上线和效果复盘。

**核心原则**：AI 只做分析、起草、预览和建议；Gmail 发送、飞书写回等外部动作必须保持用户明确触发与确认。系统不能自动群发或自动发送邮件。

## 2. 当前技术栈和目录结构

### 技术栈

- Next.js 16.1.1，App Router。
- React 19.2.3、TypeScript 5。
- Tailwind CSS 4、shadcn/ui、Radix UI、lucide-react。
- `@dnd-kit`：合作看板拖拽。
- Supabase：登录、云端设置、用户私密配置与部分本地数据同步。
- 外部 API：Gmail API、飞书多维表格 API、YouTube Data API、OpenAI-compatible AI API。
- 包管理器：pnpm 9。

### 关键目录

```text
src/app/                         页面壳、登录页面、API Route Handlers
src/app/api/                     Gmail、飞书、YouTube、AI、鉴权等服务端接口
src/components/                  业务页面与工作台组件
src/components/creator-prospecting/
                                 红人开发台的录入、邀约、开发信、跟进标签页
src/components/ui/               共用 shadcn 风格基础组件
src/lib/                         类型、业务规则、设置、外部服务辅助函数
src/lib/supabase/                Supabase 客户端/服务端辅助函数
supabase/migrations/             Supabase SQL 迁移
docs/                            历史设计与交接文档
public/                          静态资源
```

## 3. 已经完成的功能

### 工作台基础能力

- 左侧导航已包含每日待办、工作日历、红人开发台、Gmail 邮件、合作看板、红人列表、邮件模板、跟进提醒、设置、AI 提示词等入口。
- 已有基础 `TodoBoard` 和 `WorkCalendar` 组件，但目前主要是手工任务/日历能力，尚不是自动化工作日历。
- 设置页可管理 Gmail、飞书、YouTube、模型、品牌资料、产品资料、提示词等配置。

### 红人开发台

- 支持批量输入 YouTube 频道链接、`@handle`、频道 ID 等，调用 YouTube 解析频道资料和近期视频。
- 支持从公开频道资料提取邮箱；不会、也不能从 YouTube 获取隐藏邮箱。
- 支持飞书资源库与开发记录双表查重，区分已收录、疑似收录、缺失、错误等状态。
- 支持手动填写邮箱；点击“关联资源记录”时，如当前邮箱为空且飞书资源记录有邮箱，会自动补入，但不会覆盖用户已填写的邮箱。
- 支持新建红人开发记录前预览，并在后台检查资源库邮箱同步；多条记录弹窗有内部滚动和固定操作区。
- 邀约确认页支持产品、合作形式、合作想法、优先级、联系人姓名与开发信语言；语言识别使用统一的 AI 判断流程，并显示中文语言名。

### 首封开发信

- 点击“确认生成开发信”后优先进入“开发信”标签页；正文通过 `/api/ai/outreach-stream` 流式显示，标题、中文翻译、个性化依据、风险提示随后补齐。
- 提供一次性 AI 接口作为流式失败时的兜底。
- 支持编辑、重新生成、产品链接/主图预览和保存 Gmail 草稿。
- 邮件正文在显示和保存前经过 `sanitizeOutreachEmailBody` 清理，防止模型把中文审查提示、系统签名说明或 `[Tu nombre]`、`[Your name]` 等占位符混入邮件正文。
- 自定义首封开发信提示词位于“AI 提示词 -> 冷开发信生成提示词”；保存后用于后续新生成的首封邮件，不会回改已经生成的草稿。

### Gmail

- 支持 OAuth 连接、收件箱/未读/星标/已发送/草稿等基本视图、线程详情、草稿、回复、转发、附件、翻译和 AI 辅助回复等能力。
- 首封开发信和跟进信均只创建 Gmail 草稿，不会自动发送。
- Gmail 授权过期时，首封草稿保存会尝试刷新授权；无法刷新时提示用户到设置页重新连接。

### 开发信跟进（已实现第一版）

- 红人开发台中已有“开发信跟进”标签页：`src/components/creator-prospecting/outreach-follow-up-tab.tsx`。
- 默认/可切换查看最近 7、10、14、30 天的飞书开发记录。
- 固定三阶段规则：第 0 天初次开发信、第 3 天二次跟进、第 7 天三次跟进。已取消第 14 天规则。
- 每行可“检查回复”；顶部可“检查全部”，受控并发检查，逐行更新结果。
- Gmail 检查会区分人工回复、自动回复、退信、未找到初次开发信等情况。发现人工回复后停止后续跟进。
- 未发现人工回复时，界面会显示“已检查，暂无人工回复”及检查时间，不再没有反馈。
- 支持生成简短的二次/三次跟进草稿，用户可审核编辑后保存到原 Gmail 线程草稿。
- 用户确认真实发送后，才可手动“标记本次已发送”，并在确认后写回飞书二次/三次跟进状态与日期。
- 跟进页支持头像：先显示首字母占位，后台尝试从飞书资源记录或 YouTube 频道解析头像；不写入飞书。

### 飞书字段映射

- 所有飞书写入都必须走 `src/lib/feishu-mapping.ts` 的语义键与用户保存的映射，禁止硬编码真实飞书列名。
- 已加入跟进字段键：`secondOutreachDate`、`secondOutreach`、`thirdOutreachDate`、`thirdOutreach`、`hasReply`。
- 用户需要在飞书“红人开发情况表”实际创建并映射“二次跟进日期”“三次跟进日期”字段，才能完整写回。

## 4. 当前正在进行的工作

当前没有未提交的业务代码修改。最新提交为：

```text
a1116b1 2026-07-13 16:40:37 +08:00 优化了开发信细节
```

最近一轮刚完成并提交的内容是开发信正文污染和签名占位符的处理：

- 强化 AI 提示词，禁止在正文中输出内部审查清单、系统说明或姓名占位符。
- 对流式生成、普通生成、已生成邮件展示和保存 Gmail 草稿都执行正文清理。

目前正在进入产品规划阶段，尚未开始实现：自动每日工作日历、Gmail 高使用频率流程提速、AI 回复“草稿优先”、合作履约看板等。

## 5. 已确认的产品需求和重要决定

### 不可违背的安全和业务决定

- 不自动发送 Gmail 邮件，不自动群发。
- 不自动批量写回飞书；写回必须有用户触发与确认。
- 不把保存 Gmail 草稿等同于真实邮件发送，尤其是二次/三次跟进已明确采用“用户真实发送后手动标记”的规则。
- 不能假设 YouTube API 能获取隐藏邮箱，只能使用公开简介中可取得的邮箱。
- AI 模型不是项目内置服务；项目只适配用户配置的 OpenAI-compatible API。
- UI 是高信息密度的日常运营工作台，不做营销落地页或大规模花哨动画。

### 已确认的开发信跟进规则

```text
第 0 天：初次开发信
第 3 天：二次跟进开发信
第 7 天：三次跟进开发信
```

- 红人有人工回复后，停止所有后续跟进。
- 自动回复、退信和异常邮件不视为红人回复，需单独提示。
- 跟进状态以 Gmail 检查结果为准；结果写回飞书由用户逐条确认。
- 第一版不自动生成或发送任何邮件；已扩展为用户可手动生成简短跟进草稿、保存 Gmail 草稿、真实发送后再手动写回飞书。

### 下一阶段产品方向（已讨论，尚未实现）

1. 自动工作日历：开发信跟进提醒、待我回复邮件、视频上线提醒。
2. Gmail 工作流优化，重点是速度、线程体验和高频操作，不试图完整复刻原生 Gmail。
3. AI 回复改为“先展示简洁回复草稿，详细分析折叠显示”。
4. 合作中红人看板、人工确认的视频上线检查。
5. 基于频道和产品的内容切入角度与 Brief 初稿。
6. 数据看板与转化漏斗。
7. 独立的爆款视频分析工具。

## 6. 修改过的主要文件及其作用

| 文件 | 作用 |
|---|---|
| `src/app/page.tsx` | 应用外壳、导航、各工作台视图路由。 |
| `src/components/creator-prospecting-page.tsx` | 红人开发台主状态与主流程：识别、查重、邀约、流式开发信、保存 Gmail 草稿、资源邮箱自动补入。 |
| `src/components/creator-prospecting/influencer-import-tab.tsx` | 批量频道录入、邮箱输入、飞书双表状态和资源关联操作。 |
| `src/components/creator-prospecting/invitation-confirm-tab.tsx` | 邀约确认、联系人、语言、产品和合作信息。 |
| `src/components/creator-prospecting/outreach-email-tab.tsx` | 首封开发信审核、编辑、展示与保存草稿入口。 |
| `src/components/creator-prospecting/outreach-follow-up-tab.tsx` | 开发信跟进表格、Gmail 回复检查、批量检查、跟进草稿、确认写回飞书、头像后台补全。 |
| `src/app/api/ai/route.ts` | 联系人/语言识别、普通开发信、跟进邮件、分析等 AI 动作。 |
| `src/app/api/ai/outreach-stream/route.ts` | 首封开发信正文流式生成与最终结构化草稿。 |
| `src/app/api/gmail/route.ts` | Gmail 列表/线程/草稿/API 操作，以及 `outreachFollowUp` 回复检查。 |
| `src/app/api/feishu/records/route.ts` | 飞书记录列表、筛选搜索、单条读取、创建、更新。 |
| `src/components/feishu-settings.tsx` | 飞书连接及字段映射配置。 |
| `src/lib/feishu-mapping.ts` | 飞书语义字段定义，包括初次、二次、三次跟进字段。 |
| `src/lib/creator-prospecting.ts` | 红人开发工作流类型、状态迁移和数据转换。 |
| `src/lib/outreach-draft-sanitizer.ts` | 清除 AI 邮件正文中的内部审查内容和签名占位符。 |
| `src/lib/ai-prompts.ts` | 内置提示词模板，包含首封开发信默认提示词。 |
| `src/lib/outreach-context.ts` | 构建首封开发信的频道、产品、合作上下文。 |
| `src/lib/outreach-email-rendering.ts` | 邮件 HTML、产品图片/链接、签名相关渲染。 |
| `src/components/gmail-page.tsx`、`src/components/gmail-inbox.tsx`、`src/components/email-detail.tsx` | Gmail 页面、邮件列表和邮件线程详情。 |
| `src/lib/data.ts` | 设置、Gmail 数据、提示词与本地/云端状态辅助函数。 |

## 7. 当前已知问题、Bug 和技术债

### 业务一致性风险，优先排查

1. **首封邮件“草稿”和“已发送”语义不一致**：`handleSaveGmailDraft` 在首封邮件保存 Gmail 草稿后会同步飞书“初次开发信 = 已发”。但 Gmail 草稿并不等于实际发送，且后续跟进已采用“真实发送后再写回”的更严格规则。后续做每日待办和转化漏斗前，应决定并统一首封发送确认机制。
2. **自动工作日历尚未实现**：现有每日待办/工作日历主要依赖手工数据，不能根据 Gmail 回复、跟进日期和预计上线日自动生成稳定任务。

### 已知技术与体验问题

1. Gmail 页面在大量邮件/频繁线程切换时仍可能卡顿，体验无法等同原生 Gmail；需先定位列表加载、线程加载、翻译和 AI 请求各自耗时。
2. Gmail OAuth 令牌会过期；设置页显示“已连接”不一定代表当前 access token 可直接调用。重新断开并连接通常可恢复，但应继续改善授权状态提示与重试路径。
3. 开发信跟进页的头像依赖飞书映射或 YouTube 后台查询。当前资源库“频道头像”字段可能未映射，且 YouTube 查询受网络、频道 URL 质量与 API 配额影响，因此会保留首字母占位。
4. AI 输出虽已增加清理保护，但模型仍可能产生不符合格式的内容。清理规则应保持保守，避免误删合法邮件正文；修改提示词或清理逻辑后必须实测多种语言邮件。
5. 历史文档或部分源码在某些 PowerShell 输出环境下会显示乱码。新文档应使用 UTF-8；不要因终端显示问题盲目批量重写源码。
6. YouTube API 配额有限，批量频道解析、最近视频读取、头像补全都需要保留并发和分页限制。
7. 产品主图目前使用现有字段保存压缩/base64 预览，适合 MVP，不适合长期大型素材管理。
8. 设置与部分数据仍处于 localStorage、Supabase 云端设置和飞书之间的混合状态；未来多人协作或统一报表前需要明确数据来源与同步规则。

## 8. 运行、构建和测试命令

### 常规命令

```powershell
pnpm install
pnpm dev                 # 默认端口 5000
pnpm ts-check
pnpm lint
pnpm build
```

启动后访问：`http://localhost:5000/`。

### 当前 Codex Windows 环境可用的替代命令

若系统没有配置 Node/pnpm/Git 到 PATH，可使用 bundled runtime：

```powershell
# 类型检查
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\typescript\bin\tsc -p tsconfig.json --noEmit

# ESLint。可按本次改动缩小文件范围，或直接运行全部检查。
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\eslint\bin\eslint.js .

# Git 状态
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe status --short --branch
```

不要在 pnpm 提示删除并重装 `node_modules` 时未经确认直接继续；优先确认本机 Node/pnpm 版本和现有依赖状态。

## 9. 环境变量及外部 API 配置说明

本地私密配置文件是根目录 `.env.local`，已被 `.gitignore` 忽略，不能提交到 GitHub，也不要把其中的值截图或发送到聊天中。可从 `.env.example` 复制字段名后在新电脑重新填写。

| 配置项 | 作用 | 备注 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目地址 | 必需，用于登录和云端设置。 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` 或 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase 前端访问密钥 | 二选一，代码支持两种命名。 |
| `GOOGLE_CLIENT_ID` | Google OAuth 客户端 ID | Gmail 连接必需。 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 客户端密钥 | Gmail 连接必需，仅服务端使用。 |
| `GOOGLE_REDIRECT_URI` | Google OAuth 回调地址 | 默认可回落到当前站点的 `/api/auth/callback`；Google Cloud 必须登记一致地址。 |
| `FEISHU_APP_ID` | 飞书应用 ID | 飞书授权、读写多维表格必需。 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 仅服务端使用。 |
| `FEISHU_REDIRECT_URI` | 飞书 OAuth 回调地址 | 默认可回落到当前站点的 `/api/auth/feishu/callback`；飞书后台必须登记一致地址。 |
| `AI_API_KEY` | OpenAI-compatible 模型密钥 | 也兼容 `DEEPSEEK_API_KEY`、`OPENAI_API_KEY`。 |
| `AI_API_URL` | 模型 chat/completions 接口地址 | 也兼容 `DEEPSEEK_API_URL`。 |
| `AI_MODEL` | 模型名称 | 也兼容 `DEEPSEEK_MODEL`。 |
| `YOUTUBE_API_KEY` | YouTube Data API 密钥 | 也可以在项目设置中安全保存；用于频道解析、搜索和头像补全。 |

外部平台还需要完成：

1. Gmail OAuth 同意屏幕、授权范围和回调地址配置；换电脑或令牌失效时重新连接 Gmail。
2. 飞书应用权限、授权、Base/表 ID 和字段映射配置；映射缺失时不得硬编码字段名绕过。
3. 在飞书开发情况表中创建并映射“二次跟进日期”“三次跟进日期”。
4. 在设置页配置品牌资料、产品资料、AI 提示词和 YouTube API 后，再进行端到端实测。

## 10. 下一步任务，按优先级排列

### P0：建立稳定的每日工作闭环

1. 先定义并实现自动每日待办的数据规则：
   - 待我回复：红人发来人工邮件、等待运营人员处理。
   - 待红人回复：已发开发信/跟进信但尚未回复。
   - 待执行动作：今天应二次跟进、三次跟进、确认寄样、确认视频上线等。
2. 在此之前统一“真实已发送”的判定。建议为首封邮件也增加“标记初次已发送”确认动作，避免 Gmail 草稿被误计为已发。
3. 日历先做“任务行动中心 + 日/周/月查看”，每项可直接跳转到对应红人、Gmail 线程或合作记录。

### P0：Gmail 和 AI 回复高频体验

1. 诊断 Gmail 列表、线程、翻译、AI 请求的耗时，优先处理缓存、分页、后台刷新和加载状态。
2. 将 AI 回复调整为“草稿优先”：先显示可编辑的简短回复草稿，详细分析折叠展示且最多保留少量关键点。
3. 保留“在 Gmail 中打开线程”作为复杂邮件操作的安全出口，不尝试完整复制原生 Gmail。

### P1：合作履约与内容辅助

1. 建立从确认合作到发布复盘的合作看板，数据来源是飞书合作记录。
2. 实现人工确认式的视频上线检查：读取频道近期视频，给出匹配建议，用户确认后再写回飞书。
3. 在首封开发信/确认合作流程中增加轻量频道内容切入角度；随后再做可编辑 Brief 初稿。

### P2：数据看板

1. 先定义统一指标：识别频道、已真实发送、已回复、有意向、已确认合作、已发布、产生转化。
2. 在字段和事件记录稳定后，建设按市场、产品、渠道、阶段的转化漏斗与视频表现看板。

### P3：爆款视频分析工具

1. 第一版接受单个 YouTube 视频链接。
2. 在 API/平台规则允许范围内读取字幕和评论，输出结构、选题、开头吸引点、评论反馈与可复用要素。
3. 不要一开始做大规模竞品抓取或自动批量采集。

## 11. 容易被新对话误解或重复修改的地方

1. **不要重新引入第 14 天跟进**：当前规则只有第 0、3、7 天三封邮件。
2. **不要把自动回复当成人工回复**，也不要因自动回复/退信自动停止跟进。
3. **不要自动发送 Gmail**，保存草稿后仍由用户在 Gmail 人工发送。
4. **不要绕过飞书字段映射**。所有读写都应使用映射语义键；字段实际名称由用户在设置页配置。
5. **不要覆盖用户手填邮箱**。资源库邮箱自动补入只允许在当前邮箱为空时发生。
6. **不要只改前端显示来修邮件正文污染**。`sanitizeOutreachEmailBody` 已同时用于服务端生成、流式输出、展示和 Gmail 保存，后续修改必须保持多层防护一致。
7. **开发信提示词分两类**：首封开发信有设置页可编辑模板；二次/三次跟进提示词目前是服务端固定逻辑，尚未提供单独配置页。
8. **头像问题不是单一 CSS 问题**：资源库头像映射可能缺失，且头像补全依赖后台 API 读取和频道信息质量；保留首字母兜底是预期行为。
9. **“待我回复”与“待红人回复”必须分开**，否则每日待办会变得含混。
10. **不要为日历直接新增数据库表或修改 Supabase 结构**，除非先获得用户明确确认；第一版应复用飞书日期、Gmail 检查结果和现有任务能力。

## 12. 当前 Git 状态和未提交修改说明

核对时间：2026-07-13。

在创建本文件前，Git 状态为：

```text
## main...origin/main
```

- 当前分支：`main`。
- 已与 `origin/main` 对齐。
- 创建本文件前没有已修改、已暂存或未跟踪的业务文件；`git diff --stat` 为空。
- 本次新增的 `HANDOFF.md` 将作为新的未提交文件，需由用户在确认内容后自行提交到 GitHub。
- 2026-07-13 后续文档同步：`README.md` 和 `TODO.md` 已按当前代码补充“开发信跟进”与“首封草稿/真实已发送语义风险”的说明；因此后续 `git status` 可能同时出现这些文档修改。

## 新对话启动提示词

```text
请继续维护 C:\\Users\\Admin\\Documents\\Codex\\influencer-kanban-main。

请先阅读根目录 HANDOFF.md、AGENTS.md、README.md、TODO.md，并查看 git status 与相关文件；以实际代码为准，不要只依赖旧聊天记录。

这是一个海外红人推广 CRM/工作台。请用中文沟通，先理解业务目标，再做小范围、可验证的修改。不能自动发送 Gmail 邮件，不能绕过飞书字段映射，不能自动批量写飞书。当前最高优先级是：统一真实邮件发送状态，并设计自动每日待办/工作日历的第一版规则与交互。
```
