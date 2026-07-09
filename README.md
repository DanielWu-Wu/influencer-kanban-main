# 红人推广 / Influencer Ops 工作台

这是一个面向跨境电商海外红人推广专员的日常运营工作台。项目目标是把 YouTube 红人发现、飞书多维表格建档、Gmail 开发信、AI 辅助翻译/回复、产品资料、合作状态跟进集中到一个清晰可控的桌面 Web 应用里。

当前最重要的页面是 **红人开发台**，用于从 YouTube 频道录入红人，查重飞书双表，确认邀约方向，生成开发信，保存 Gmail 草稿，并把开发状态写回飞书。

## 技术栈

- Framework: Next.js 16 App Router
- Frontend: React 19, TypeScript 5
- Styling/UI: Tailwind CSS 4, shadcn/ui, Radix UI, lucide-react
- Drag/drop: `@dnd-kit`
- Backend/API: Next.js Route Handlers under `src/app/api/**`
- Auth/storage: Supabase Auth, Supabase tables/RPC for cloud settings and user secrets
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
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd dev
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

## 目录结构

```text
src/app
  App Router 页面和 API routes
src/app/api
  Gmail、Feishu、YouTube、AI、translate、secrets、cloud 等后端接口
src/components
  页面级和业务组件
src/components/creator-prospecting
  红人开发台三个流程 Tab：录入、邀约确认、开发信
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
  - 3 个流程 Tab：红人录入、邀约确认、开发信。
  - 支持批量输入 YouTube 链接、`@handle`、`channel/UC...` 等。
  - YouTube 识别会抓取频道基础资料、头像、国家/语言、公开邮箱、最近长视频。
  - 识别后自动进行飞书双表查重。
  - 可在录入列表直接补充邮箱，并写入资源库和开发记录表。
  - 资源库疑似收录时，hover 可查看飞书资源库疑似记录信息。
  - “确认为新红人”用于人工确认疑似记录不是同一个红人。
  - 新建开发记录时，可兜底把当前邮箱补写/追加到资源库邮箱字段。
- **邀约确认**
  - 选择目标产品、合作形式、合作想法、优先级、开发信语言。
  - AI 可根据频道名/简介识别联系人姓名和开发信语言。
  - 缺少目标产品、合作形式、合作想法、开发信语言时，不能进入生成开发信。
- **开发信**
  - AI 基于联系人姓名、频道简介、最近长视频、产品资料、合作形式、合作想法生成开发信。
  - 支持 3 个备选标题及中文翻译。
  - 支持单独重新生成标题或正文。
  - 邮件预览支持产品型号链接、产品主图、签名链接。
  - 保存 Gmail 草稿后，线索移出开发信队列，并自动把飞书双表“初次开发信”标为“已发”。
  - Gmail 只创建草稿，不自动发送。
- **Gmail 邮件**
  - 收件箱、未读、星标、已发送、草稿等基础视图。
  - 支持邮件翻译、AI 辅助回复、草稿/发送相关操作。
  - 翻译默认优先当前邮件正文，避免无谓翻译引用历史。
  - Gmail 红人头像支持浏览器本地缓存和当前列表页预取。
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

## 后续开发注意事项

- 不要自动发送 Gmail 邮件。开发信流程只能创建 Gmail 草稿。
- 不要硬编码飞书字段名。所有飞书写入必须使用设置里保存的字段映射。
- 不要修改 Supabase 表结构或新增飞书字段，除非用户明确确认。
- 不要把 YouTube API 当作邮箱来源。它只能读取公开频道资料，邮箱只能从公开简介文本中提取。
- 不要把 DeepSeek 描述为项目内置服务；项目只适配 OpenAI-compatible API。
- UI 要保持桌面运营工作台的信息密度，清爽、现代、可扫描，不做营销落地页风格。
- 修改后优先运行：

```powershell
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\eslint\bin\eslint.js <相关文件>
```

更完整的交接请看 `PROJECT_HANDOFF.md` 和 `TODO.md`。
