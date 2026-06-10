# YouTube 红人推广看板

一个基于 Next.js 的红人合作管理与 AI 邮件工作台。

## 本地启动

```bash
pnpm install
pnpm dev
```

访问 `http://localhost:5000`。

## AI 环境变量

```bash
AI_API_KEY=
AI_API_URL=https://api.deepseek.com/chat/completions
AI_MODEL=deepseek-chat
```

## Gmail 一键授权

在 Google Cloud Console：

1. 启用 Gmail API。
2. 配置 OAuth consent screen。
3. 创建 Web application 类型的 OAuth Client。
4. 将下面的地址加入 Authorized redirect URIs：

```text
https://你的-vercel-域名/api/auth/callback
```

在 Vercel 项目的 Environment Variables 中配置：

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://你的-vercel-域名/api/auth/callback
```

配置后重新部署项目，即可在 Gmail 页面点击“连接 Gmail”完成授权。

## 数据存储

当前 MVP 使用浏览器 localStorage 保存红人、模板、提醒以及 Gmail 授权信息。正式多人版本应迁移到数据库，并将 refresh token 加密存储在服务端。
