# 红人推广看板 - 项目文档

## 项目概述

专为跨境电商海外红人推广专员设计的看板工作台，帮助管理红人数据库、跟踪合作进度、管理邮件往来。

## 技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **样式**: Tailwind CSS 4
- **拖拽**: @dnd-kit
- **数据存储**: localStorage (MVP阶段)

## 目录结构

```
src/
├── app/
│   ├── page.tsx              # 主页面（看板工作台）
│   ├── layout.tsx            # 根布局
│   ├── globals.css           # 全局样式
│   └── api/
│       ├── ai/route.ts       # AI 邮件生成 API (DeepSeek)
│       ├── translate/route.ts # 邮件翻译 API (DeepSeek)
│       ├── gmail/route.ts    # Gmail API 代理（获取邮件/创建草稿）
│       └── auth/
│           ├── callback/route.ts  # OAuth 回调处理
│           ├── token/route.ts     # OAuth Token 交换
│           └── refresh/route.ts   # OAuth Token 刷新
├── components/
│   ├── kanban-board.tsx      # 看板主组件
│   ├── kanban-column.tsx     # 看板列组件
│   ├── influencer-card.tsx   # 红人卡片组件
│   ├── influencer-form.tsx   # 红人表单组件
│   ├── email-template-manager.tsx  # 邮件模板管理
│   ├── reminder-panel.tsx    # 跟进提醒面板
│   ├── settings-panel.tsx    # 设置面板
│   ├── gmail-page.tsx        # Gmail 邮件页面
│   ├── gmail-inbox.tsx       # Gmail 收件箱
│   ├── email-detail.tsx      # 邮件详情（含翻译）
│   ├── email-composer.tsx    # AI 邮件助手
│   └── gmail-settings.tsx    # Gmail 设置
├── lib/
│   ├── types.ts              # 类型定义
│   ├── data.ts               # 数据管理 hooks
│   └── utils.ts              # 工具函数
└── components/ui/           # shadcn/ui 组件库
```

## 功能模块

### 1. 红人数据库管理
- 添加/编辑/删除红人信息
- 字段：频道名称、链接、邮箱、国家、粉丝数、类目、评级、备注

### 2. 可视化看板
- 10个状态列：红人库、待联系、已联系、有意向、洽谈中、已确认、样品中、拍摄中、已发布、已归档
- 拖拽流转，状态自动更新
- 筛选和搜索功能

### 3. 邮件模板管理
- 5个预设模板：冷开发信、跟进提醒(3种)、关怀邮件、感谢邮件
- 模板变量替换
- 一键复制到剪贴板

### 4. 跟进提醒系统
- 手动添加提醒
- 逾期提醒高亮
- 完成/跳过操作

### 5. Gmail 邮件集成
- Gmail OAuth 授权连接（Client ID/Secret 配置）
- OAuth 回调自动处理（token 交换 + 刷新）
- 邮件列表展示（从 Gmail API 实时拉取）
- 邮件详情查看（原文 + 中文对照）
- 手动翻译功能（DeepSeek AI 驱动）
- AI 邮件回复建议（DeepSeek AI 驱动，流式输出）
- 保存回复到草稿箱（通过 Gmail API）

### 6. 设置面板
- Gmail OAuth 配置入口
- 模型 API 设置（内置 DeepSeek / 自定义 OpenAI 兼容 API）
- 邮件自动检查设置
- 新邮件通知开关
- 红人邮箱自动匹配

## 开发命令

```bash
pnpm install    # 安装依赖
pnpm dev        # 启动开发服务器 (端口 5000)
pnpm build      # 构建生产版本
pnpm lint       # 代码检查
pnpm ts-check   # TypeScript 类型检查
```

## 数据存储

MVP 阶段使用 localStorage 存储：
- `influencer-board-influencers`: 红人数据
- `influencer-board-templates`: 邮件模板
- `influencer-board-reminders`: 跟进提醒
- `influencer-board-emails`: 邮件记录
- `gmail-auth`: Gmail OAuth 授权信息
- `gmail-threads`: Gmail 邮件对话缓存
- `gmail-translations`: 邮件翻译记录
- `gmail-drafts`: 邮件草稿
- `gmail-ai-suggestions`: AI 回复建议
- `gmail-settings`: Gmail 设置

## Gmail 集成配置

### 需要配置的内容

1. **Google Cloud Console**
   - 创建 OAuth 2.0 客户端
   - 启用 Gmail API
   - 配置授权重定向 URI

2. **DeepSeek AI**
   - 已内置集成，无需额外配置
   - 支持切换到自定义 OpenAI 兼容 API（GPT-4o, Qwen, GLM-4 等）
   - 通过 OpenAI 兼容 API 调用 DeepSeek 或其他模型

### 需要的 API 权限

- `gmail.readonly`: 读取邮件
- `gmail.compose`: 撰写邮件
- `gmail.send`: 发送邮件
- `gmail.modify`: 修改邮件标签

## 后续规划

### 近期功能
- [x] Gmail OAuth 集成（已完成完整流程）
- [x] AI 邮件回复建议（已集成 DeepSeek AI）
- [x] 翻译 API 集成（已集成 DeepSeek AI）
- [x] Gmail API 代理（已完成后端代理）
- [x] 邮件草稿创建（已完成 Gmail API 对接）

### 中期功能
- [ ] Supabase 数据库集成
- [ ] 飞书多维表格双向同步
- [ ] YouTube Data API 接入（视频数据自动获取）
- [ ] 邮件往来智能回复建议

### 远期功能
- [ ] 自动化邮件发送流程
- [ ] 数据统计报表
- [ ] 多语言支持
