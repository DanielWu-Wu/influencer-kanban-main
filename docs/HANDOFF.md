# 红人推广工作台交接文档

> **唯一现役交接版本**
>
> 更新时间：2026-08-05
>
> 当前已提交基线：`main` / `47884c2`（优化多处细节），与 `origin/main` 一致。
> 本次洁癖收尾开始前主工作区干净；收尾仅修改 `README.md` 和本文件，不提交代码。
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
- 设置：`src/components/settings-panel.tsx`、`gmail-signature-settings.tsx`

## 2. 当前已实现能力

### 红人录入与飞书建档

- 支持批量识别 YouTube 频道、头像、近期长视频、公开邮箱、国家和推荐开发信语言。
- 飞书资源库/开发记录双表查重使用 60 秒快照和一次性索引；精确键冲突会阻止静默写入。
- “加入资源库”“新建开发记录”“快速建档”均先展示确认预览，确认后弹窗立即关闭，后台批量写入。
- 写入前按当前红人重新校验，其他红人的正常写入不再触发错误的“飞书数据已变化”提醒。
- 欧洲国家代码写入中文国家名；乌克兰等西里尔文本不会再因 `.com` 邮箱误判为葡萄牙语。
- 新建资源、开发记录和邮箱补写统一提取有效邮箱；飞书富文本对象不会再写成 `[object Object]`。
  服务端还会拦截任何包含该异常标记的待写字段。
- 飞书写入必须使用用户保存的字段映射；不得硬编码字段名或自动修改表结构。

### 开发信、Follow Up 与 Gmail

- 首封开发信可按中文对照修改后重新翻译为目标语言；保存 Gmail 草稿前仍需人工检查。
- 当前单人流程约定：首封开发信草稿保存成功后，用户立即前往 Gmail 手动发送；系统不得自动发送。
- 一次/二次 Follow Up 读取真实 Gmail `SENT`、`DRAFT` 和人工回复状态，生成草稿但不自动发送。
- Gmail AI 回复读取同一联系人最近 10 封往来，复用线程正文、缓存分析结果并支持 SSE 流式正文；
  不支持流式时回退普通 AI 路由。
- Mailsuite/Mailtrack 等通知地址在联系人解析和 Gmail 草稿 API 两层拦截。
- Gmail 签名新增三选一范围：仅开发信、仅正常邮件、两者都生效；旧配置默认按两者都生效。
  AI 只生成正文与自然结束语，签名由统一渲染逻辑追加。
- 合作项目的物流/折扣告知邮件支持中文对照编辑、重新润色翻译、后台生成和回复最近邮件线程；
  只创建 Gmail 草稿，不自动发送。

### 合作项目

- 读取飞书“详细合作记录表”，提供列表、看板、日历、搜索、风险和阶段多选筛选。
- 七阶段由日期与业务字段自动计算；视频已发布等已完成合作不再显示阶段停留天数。
- 阶段日期统一显示为中文年月日；发货、到货、拍摄完成和实际上线日期可在详情中修改。
- “物流信息已告知”“折扣信息已告知”可勾选或撤销；日期和复选框均在后台静默写回，成功/失败提示。
- 频道头像优先由映射的频道链接解析 Channel ID 后调用 YouTube API，列表缓存结果并回退字母头像。
- 合作项目与红人列表切换使用缓存和显式刷新，减少重复读取飞书。

### 每日待办与工作日历

- 手动任务支持标题、放大描述、优先级、默认当日截止日期、截止时间、编辑、删除、完成和恢复。
- 今日 Gmail 来信会匹配资源库红人、显示频道头像，并使用 AI 生成一句话中文摘要。
- Gmail 来信与手动任务共用待完成/已完成生命周期；完成后移到下方，撤销后恢复。
- Gmail 完成状态仅按当日消息保存在本地，不修改 Gmail 已读状态或飞书数据。
- 日期构造使用本地日期工具，避免 UTC 转换导致工作日历偏移一天。

## 3. 外部写入与数据边界

- 不自动发送 Gmail，不自动群发开发信。
- Gmail 草稿、飞书创建/更新仍由用户明确点击确认；后台执行只改变等待体验，不扩大授权。
- 不自动清理历史 Gmail 草稿或飞书异常数据。现有 `[object Object]` 邮箱记录如需批量修复，
  应另做“只读扫描 → 变更预览 → 用户确认 → 批量写回”。
- YouTube API 只能读取公开频道资料；隐藏邮箱不可获取，邮箱只能从公开内容提取或人工填写。
- AI 模型由用户配置 OpenAI-compatible 接口；项目不内置 DeepSeek，也不能假设任意代理地址兼容。

## 4. 当前验证状态

| 事实面 | 状态 | 当前证据 |
| --- | --- | --- |
| 代码基线 | verified-current | `main` / `47884c2`，与 `origin/main` 对齐 |
| TypeScript | changed-and-verified | 2026-08-05：`tsc -p tsconfig.json --noEmit` 通过 |
| ESLint | changed-and-verified | 2026-08-05：全仓库 0 error、7 个既有 warning；相关修改文件 0 warning |
| 纯逻辑测试 | pending | 当前共 48 个 `node:test` 用例；本机沙箱运行 `tsx` 时被 `esbuild spawn EPERM` 阻止，不能写成当前整套已通过 |
| 生产构建 | pending | 本轮未运行；此前本机曾在 Next.js worker 阶段遇到 `spawn EPERM`/内存限制 |
| 浏览器交互 | pending | 本轮未启动本地服务器做登录后交互验收 |
| Gmail/飞书真实写入 | pending | 本轮未发送邮件、未创建草稿、未写飞书，也未做真实账号端到端验收 |
| 部署 | out-of-scope | 未部署、未核对生产版本 |

现有 7 个 ESLint warning：

- `email-detail.tsx`：1 个原生 `<img>` 性能提示。
- `reminder-panel.tsx`：6 个未使用图标导入。

## 5. 下一轮优先验收

1. 红人开发台按“加入资源库 → 新建开发记录”顺序验证，确认飞书邮箱只写有效地址。
2. 三个红人分批建档场景：前两人的写入不能导致第三人出现错误黄色提醒。
3. Gmail 签名三种范围分别检查开发信、Follow Up、正常新邮件/回复和合作项目邮件。
4. Gmail 今日来信和手动任务验证完成、撤销、排序、编辑及刷新后状态。
5. 合作项目验证阶段多选、日期写回、复选框写回、后台邮件生成及切换项目不中断。
6. 真实账号验收必须由用户在页面明确点击；不得用自动化测试创建 Gmail 草稿或写飞书。

## 6. Git、工作区与清场预览

- 主工作区：`main...origin/main`，基线 `47884c2`；本次收尾前干净。
- 本次洁癖只修改 `README.md` 与 `docs/HANDOFF.md`，不会提交、推送或部署。
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
