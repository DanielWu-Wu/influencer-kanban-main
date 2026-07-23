# AGENTS.md

## 项目简介

这是一个面向跨境电商海外红人推广专员的工作流看板。
核心目标是把红人开发、Gmail 邮件跟进、AI 辅助回复、飞书多维表格记录、YouTube 频道资料、产品资料和合作进度管理放在同一个工作台中。
产品定位是高效、清晰、可控的 B2B 运营工具，不是营销展示页。

## 技术栈

- Framework: Next.js 16 App Router
- Frontend: React 19, TypeScript 5
- UI: Tailwind CSS 4, shadcn/ui, Radix UI, lucide-react
- Drag/drop: @dnd-kit
- Backend/API: Next.js Route Handlers under `src/app/api/**`
- Auth/storage: Supabase Auth, Supabase tables/RPC for cloud settings and user secrets
- External integrations: Gmail API, Feishu Open Platform/Base API, YouTube Data API, OpenAI-compatible AI APIs
- Main folders:
  - `src/app`: app shell, pages, API routes
  - `src/components`: feature UI components
  - `src/components/ui`: shared shadcn-style UI primitives
  - `src/lib`: types, storage, API helpers, business logic
  - `docs`: handoff and project docs

## 业务背景简述

用户主要做 YouTube 海外红人推广，重点市场包括西班牙、荷兰，未来可能扩展到波兰、比利时、葡萄牙等。
典型流程：手动/YouTube 工具发现红人 -> 建档 -> 待联系 -> 开发信 -> 已联系 -> 有意向 -> 谈价格/方式 -> 确认 -> 寄样 -> 拍摄 -> 发布 -> 复盘/归档。
AI 的角色是辅助判断、起草、翻译、提取信息、生成写回预览和汇报；最终决策和写入确认由用户完成。

## 代码修改原则

- 保持小步、可验证、低风险改动；不要顺手重构无关模块。
- 优先沿用现有组件、数据结构、样式变量和 API 约定。
- 不要改变业务逻辑，除非用户明确要求。
- 涉及外部写入时必须保留用户确认步骤，尤其是 Gmail 发送、Gmail 草稿、飞书写回、AI Agent 操作。
- UI 修改要保持桌面工作台的信息密度，偏清爽、现代、轻 Glassmorphism，不做花哨落地页风格。
- 用户界面主要使用中文；避免新增乱码文案。
- 不要把 DeepSeek 描述为项目内置服务；模型 API 由用户自己配置，项目只提供 OpenAI-compatible 接口适配。
- 手动编辑文件使用 `apply_patch`。

## 文件查看原则

- 先看与任务直接相关的文件，不要无目的扫描整个仓库。
- 常见入口：
  - 主壳/导航：`src/app/page.tsx`
  - 全局样式：`src/app/globals.css`
  - 业务类型：`src/lib/types.ts`
  - 数据/设置：`src/lib/data.ts`
  - Gmail：`src/components/gmail-page.tsx`, `src/components/gmail-inbox.tsx`, `src/components/email-detail.tsx`
  - 红人开发台：`src/components/creator-prospecting-page.tsx`
  - 飞书：`src/components/feishu-settings.tsx`, `src/lib/feishu-base.ts`, `src/lib/feishu-mapping.ts`
  - AI Agent/记录助手：`src/components/record-assistant-provider.tsx`, `src/lib/record-assistant.ts`, `src/lib/agent-assistant.ts`
  - 设置中心：`src/components/settings-panel.tsx`
  - 项目交接：`docs/HANDOFF.md`
- 搜索优先用 `rg`；Windows 环境下路径要注意 PowerShell 转义。

## 不要做的事情

- 不要使用 `git reset --hard`、`git checkout --` 等破坏性命令，除非用户明确要求。
- 不要删除或覆盖用户未提交的本地修改。
- 不要自动发送邮件、自动群发开发信、自动写飞书，除非用户明确确认。
- 不要硬编码飞书字段名；写飞书必须使用用户保存的字段映射。
- 不要假设 YouTube API 能拿到隐藏邮箱；只能从公开简介中提取邮箱。
- 不要把手动标记的 Gmail 未读邮件当作异常状态；它应被视为正常未读。
- 不要为了视觉效果牺牲邮件列表、表格、看板的信息密度。
- 不要把临时任务、聊天历史、一次性排查过程写进本文件。

## 验证/测试命令

项目脚本：

```bash
pnpm install
pnpm dev
pnpm ts-check
pnpm lint
pnpm build
```

本机 Codex 环境可能没有系统 `pnpm/node/git` PATH，可使用 Codex bundled runtime：

```powershell
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd ts-check
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\typescript\bin\tsc -p tsconfig.json
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe status --short
```

如果 `pnpm` 尝试重装依赖并因无 TTY 失败，可直接用 bundled Node 执行本地 `tsc` 做类型检查。
