import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const OUT_DIR = process.env.PPTX_BUILD_OUTPUT;
const FINAL_PPTX = process.env.FINAL_PPTX;
if (!OUT_DIR || !FINAL_PPTX) throw new Error("Missing PPTX_BUILD_OUTPUT or FINAL_PPTX");

const W = 1280;
const H = 720;
const C = {
  ink: "#111827",
  black: "#000000",
  muted: "#64748B",
  faint: "#94A3B8",
  rule: "#DCE3EA",
  panel: "#F3F6F9",
  panelBlue: "#EAF5FB",
  blue: "#3D8DFF",
  cyan: "#6DCBF4",
  navy: "#164E8A",
  green: "#16A34A",
  amber: "#F59E0B",
  red: "#DC2626",
  white: "#FFFFFF",
};
const FONT = "Microsoft YaHei";

async function bytes(filePath) {
  const b = await fs.readFile(filePath);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function box(slide, x, y, w, h, fill = C.panel, line = C.rule, radius = 0) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect",
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 },
    ...(radius ? { borderRadius: radius } : {}),
  });
}

function line(slide, x, y, w, h = 0, color = C.rule, width = 1) {
  return slide.shapes.add({
    geometry: "straightConnector1",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: color, width },
  });
}

function circle(slide, x, y, d, fill = C.blue, stroke = fill) {
  return slide.shapes.add({
    geometry: "ellipse",
    position: { left: x, top: y, width: d, height: d },
    fill,
    line: { style: "solid", fill: stroke, width: 1 },
  });
}

function txt(slide, text, x, y, w, h, size = 24, color = C.ink, opts = {}) {
  const s = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  s.text = text;
  s.text.style = {
    fontSize: size,
    typeface: FONT,
    color,
    bold: Boolean(opts.bold),
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
  };
  return s;
}

function pill(slide, label, x, y, w, fill = C.panelBlue, color = C.navy) {
  box(slide, x, y, w, 30, fill, "none", 15);
  txt(slide, label, x, y + 2, w, 25, 14, color, { bold: true, align: "center", valign: "middle" });
}

function header(slide, number, title, eyebrow = "红人推广工作流看板") {
  txt(slide, eyebrow, 42, 28, 520, 24, 14, C.blue, { bold: true });
  txt(slide, title, 42, 62, 1160, 72, 38, C.black, { bold: true });
  line(slide, 42, 142, 1196, 0, C.rule, 1);
  txt(slide, String(number).padStart(2, "0"), 1154, 665, 82, 22, 13, C.faint, { align: "right" });
}

function note(slide, body, sources = ["Project source: docs/HANDOFF.md, 2026-08-13."]) {
  slide.speakerNotes.textFrame.setText(`${body}\n\n[Sources]\n${sources.map((s) => `- ${s}`).join("\n")}\n[/Sources]`);
  slide.speakerNotes.setVisible(true);
}

function step(slide, x, y, number, title, sub, accent = C.blue, w = 250) {
  circle(slide, x, y, 36, accent, accent);
  txt(slide, String(number), x, y + 4, 36, 24, 16, C.white, { bold: true, align: "center", valign: "middle" });
  txt(slide, title, x + 52, y - 4, w - 52, 32, 22, C.black, { bold: true });
  txt(slide, sub, x + 52, y + 32, w - 52, 56, 16, C.muted);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
  const presentation = Presentation.create({ slideSize: { width: W, height: H } });

  // 01 — Cover: inspired by Codex Grid slide-08, text field + strong visual field.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    txt(s, "团队分享会 · 2026", 48, 42, 340, 28, 15, C.blue, { bold: true });
    txt(s, "让红人合作\n从发现走到发布", 48, 148, 600, 164, 50, C.black, { bold: true });
    txt(s, "海外红人推广工作流看板", 50, 340, 530, 42, 25, C.ink, { bold: true });
    txt(s, "一次关于业务连续性、人工判断与 AI 边界的实践分享", 50, 396, 530, 72, 20, C.muted);
    pill(s, "看完整链路", 50, 520, 124);
    pill(s, "做现场演示", 188, 520, 124);
    pill(s, "形成团队共识", 326, 520, 140);

    box(s, 690, 38, 550, 604, C.panelBlue, C.rule, 18);
    // Connectors first, then nodes.
    line(s, 770, 195, 350, 0, C.cyan, 5);
    line(s, 770, 348, 350, 0, C.blue, 5);
    line(s, 770, 501, 350, 0, C.navy, 5);
    const labels = [
      ["发现", "公开资料与开发线索", 760, 165, C.cyan],
      ["沟通", "Gmail 上下文与双语草稿", 760, 318, C.blue],
      ["履约", "寄样、拍摄、发布、复盘", 760, 471, C.navy],
    ];
    for (const [a, b, x, y, color] of labels) {
      circle(s, x, y + 22, 22, color, color);
      circle(s, 1110, y + 22, 22, color, color);
      txt(s, a, x + 34, y, 120, 36, 24, C.black, { bold: true });
      txt(s, b, x + 34, y + 38, 320, 38, 17, C.muted);
    }
    txt(s, "不是多一个工具，而是让每一步接得上下一步。", 720, 574, 470, 36, 19, C.navy, { bold: true, align: "center" });
    note(s, "开场：今天不从功能清单开始，而从我们每天真实经历的红人合作链路开始。核心问题不是缺少某一个工具，而是红人信息、邮件、履约日期和下一步动作经常散落在不同地方。今天想分享的是：怎样让每一步自然接到下一步，同时保留运营人员的判断权。\n\n转场：先看我对这条工作流最核心的判断。");
  }

  // 02 — Core thesis.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 2, "红人运营真正管理的，是“状态的连续变化”");
    txt(s, "红人不是一条静态资料，而是一段持续数周甚至数月的合作关系。", 42, 172, 1150, 46, 26, C.ink, { bold: true });
    line(s, 88, 360, 1090, 0, C.rule, 2);
    const xs = [72, 258, 444, 630, 816, 1002];
    const stages = [
      ["发现", "有没有价值"], ["触达", "是否愿意聊"], ["谈判", "条件是否可行"],
      ["履约", "事情是否发生"], ["发布", "结果是否兑现"], ["复盘", "经验能否复用"],
    ];
    xs.forEach((x, i) => {
      circle(s, x + 38, 344, 32, i < 4 ? C.blue : C.navy, C.white);
      txt(s, stages[i][0], x, 394, 108, 34, 22, C.black, { bold: true, align: "center" });
      txt(s, stages[i][1], x - 20, 438, 148, 42, 16, C.muted, { align: "center" });
    });
    box(s, 42, 540, 1196, 82, C.panel, "none", 8);
    txt(s, "我的第一条判断", 66, 560, 180, 30, 16, C.blue, { bold: true });
    txt(s, "系统的价值，不是保存更多字段，而是让“当前状态、下一步动作、关键证据”始终连在一起。", 250, 554, 930, 46, 23, C.black, { bold: true });
    note(s, "讲解重点：红人推广不是建一个名单就结束。每一位红人都在不断改变状态：从未知到可联系，从有回复到谈条件，从确认合作到寄样、拍摄和发布。如果系统只保存资料，却不能告诉我们现在发生了什么、下一步做什么，那么它仍然只是一个更漂亮的表格。\n\n强调三个对象：状态、下一步动作、证据。证据包括邮件、日期、物流单号、视频链接等。\n\n转场：那为什么我们以前容易断？因为信息被不同工具切开了。");
  }

  // 03 — Tool roles.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 3, "工具可以分散，但业务事实必须汇合");
    const cols = [
      ["YouTube", "发现公开线索", "频道、内容、公开邮箱", C.cyan],
      ["Gmail", "留下沟通证据", "往来、承诺、草稿", C.blue],
      ["飞书", "沉淀业务记录", "资料、字段、协作数据", C.navy],
      ["工作台", "组织下一步行动", "状态、任务、日历、提醒", C.green],
    ];
    cols.forEach((d, i) => {
      const x = 42 + i * 302;
      box(s, x, 196, 278, 326, C.white, C.rule, 10);
      box(s, x, 196, 278, 10, d[3], "none", 5);
      txt(s, d[0], x + 24, 238, 230, 38, 26, C.black, { bold: true });
      txt(s, d[1], x + 24, 294, 230, 62, 21, d[3], { bold: true });
      line(s, x + 24, 374, 230, 0, C.rule, 1);
      txt(s, d[2], x + 24, 402, 230, 64, 17, C.muted);
    });
    box(s, 256, 562, 768, 62, C.panelBlue, "none", 8);
    txt(s, "工作台不是替代 Gmail 和飞书，而是让它们共同服务于同一条业务链。", 280, 578, 720, 30, 22, C.navy, { bold: true, align: "center" });
    note(s, "讲解重点：我没有想把所有能力都重新造一遍。YouTube 最适合发现内容，Gmail 最适合正式沟通，飞书适合结构化沉淀。工作台承担的是把这些事实组织成下一步行动。\n\n这是第二条判断：系统整合的不是页面，而是业务事实。一个邮件回复应该能改变待办，一个合作日期应该能出现在日历，一个草稿保存成功以后才允许写回对应状态。\n\n转场：我设计这个产品的过程其实很短，重点不是画页面，而是找断点和边界。");
  }

  // 04 — Brief design process.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 4, "产品设计过程：只做三件事", "设计过程（简版）");
    line(s, 150, 365, 980, 0, C.rule, 2);
    step(s, 112, 250, 1, "观察断点", "哪里需要复制粘贴？\n哪里最容易忘记？", C.cyan, 300);
    step(s, 490, 250, 2, "定义边界", "哪些可以自动读取？\n哪些必须人工确认？", C.blue, 300);
    step(s, 868, 250, 3, "缩短路径", "让高频动作更短，\n让关键判断更清楚。", C.navy, 300);
    box(s, 218, 530, 844, 82, C.panel, "none", 8);
    txt(s, "设计原则", 244, 550, 120, 30, 16, C.blue, { bold: true });
    txt(s, "先解决“接不上”的问题，再考虑“更智能”的问题。", 374, 544, 650, 42, 25, C.black, { bold: true });
    note(s, "这一页快速讲完，大约两分钟。我的设计过程不是从页面风格开始，而是先把一天的工作写成步骤，标出三类断点：重复录入、信息找不到、下一步不清楚。然后定义安全边界：读取和建议可以积极，真实写入必须确认。最后才优化路径，让高频操作少跳页面。\n\n不要在这一页展开技术细节。\n\n转场：接下来用一名红人的完整生命周期，看看这些判断如何落地。");
  }

  // 05 — Lifecycle inspired by Codex Grid slide-17.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 5, "一名红人的完整生命周期");
    line(s, 72, 350, 1130, 0, C.rule, 2);
    const stages = ["发现", "建档", "开发信", "邮件跟进", "确认合作", "寄样", "拍摄", "发布 / 复盘"];
    stages.forEach((label, i) => {
      const x = 60 + i * 148;
      circle(s, x, 336, 28, i < 4 ? C.blue : C.navy, C.white);
      txt(s, label, x - 30, 282, 90, 34, 17, C.black, { bold: true, align: "center" });
    });
    const groups = [
      ["01 发现与触达", "把公开线索变成可行动的对象", 42, C.panelBlue, C.blue],
      ["02 沟通与判断", "让邮件上下文、条件与下一步连续", 438, C.panel, C.ink],
      ["03 履约与复盘", "用日期和证据确认合作真的发生", 834, "#EEF5F1", C.green],
    ];
    groups.forEach(([a, b, x, fill, color]) => {
      box(s, x, 430, 364, 146, fill, "none", 8);
      txt(s, a, x + 22, 452, 320, 30, 19, color, { bold: true });
      txt(s, b, x + 22, 500, 320, 52, 18, C.ink);
    });
    txt(s, "现场演示将沿着这条线走，不按菜单逐页介绍。", 42, 610, 760, 32, 18, C.muted);
    note(s, "讲解重点：现场演示不要从左侧菜单一个个点，而是选一名红人作为主角。先从频道发现和建档开始，再进入 Gmail 看上下文和起草回复，最后回到每日待办、日历和合作项目。这样大家看到的是业务如何连续，而不是功能有多少。\n\n建议提前准备：一名已有公开资料的测试红人、一条可安全展示的邮件线程、一条已脱敏的合作项目。\n\n转场：第一段演示，从公开频道变成可跟进的红人档案。");
  }

  // 06 — Demo 1.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 6, "现场演示①：从频道线索到红人档案", "现场演示 · 发现与建档");
    pill(s, "演示路径", 42, 174, 100, C.blue, C.white);
    const demo = [
      ["输入频道", "用频道链接识别公开资料"],
      ["判断价值", "看近期内容、国家与适配度"],
      ["检查邮箱", "只使用公开邮箱或人工补充"],
      ["查重预览", "确认后再写入飞书记录"],
    ];
    demo.forEach((d, i) => {
      const y = 236 + i * 90;
      circle(s, 54, y + 8, 30, i === 3 ? C.navy : C.blue, C.white);
      txt(s, String(i + 1), 54, y + 11, 30, 20, 14, C.white, { bold: true, align: "center" });
      txt(s, d[0], 102, y, 170, 32, 21, C.black, { bold: true });
      txt(s, d[1], 278, y + 2, 370, 34, 17, C.muted);
      if (i < 3) line(s, 68, y + 42, 0, 48, C.rule, 2);
    });
    box(s, 716, 194, 500, 360, C.panelBlue, "none", 12);
    txt(s, "这一段要让组员看懂什么？", 748, 226, 430, 36, 23, C.navy, { bold: true });
    const points = [
      "公开资料只是线索，不等于完整事实",
      "查重与预览，是为了避免错误沉淀",
      "建档的终点不是“有一条记录”，而是“有下一步动作”",
    ];
    points.forEach((p, i) => {
      circle(s, 752, 302 + i * 74, 10, C.blue, C.blue);
      txt(s, p, 778, 286 + i * 74, 396, 56, 18, C.ink);
    });
    box(s, 716, 578, 500, 58, C.white, C.rule, 8);
    txt(s, "安全边界：YouTube 隐藏邮箱不可获取。", 740, 594, 452, 28, 17, C.red, { bold: true, align: "center" });
    note(s, "现场演示步骤：\n1. 打开“红人开发台”，输入提前准备的 YouTube 频道链接。\n2. 展示系统识别的头像、近期视频、国家和公开邮箱来源。\n3. 强调隐藏邮箱拿不到；公开信息不完整时必须人工补充。\n4. 展示飞书资源库/开发记录查重。\n5. 打开写入预览即可，不必在分享会上真实写入；如果要写入，必须使用测试记录并人工确认。\n\n讲解观点：采集只是第一步，真正重要的是把线索变成有状态、有下一步的行动对象。\n\n转场：红人一旦进入沟通阶段，最贵的不是打字时间，而是重新理解上下文的时间。");
  }

  // 07 — Gmail demo with screenshot.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 7, "现场演示②：在 Gmail 里先读懂，再回复", "现场演示 · 沟通与判断");
    const img = await bytes("C:/Users/Admin/AppData/Local/Temp/codex-clipboard-6dac3469-ce06-42fb-94fe-74820bb77918.png");
    box(s, 42, 178, 760, 430, C.panel, C.rule, 10);
    s.images.add({
      blob: img,
      contentType: "image/png",
      alt: "Gmail AI template drafting interface",
      fit: "cover",
      crop: { left: 0.105, top: 0.06, right: 0.015, bottom: 0.035 },
      position: { left: 52, top: 188, width: 740, height: 410 },
      geometry: "roundRect",
      borderRadius: 8,
    });
    const callouts = [
      ["1", "选择回复依据", "明确基于哪封真实邮件回复"],
      ["2", "读取相关历史", "减少重复翻找和遗漏条件"],
      ["3", "确认收件人", "未确认时不能保存草稿"],
    ];
    callouts.forEach((d, i) => {
      const y = 200 + i * 124;
      circle(s, 846, y, 36, C.blue, C.blue);
      txt(s, d[0], 846, y + 4, 36, 24, 16, C.white, { bold: true, align: "center" });
      txt(s, d[1], 902, y - 2, 300, 30, 21, C.black, { bold: true });
      txt(s, d[2], 902, y + 36, 300, 48, 17, C.muted);
    });
    box(s, 834, 578, 382, 58, C.panelBlue, "none", 8);
    txt(s, "AI 节省的是“恢复上下文”的成本。", 852, 594, 348, 30, 18, C.navy, { bold: true, align: "center" });
    note(s, "现场演示步骤：\n1. 打开 Gmail 邮件，选择一条适合展示的真实线程。\n2. 展示线程参与人以及选择哪封邮件作为回复依据。\n3. 指出系统会读取同一联系人的相关历史，用于恢复上下文。\n4. 演示未确认收件人时仍可生成，但不能保存草稿。\n5. 打开 AI 模板起草入口，进入下一页的提示词逻辑。\n\n讲解观点：AI 的第一价值不是“写得像人”，而是帮运营人员快速恢复合作上下文。但模型理解不能替代收件人确认。", [
      "User-provided project screenshot: codex-clipboard-6dac3469-ce06-42fb-94fe-74820bb77918.png, 2026-08-13.",
      "Project source: docs/HANDOFF.md, 2026-08-13.",
    ]);
  }

  // 08 — Prompt responsibilities, two screenshot composition inspired by slide-15.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 8, "两个提示词，分别解决“怎么看”和“怎么说”", "AI 的职责分层");
    const sys = await bytes("C:/Users/Admin/AppData/Local/Temp/codex-clipboard-400802f6-334d-4834-8bb6-977e3a8362f7.png");
    const draft = await bytes("C:/Users/Admin/AppData/Local/Temp/codex-clipboard-5f01dc9a-1a7e-4e8f-a5fb-478034175d57.png");
    box(s, 42, 180, 570, 392, C.white, C.rule, 10);
    box(s, 628, 180, 570, 392, C.white, C.rule, 10);
    pill(s, "怎么看", 66, 198, 86, C.panelBlue, C.navy);
    pill(s, "怎么说", 652, 198, 86, "#EEF5F1", C.green);
    txt(s, "AI 系统功能提示词", 66, 238, 490, 34, 23, C.black, { bold: true });
    txt(s, "分析、翻译、合作建议等通用能力", 66, 276, 490, 28, 16, C.muted);
    s.images.add({
      blob: sys, contentType: "image/png", alt: "AI system feature prompt settings",
      fit: "cover", crop: { left: 0.13, top: 0.075, right: 0.015, bottom: 0.08 },
      position: { left: 66, top: 320, width: 522, height: 224 }, geometry: "roundRect", borderRadius: 6,
    });
    txt(s, "AI 起草邮件提示词", 652, 238, 490, 34, 23, C.black, { bold: true });
    txt(s, "根据邮件事实控制表达方式与商务语气", 652, 276, 500, 28, 16, C.muted);
    s.images.add({
      blob: draft, contentType: "image/png", alt: "AI email drafting prompt settings",
      fit: "cover", crop: { left: 0.13, top: 0.075, right: 0.015, bottom: 0.08 },
      position: { left: 652, top: 320, width: 522, height: 224 }, geometry: "roundRect", borderRadius: 6,
    });
    box(s, 236, 600, 808, 48, C.panel, "none", 8);
    txt(s, "分开设置的意义：判断逻辑保持统一，邮件表达可以独立调整。", 258, 612, 766, 28, 19, C.ink, { bold: true, align: "center" });
    note(s, "讲解重点：\n- “AI 系统功能提示词”负责通用能力的工作方式，例如邮件翻译、合作分析和建议。它决定 AI 怎样理解和判断。\n- “AI 起草邮件提示词”只在起草正式邮件时使用，结合邮件历史、模板规则、用户事实、目标语言和语气，决定最终怎么表达。\n- 把两者分开，是为了避免改一封邮件的表达习惯时，影响其他分析功能。\n\n现场可快速进入两个设置页对照，不必逐段朗读提示词。重点讲职责，而不是提示词文字本身。\n\n转场：即使 AI 能写外文，真正适合我们控制内容的界面仍然应该是中文。", [
      "User-provided project screenshot: codex-clipboard-400802f6-334d-4834-8bb6-977e3a8362f7.png, 2026-08-13.",
      "User-provided project screenshot: codex-clipboard-5f01dc9a-1a7e-4e8f-a5fb-478034175d57.png, 2026-08-13.",
      "Project source: docs/HANDOFF.md, 2026-08-13.",
    ]);
  }

  // 09 — Bilingual control flow.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 9, "中文是人工控制面，外文是最终交付面", "现场演示 · AI 双语起草");
    // Connectors and branch before nodes.
    line(s, 132, 328, 820, 0, C.rule, 3);
    line(s, 630, 328, 0, 160, C.rule, 3);
    line(s, 630, 488, 322, 0, C.rule, 3);
    const nodes = [
      [70, 270, 180, 116, "AI 生成", "外文正文\n+ 中文对照", C.panelBlue, C.blue],
      [286, 270, 180, 116, "人工检查", "只看中文\n确认商务事实", C.white, C.ink],
      [502, 270, 180, 116, "没有修改", "直接允许\n保存草稿", "#EEF5F1", C.green],
      [718, 270, 220, 116, "保存 Gmail 草稿", "仍不自动发送", C.navy, C.white],
      [502, 430, 180, 116, "修改中文", "立即禁用\n保存草稿", "#FFF7E8", C.amber],
      [718, 430, 220, 116, "根据中文更新外文", "忠实翻译后恢复保存", C.panelBlue, C.navy],
    ];
    nodes.forEach(([x, y, w, h, a, b, fill, color]) => {
      box(s, x, y, w, h, fill, fill === C.white ? C.rule : "none", 10);
      txt(s, a, x + 16, y + 18, w - 32, 32, 20, color, { bold: true, align: "center" });
      txt(s, b, x + 16, y + 58, w - 32, 48, 16, fill === C.navy ? C.white : C.muted, { align: "center" });
    });
    box(s, 982, 238, 240, 332, C.panel, "none", 10);
    txt(s, "保留的人工权利", 1006, 264, 192, 30, 20, C.black, { bold: true, align: "center" });
    const rights = ["可直接修改中文", "可手动润色外文", "覆盖前必须确认", "收件人必须确认", "只保存草稿，不发送"];
    rights.forEach((r, i) => {
      circle(s, 1008, 326 + i * 46, 9, i === 4 ? C.red : C.blue, i === 4 ? C.red : C.blue);
      txt(s, r, 1030, 314 + i * 46, 170, 32, 16, i === 4 ? C.red : C.ink, { bold: i === 4 });
    });
    txt(s, "核心原则：AI 可以帮助表达，但不能替用户决定商务事实。", 42, 612, 900, 34, 21, C.navy, { bold: true });
    note(s, "现场演示步骤：\n1. 选择模板、目标语言和语气，补充一段中文事实。\n2. 生成外文和完整中文对照。\n3. 不修改中文时，展示“保存 Gmail 草稿”可以直接使用。\n4. 修改中文一个条件，展示保存按钮立即禁用。\n5. 点击“根据中文更新外文”，说明此时只忠实翻译，不重新决定商务内容。\n6. 手动编辑外文，展示不同步提示但仍可保存。\n7. 再次从中文更新外文时，展示覆盖确认。\n8. 最后停在保存草稿按钮；如需要真实点击，使用测试线程。强调不会自动发送。\n\n这是第三条判断：中文对照不是附属翻译，而是运营人员的控制面。\n\n转场：单封邮件处理好以后，还要让每天的优先级和合作履约持续可见。");
  }

  // 10 — Daily operating rhythm inspired by Codex Grid slide-10/15.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 10, "三个页面，回答运营每天最重要的三个问题");
    const blocks = [
      ["今天做什么？", "每日待办", "未回复来信、手动任务、完成与恢复", C.blue],
      ["什么时候发生？", "工作日历", "确认、发货、到货、拍摄、预计与实际上线", C.cyan],
      ["现在进展到哪？", "合作项目", "阶段、风险、日期、告知状态与证据", C.navy],
    ];
    blocks.forEach((d, i) => {
      const x = 42 + i * 398;
      box(s, x, 194, 368, 328, C.white, C.rule, 10);
      box(s, x, 194, 368, 12, d[3], "none", 6);
      txt(s, d[0], x + 24, 238, 320, 34, 21, d[3], { bold: true });
      txt(s, d[1], x + 24, 292, 320, 42, 28, C.black, { bold: true });
      line(s, x + 24, 354, 320, 0, C.rule, 1);
      txt(s, d[2], x + 24, 386, 314, 88, 17, C.muted);
    });
    line(s, 188, 560, 868, 0, C.rule, 2);
    circle(s, 180, 551, 18, C.blue, C.blue);
    circle(s, 622, 551, 18, C.cyan, C.cyan);
    circle(s, 1048, 551, 18, C.navy, C.navy);
    txt(s, "来信形成待办", 92, 592, 190, 30, 17, C.ink, { bold: true, align: "center" });
    txt(s, "关键日期进入日历", 520, 592, 220, 30, 17, C.ink, { bold: true, align: "center" });
    txt(s, "结果回到项目记录", 948, 592, 220, 30, 17, C.ink, { bold: true, align: "center" });
    note(s, "讲解重点：这三个页面不是三个独立模块，而是同一业务的三个视角。每日待办回答行动优先级，工作日历回答时间承诺，合作项目回答状态和风险。\n\n现场演示建议：\n1. 打开每日待办，展示 Gmail 来信如何成为待办以及回复后如何完成。\n2. 打开工作日历，点一个合作节点进入当天详情。\n3. 从日历节点跳转到对应合作项目。\n4. 展示列表、看板或日历视图中的同一项目。\n\n这是第四条判断：系统不应该要求人记住所有事情，而应该在正确的时间把下一步呈现出来。\n\n转场：合作确认以后，真正的管理重点从“说了什么”变成“事情有没有按时发生”。");
  }

  // 11 — Fulfilment and signals.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 11, "确认合作不是终点，而是履约的起点");
    const events = [
      ["确认", "条件达成"], ["发货", "物流单号"], ["到货", "签收日期"],
      ["拍摄", "内容进度"], ["预计上线", "时间承诺"], ["实际上线", "视频证据"],
    ];
    line(s, 94, 300, 1072, 0, C.rule, 3);
    events.forEach((e, i) => {
      const x = 72 + i * 194;
      circle(s, x + 28, 284, 32, i < 3 ? C.blue : C.navy, C.white);
      txt(s, e[0], x - 14, 230, 116, 34, 19, C.black, { bold: true, align: "center" });
      txt(s, e[1], x - 14, 338, 116, 34, 15, C.muted, { align: "center" });
    });
    box(s, 42, 438, 556, 164, C.panelBlue, "none", 10);
    txt(s, "系统应该主动提醒", 66, 462, 500, 32, 21, C.navy, { bold: true });
    txt(s, "日期临近、阶段停留、预计上线逾期、信息缺失", 66, 516, 490, 54, 18, C.ink);
    box(s, 622, 438, 596, 164, C.panel, "none", 10);
    txt(s, "系统不应该自动决定", 646, 462, 540, 32, 21, C.red, { bold: true });
    txt(s, "合作状态变化、飞书字段写回、Gmail 发送", 646, 516, 540, 54, 18, C.ink);
    txt(s, "提醒是自动化，决定仍然属于人。", 42, 628, 800, 32, 20, C.black, { bold: true });
    note(s, "讲解重点：合作项目的价值，是把承诺转换成可以检查的日期和证据。确认、发货、到货、拍摄和上线都应该有明确记录。系统可以根据日期产生风险提示，也可以帮助起草物流或折扣告知邮件，但真实草稿保存和飞书写回仍由用户点击确认。\n\n现场演示建议：打开一条脱敏合作项目，展示阶段、日期、告知复选框；再打开物流或折扣邮件起草入口，说明 Gmail 成功而飞书失败时只重试写回，不重复建草稿。\n\n转场：最后，团队使用这套工作流时需要形成共同规则，否则再好的系统也会重新变成信息孤岛。");
  }

  // 12 — Closing and adoption.
  {
    const s = presentation.slides.add();
    s.background.fill = C.white;
    header(s, 12, "先统一工作方式，再逐步扩大自动化", "团队共识与下一步");
    txt(s, "建议我们先形成四条共同规则", 42, 176, 660, 40, 25, C.black, { bold: true });
    const rules = [
      ["01", "状态及时更新", "关键节点当天记录，不靠记忆补账"],
      ["02", "证据留在链路", "邮件、日期、物流和视频链接可追溯"],
      ["03", "中文负责确认", "关键商务事实先在人能看懂的界面确认"],
      ["04", "外部写入人工触发", "草稿、飞书写回和发送保持清晰边界"],
    ];
    rules.forEach((r, i) => {
      const y = 238 + i * 78;
      txt(s, r[0], 42, y, 48, 30, 16, C.blue, { bold: true });
      txt(s, r[1], 104, y - 4, 230, 34, 21, C.black, { bold: true });
      txt(s, r[2], 346, y, 410, 34, 17, C.muted);
      if (i < 3) line(s, 42, y + 48, 714, 0, C.rule, 1);
    });
    box(s, 808, 176, 410, 350, C.panelBlue, "none", 12);
    txt(s, "分享会最后讨论", 838, 208, 350, 34, 23, C.navy, { bold: true });
    const qs = [
      "哪一步仍然最容易断？",
      "哪些字段是大家真正会用的？",
      "哪些提醒值得自动出现？",
      "哪些动作必须继续人工确认？",
    ];
    qs.forEach((q, i) => {
      circle(s, 840, 278 + i * 58, 10, C.blue, C.blue);
      txt(s, q, 864, 264 + i * 58, 320, 38, 18, C.ink, { bold: i === 0 });
    });
    box(s, 42, 592, 1176, 64, C.navy, "none", 8);
    txt(s, "把执行工作留给系统，把时间留给判断、关系与统筹。", 70, 608, 1120, 34, 25, C.white, { bold: true, align: "center" });
    note(s, "收尾：不要把分享会结束在“大家觉得怎么样”。直接邀请组员围绕四个问题讨论，并记录一个最优先的断点。建议会后选 1—2 名成员用同一套规则跑一周，再根据真实使用调整字段、提醒和操作路径。\n\n最后总结：这个产品不是为了让 AI 代替红人运营，而是为了让运营人员减少重复查找、减少遗漏，把时间留给判断合作价值、维护关系和统筹履约。\n\n可用结束语：系统越自动，人的责任边界越要清楚。我们追求的不是无人操作，而是每一次人工判断都发生在真正需要判断的地方。", [
      "Project source: docs/HANDOFF.md, 2026-08-13.",
      "Project guidance: AGENTS.md, 2026-08-13.",
    ]);
  }

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    const png = await presentation.export({ slide, format: "png", scale: 1 });
    await fs.writeFile(path.join(OUT_DIR, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(OUT_DIR, `${stem}.layout.json`), await layout.text(), "utf8");
  }
  const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
  await fs.writeFile(path.join(OUT_DIR, "deck-montage.webp"), new Uint8Array(await montage.arrayBuffer()));
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(FINAL_PPTX);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
