# 红人推广 / Influencer Ops 工作台

这是一个面向跨境电商海外红人推广专员的日常运营工作台。项目目标是把 YouTube 红人发现、飞书多维表格建档、Gmail 开发信、AI 辅助翻译/回复、产品资料、合作状态跟进集中到一个清晰可控的桌面 Web 应用里。

当前主要工作面包括 **红人开发台、Gmail 邮件、合作项目、每日待办与工作日历、账号管理**：
从 YouTube 频道录入红人，查重并写入飞书双表，生成开发信和 Follow Up 草稿；
同时跟踪合作履约、物流/折扣告知、当天 Gmail 来信及手动任务，并为团队成员提供账号隔离。

当前唯一现役交接入口是 [`docs/HANDOFF.md`](docs/HANDOFF.md)。根目录
`HANDOFF.md`、`PROJECT_HANDOFF.md`、`TODO.md` 和 `docs/AI_HANDOFF.md`
只保留旧链接兼容，不作为当前状态或优先级依据。

## 技术栈

- Framework: Next.js 16 App Router
- Frontend: React 19, TypeScript 5
- Styling/UI: Tailwind CSS 4, shadcn/ui, Radix UI, lucide-react
- Drag/drop: `@dnd-kit`
- Backend/API: Next.js Route Handlers under `src/app/api/**`
- Auth/storage: Supabase Auth，按账号隔离的资料、业务数据、云端设置和私密配置
- External integrations: Gmail API, Feishu Open Platform/Base API, YouTube Data API, OpenAI-compatible AI API
- Package manager: pnpm 9+

## 本地启动

```bash
pnpm install
pnpm dev
```

默认访问地址：

```text
http://localhost:5000/
```

本机 Codex 环境有时没有系统 `pnpm/node/git` PATH，可使用 Codex bundled runtime：

```powershell
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd dev
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
```

注意：如果 `pnpm dev` 提示删除重装 `node_modules`，不要直接确认，优先用 bundled Node 或先排查环境。

## 环境与集成配置

AI 模型走 OpenAI-compatible 接口。项目不内置 DeepSeek，用户可在设置或环境变量中配置自己的模型服务：

```bash
AI_API_KEY=
AI_API_URL=https://api.deepseek.com/chat/completions
AI_MODEL=deepseek-chat
```

Gmail OAuth 需要在 Google Cloud Console 启用 Gmail API，配置 OAuth consent screen，并创建 Web application OAuth Client。

生产环境常见变量：

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://你的-vercel-域名/api/auth/callback
```

飞书、YouTube、Gmail、AI 模型等连接信息主要通过设置页保存；飞书写入必须依赖用户保存的字段映射。

团队账号管理还需要先执行 `supabase/migrations/20260806_account_management.sql` 和
`supabase/migrations/20260807_account_admin_permissions.sql`，并在服务端配置：

```bash
SUPABASE_SECRET_KEY=
APP_ADMIN_USER_ID=
```

`SUPABASE_SECRET_KEY` 只能保存在服务端环境变量中，不能写入 Git 或返回浏览器；
`APP_ADMIN_USER_ID` 是 Supabase Authentication 中唯一主管理员的用户 ID。

## 目录结构

```text
src/app
  App Router 页面和 API routes
src/app/api
  Gmail、Feishu、YouTube、AI、translate、secrets、cloud 等后端接口
src/components
  页面级和业务组件
src/components/creator-prospecting
  红人开发台流程 Tab：录入、邀约确认、开发信、开发信跟进
src/components/ui
  shadcn/Radix 风格基础 UI 组件
src/lib
  类型、业务逻辑、数据存储、外部服务 helper、AI prompt/context
supabase/migrations
  Supabase 迁移文件
docs
  交接与项目说明
```

## 当前功能模块

- **红人开发台**
  - 4 个流程 Tab：红人录入、邀约确认、开发信、开发信跟进。
  - 支持批量输入 YouTube 链接、`@handle`、`channel/UC...` 等。
  - YouTube 识别会抓取频道基础资料、头像、国家/语言、公开邮箱、最近长视频。
  - 识别后自动进行飞书双表查重。
  - 可在录入列表直接补充邮箱，并写入资源库和开发记录表。
  - 资源库疑似收录时，hover 可查看飞书资源库疑似记录信息。
  - “确认为新红人”用于人工确认疑似记录不是同一个红人。
  - 新建开发记录时，可兜底把当前邮箱补写/追加到资源库邮箱字段。
  - 欧洲国家代码写入中文国家名，频道语言结合文本特征和国家兜底判断。
  - 飞书富文本邮箱统一提取为有效地址，并在服务端阻止 `[object Object]` 异常文本写入。
- **邀约确认**
  - 选择目标产品、合作形式、合作想法、优先级、开发信语言。
  - AI 可根据频道名/简介识别联系人姓名和开发信语言。
  - 缺少目标产品、合作形式、合作想法、开发信语言时，不能进入生成开发信。
- **开发信**
  - AI 基于联系人姓名、频道简介、最近长视频、产品资料、合作形式、合作想法生成开发信。
  - 支持 3 个备选标题及中文翻译。
  - 支持单独重新生成标题或正文。
  - 邮件预览支持产品型号链接、产品主图、签名链接。
  - 保存 Gmail 草稿后，会按当前已确认的单人工作流把线索移出开发信队列，并同步飞书双表状态；
    用户随后前往 Gmail 手动发送。未来改为多人协作时再拆分“草稿已保存”和“真实已发送”。
  - Gmail 只创建草稿，不自动发送。
- **开发信跟进**
  - 可查看最近 7、10、14、30 天的飞书开发记录。
  - 固定规则是第 3 天二次跟进、第 7 天三次跟进；没有第 14 天跟进。
  - 可检查 Gmail 回复，区分人工回复、自动回复、退信和未找到初次开发信。
  - 可生成二次/三次跟进草稿并保存到 Gmail；真实发送后再由用户手动确认写回飞书。
- **Gmail 邮件**
  - 收件箱、未读、星标、已发送、草稿等基础视图。
  - 支持邮件翻译、AI 辅助回复、草稿/发送相关操作。
  - 翻译默认优先当前邮件正文，避免无谓翻译引用历史。
  - Gmail 红人头像支持浏览器本地缓存和当前列表页预取。
  - 来信“原文”旁显示本地检测的语言名称。
  - AI 辅助回复读取同一联系人最近 10 封邮件，复用当前线程正文，并缓存联系人历史和分析结果 5 分钟。
  - AI 回复正文支持流式显示，随后补充中文对照；模型不支持流式时自动回退兼容模式。
  - 邮件签名可设置为“仅开发信”“仅正常邮件”或“两者都生效”。
- **每日待办与工作日历**
  - 手动任务支持截止日期/时间、编辑、删除、完成和撤销完成；列表使用紧凑行高，并分为待完成、今日已完成和可折叠的历史已完成。
  - Gmail 任务只读取近 72 小时收件箱中每个线程最新的外部来信，排除推广/社交、本人发信、自动回复、退信及 Mailsuite/Mailtrack 通知，并且发件邮箱必须匹配飞书红人信息数据库。
  - Gmail 任务会匹配红人头像并生成一句话中文摘要；未手动完成的任务会继续保留，新外部来信晚于完成时间时会重新进入待完成。
  - 日期使用本地日历语义，避免 UTC 时区转换造成日期偏移。
  - 工作日历同时汇总手动日程、未完成待办和飞书合作项目的确认合作、发货、到货、拍摄完成、预计上线、实际上线六类节点。
  - 合作节点为只读，支持按需加载、60 秒缓存和手动刷新；点击节点可前往对应合作项目详情，逾期且未发布的预计上线节点显示为红色。
- **合作项目**
  - 提供列表、看板、日历、阶段多选、风险提示和项目详情。
  - 可后台写回物流/折扣告知状态以及发货、到货、拍摄完成、实际上线日期，并显示成功/失败提醒。
  - 物流和折扣邮件支持编辑中文对照、重新翻译并保存到最近 Gmail 线程草稿；不会自动发送。
- **产品资料**
  - 设置页产品数据库已简化为产品资料卡。
  - 核心字段：产品名称、型号、产品页面链接、产品描述/卖点、主图、状态。
  - 高级资料默认折叠。
  - 主图保存在现有资源字段中，不新增 Supabase Storage。
- **飞书设置**
  - 支持红人资源库和红人开发记录表两套配置。
  - 写飞书时必须使用字段映射，不硬编码字段名。
  - 支持读取飞书字段选项，用于内容类型等字段。
- **AI 助手**
  - 右下角圆形悬浮球，可拖动，靠近边缘自动半隐藏。
  - AI 用于辅助判断、翻译、生成邮件、提取信息；关键外部写入仍由用户确认或明确动作触发。
- **账号管理与数据隔离**
  - 使用固定主管理员账号创建成员账号，不发送注册或邀请邮件。
  - 主管理员可填写或修改姓名备注、停用、恢复账号及设置临时密码，但不能查看成员密码、业务数据、Gmail、飞书授权或密钥。
  - 新成员和被重置密码的成员首次登录必须修改临时密码，完成后才能进入工作台。
  - 产品、设置、待办、日历、红人、Gmail、飞书、AI Key 及缓存按账号隔离；切换账号时不会复用其他账号的数据或授权。
  - 临时网络或账号服务故障不会再被误判为账号停用；已确认的当前工作台会保留，并提供重试提示。

## 后续开发注意事项

- 不要自动发送 Gmail 邮件。开发信流程只能创建 Gmail 草稿。
- 首封开发信沿用当前单人工作流约定：保存草稿后由用户立即前往 Gmail 手动发送；
  系统仍不得自动发送，未来改为多人协作时再重新设计发送状态。
- 不要硬编码飞书字段名。所有飞书写入必须使用设置里保存的字段映射。
- 不要修改 Supabase 表结构或新增飞书字段，除非用户明确确认。
- 不要把 `SUPABASE_SECRET_KEY` 暴露给浏览器；管理员接口必须同时验证登录状态和 `APP_ADMIN_USER_ID`。
- 管理员只有账号元数据管理权，不能绕过成员业务数据的 RLS 隔离。
- 不要把 YouTube API 当作邮箱来源。它只能读取公开频道资料，邮箱只能从公开简介文本中提取。
- 不要把 DeepSeek 描述为项目内置服务；项目只适配 OpenAI-compatible API。
- UI 要保持桌面运营工作台的信息密度，清爽、现代、可扫描，不做营销落地页风格。
- 修改后优先运行：

```powershell
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\eslint\bin\eslint.js <相关文件>
```

更完整的当前交接请看 `docs/HANDOFF.md`。根目录 `HANDOFF.md`、`PROJECT_HANDOFF.md`
和 `docs/AI_HANDOFF.md` 仅保留历史背景。
