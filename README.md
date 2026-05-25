# 红人推广看板

一个基于 Next.js 16、React 19、TypeScript、Tailwind CSS 4 和 shadcn/ui 的独立 Web 应用，用于管理跨境电商红人数据库、合作进度、跟进提醒和 Gmail 邮件工作流。

## 快速开始

```bash
pnpm install
pnpm dev
```

启动后打开 [http://localhost:5000](http://localhost:5000)。

## 常用命令

```bash
pnpm dev        # 启动开发服务器，端口 5000
pnpm build      # 构建生产版本
pnpm start      # 启动生产服务，端口 5000
pnpm lint       # 代码检查
pnpm ts-check   # TypeScript 类型检查
```

## AI 配置

项目已移除扣子编程 SDK，AI 邮件生成和翻译接口改为 OpenAI 兼容 API。

你可以在应用设置里填写自定义 API，也可以通过环境变量配置默认模型：

```bash
AI_API_KEY=你的 API Key
AI_API_URL=https://api.deepseek.com/chat/completions
AI_MODEL=deepseek-chat
```

也兼容：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek Key
OPENAI_API_KEY=你的 OpenAI Key
```

## Gmail 配置

Gmail 功能需要在 Google Cloud Console 创建 OAuth 客户端，启用 Gmail API，并把应用里显示的回调地址加入 Authorized redirect URI。

## 数据存储

当前 MVP 版本使用浏览器 localStorage 保存数据，包括红人、模板、提醒、Gmail 授权信息、邮件缓存、翻译和草稿。
