import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPortfolioVersion, validatePortfolioLibrary } from "./portfolio-photo-lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const portfolioValidation = await validatePortfolioLibrary();
if (!portfolioValidation.ok) {
  throw new Error(`客片库校验失败：\n${portfolioValidation.errors.map((message) => `- ${message}`).join("\n")}`);
}
const portfolioBuildVersion = await buildPortfolioVersion();
const source = await readFile(join(root, "app/page.tsx"), "utf8");
const css = await readFile(join(root, "app/globals.css"), "utf8");
const match = source.match(/const projects: Project\[\] = (\[[\s\S]*?\n\]);\n\nconst filters/);

if (!match) throw new Error("无法读取项目数据");

const projects = Function(`"use strict"; return (${match[1]});`)();
const marks = { network: "N", studio: "15", server: "99", workflow: "◇", odds: "2:1", video: "▶", crm: "透明", agent: "AI", expand: "9:16", meter: "72%", risk: "−18", reviews: "★★★★★", portfolio: "158", insights: "↑", recreate: "2→1" };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const cards = projects.map((project) => {
  const visual = project.preview
    ? `<div class="project-visual has-preview visual-${escapeHtml(project.visual)}"><img class="project-preview" src=".${escapeHtml(project.preview)}" alt="" loading="eager"><em class="preview-badge">点击进入云端</em></div>`
    : `<div class="project-visual visual-${escapeHtml(project.visual)}"><span>${escapeHtml(marks[project.visual])}</span><small>${escapeHtml(project.category)}</small></div>`;
  return `
  <a class="project-card tone-${escapeHtml(project.tone)}" href="${escapeHtml(project.href)}" aria-label="${escapeHtml(project.linkLabel)}：${escapeHtml(project.name)}">
    <div class="project-card-top"><span class="project-index">${escapeHtml(project.index)}</span><span class="project-status"><i></i>${escapeHtml(project.status)}</span></div>
    ${visual}
    <div class="project-copy"><span class="project-eyebrow">${escapeHtml(project.eyebrow)}</span><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.summary)}</p><div class="tag-row">${project.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></div>
    <span class="open-project">立即打开 <b>↗</b></span>
  </a>`;
}).join("");

const staticCss = `
main{min-height:100vh}.static-page .top-nav{position:sticky;top:10px;margin:10px auto 0;transform:none;left:auto}.static-page .work-section{padding-top:32px}.static-page .results-header{min-height:128px}.static-page .open-project{opacity:1;transform:none}.project-page{min-height:100vh;padding:18px}.project-shell{width:min(1060px,100%);margin:0 auto}.project-back{height:44px;padding:0 14px;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:13px;background:#fafaf8;color:#565c65;font-size:11px;font-weight:750}.project-hero{margin-top:16px;padding:clamp(22px,5vw,58px);display:grid;grid-template-columns:minmax(0,1.1fr) minmax(260px,.9fr);gap:40px;border:1px solid rgba(20,25,35,.08);border-radius:30px;box-shadow:0 18px 55px rgba(30,35,45,.08)}.project-hero-copy{align-self:center}.project-hero .project-eyebrow{display:block;margin-bottom:15px}.project-hero h1{margin:0;font-size:clamp(38px,6vw,74px);line-height:.96;letter-spacing:-.06em}.project-lead{margin:22px 0 0;color:#5f646c;font-size:clamp(14px,1.6vw,18px);line-height:1.75}.project-detail{margin:22px 0 0;padding-top:22px;border-top:1px solid rgba(20,25,35,.09);color:#5f646c;font-size:13px;line-height:1.85}.project-hero .project-visual{height:360px;margin:0}.permanent-note{margin-top:16px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:20px;border:1px solid var(--line);border-radius:18px;background:#fafaf8}.permanent-note strong{display:block;font-size:13px}.permanent-note span{display:block;margin-top:5px;color:#70757d;font-size:11px;line-height:1.5}.permanent-badge{flex:0 0 auto;padding:9px 12px;border-radius:99px;color:#237a4b!important;background:#e5f4eb;font-size:9px!important;font-weight:800}.project-url{margin-top:16px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:16px;color:white;background:#171a1f;font-size:11px;font-weight:750}.project-url small{font-size:9px;opacity:.6}.project-footer{padding:24px 4px;color:#747981;font-size:10px}@media(max-width:700px){.static-page .top-nav{position:sticky}.static-page .work-section{padding-top:22px}.project-page{padding:10px}.project-hero{grid-template-columns:1fr;gap:22px;border-radius:22px}.project-hero .project-visual{height:250px;grid-row:1}.permanent-note{align-items:flex-start;flex-direction:column}.project-url{align-items:flex-start;flex-direction:column}}
`;

const projectPage = (project) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f5f5f2">
  <meta name="description" content="${escapeHtml(project.summary)}">
  <title>${escapeHtml(project.name)} · NBO南铂智能系统</title>
  <link rel="icon" href="../../icon.png">
  <style>${css}${staticCss}</style>
</head>
<body>
  <main class="project-page">
    <div class="project-shell">
      <a class="project-back" href="../../">← 返回 NBO南铂智能系统</a>
      <section class="project-hero tone-${escapeHtml(project.tone)}">
        <div class="project-hero-copy">
          <span class="project-eyebrow">${escapeHtml(project.index)} / ${escapeHtml(project.eyebrow)}</span>
          <h1>${escapeHtml(project.name)}</h1>
          <p class="project-lead">${escapeHtml(project.summary)}</p>
          <p class="project-detail">${escapeHtml(project.detail)}</p>
          <div class="tag-row">${project.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        </div>
        <div class="project-visual visual-${escapeHtml(project.visual)}"><span>${escapeHtml(marks[project.visual])}</span><small>${escapeHtml(project.category)}</small></div>
      </section>
      <section class="permanent-note">
        <div><strong>永久项目网址已建立</strong><span>电脑、手机均可打开；原电脑关机或更换设备也不影响此项目入口。</span></div>
        <span class="permanent-badge">项目主页在线</span>
      </section>
      <a class="project-url" href="${escapeHtml(project.href)}"><span>${escapeHtml(project.href)}</span><small>固定网址 ↗</small></a>
      <footer class="project-footer">NBO南铂智能系统 · 功能持续迁移到网页端</footer>
    </div>
  </main>
</body>
</html>`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f5f5f2">
  <meta name="description" content="南铂摄影的 App、网页、自动化工作流与 AI 智能体统一入口。">
  <title>NBO南铂智能系统</title>
  <link rel="icon" href="./icon.png">
  <style>${css}${staticCss}</style>
</head>
<body class="static-page">
  <main>
    <nav class="top-nav" aria-label="系统导航"><a class="brand" href="#top"><span>N</span><b>NBO南铂智能系统</b></a><a class="sync-link" href="https://github.com/wdmm630202/nbo-smart-system"><i></i>GitHub 永久备份</a></nav>
    <section class="work-section" id="top">
      <header class="results-header"><div><p>NBO SYSTEM INDEX · 2026</p><h1>NBO南铂智能系统</h1><span>智能体、网页、App、自动化统一登记 · 电脑、手机均可使用</span></div><div class="result-count"><strong>${projects.length}</strong><span>全部系统</span></div></header>
      <div class="project-grid">${cards}</div>
    </section>
  </main>
</body>
</html>`;

const docs = join(root, "docs");
await mkdir(docs, { recursive: true });
await writeFile(join(docs, "index.html"), html);
await writeFile(join(docs, ".nojekyll"), "");
await copyFile(join(root, "public/icon.png"), join(docs, "icon.png"));
await copyFile(join(root, "public/og.png"), join(docs, "og.png"));
await copyFile(join(root, "public/stash-dashboard-preview.jpg"), join(docs, "stash-dashboard-preview.jpg"));

const internalProjects = projects.filter((project) => project.href.includes("/nbo-smart-system/projects/"));
for (const project of internalProjects) {
  const projectDir = join(docs, "projects", project.id);
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "index.html"), projectPage(project));
}

await copyFile(join(root, "apps/reviews/index.html"), join(docs, "projects/reviews/index.html"));
await copyFile(join(root, "apps/reviews/language-db.js"), join(docs, "projects/reviews/language-db.js"));
await copyFile(join(root, "apps/reviews/app.js"), join(docs, "projects/reviews/app.js"));
const reviewNfcDir = join(docs, "projects/reviews/nfc");
await mkdir(reviewNfcDir, { recursive: true });
await copyFile(join(root, "apps/reviews/nfc/index.html"), join(reviewNfcDir, "index.html"));
await copyFile(join(root, "apps/reviews/nfc/app.js"), join(reviewNfcDir, "app.js"));
await copyFile(join(root, "apps/reviews/nfc/setup.html"), join(reviewNfcDir, "setup.html"));
await copyFile(join(root, "apps/reviews/nfc/nfc-qr.png"), join(reviewNfcDir, "nfc-qr.png"));
await copyFile(join(root, "apps/reviews/nfc/douyin-review-code.png"), join(reviewNfcDir, "douyin-review-code.png"));
const reviewNfcAssetsDir = join(reviewNfcDir, "assets");
await mkdir(reviewNfcAssetsDir, { recursive: true });
for (const asset of ["review-example-portrait.webp", "review-example-bts.webp", "review-example-selection.webp", "review-photo-guide-triptych.png"]) {
  await copyFile(join(root, "apps/reviews/nfc/assets", asset), join(reviewNfcAssetsDir, asset));
}

const photoRecreationDir = join(docs, "projects/photo-recreation");
await rm(photoRecreationDir, { recursive: true, force: true });
await cp(join(root, "apps/photo-recreation"), photoRecreationDir, { recursive: true, force: true });

await rm(join(docs, "projects/portfolio"), { recursive: true, force: true });
await cp(join(root, "apps/portfolio"), join(docs, "projects/portfolio"), {
  recursive: true,
  force: true,
});

await rm(join(docs, "projects/portfolio-v2"), { recursive: true, force: true });
await cp(join(root, "apps/portfolio-v2"), join(docs, "projects/portfolio-v2"), {
  recursive: true,
  force: true,
});
for (const filename of ["index.html", "app.js"]) {
  const target = join(docs, "projects/portfolio-v2", filename);
  const content = await readFile(target, "utf8");
  await writeFile(target, content.replaceAll("__NBO_BUILD_VERSION__", portfolioBuildVersion));
}
await writeFile(
  join(docs, "projects/portfolio-v2", "build.json"),
  `${JSON.stringify({ version: portfolioBuildVersion })}\n`,
);

// 对外只公布 /p/。它使用同一份页面与资源，但地址栏不会跳到内部版本目录。
// 以后即使 portfolio-v2 升级或改名，也只需在这里改 base，已发出的链接不变。
const permanentPortfolioDir = join(docs, "p");
await rm(permanentPortfolioDir, { recursive: true, force: true });
await mkdir(permanentPortfolioDir, { recursive: true });
const publishedPortfolioIndex = await readFile(join(docs, "projects/portfolio-v2", "index.html"), "utf8");
const permanentPortfolioIndex = publishedPortfolioIndex.replace(
  "<head>",
  '<head>\n    <base href="../projects/portfolio-v2/" />',
).replaceAll('href="#', 'href="/nbo-smart-system/p/#');
await writeFile(join(permanentPortfolioDir, "index.html"), permanentPortfolioIndex);
await copyFile(join(root, "apps/portfolio-v2/privacy.html"), join(permanentPortfolioDir, "privacy.html"));
await writeFile(
  join(permanentPortfolioDir, "build.json"),
  `${JSON.stringify({ version: portfolioBuildVersion })}\n`,
);

// 成交洞察前台固定放在 GitHub Pages。数据接口继续使用 Sites/D1，避免
// chatgpt.site 的登录与安全拦截影响负责人在电脑、手机查看报表。
const portfolioInsightsDir = join(docs, "i");
await rm(portfolioInsightsDir, { recursive: true, force: true });
await cp(join(root, "apps/portfolio-insights"), portfolioInsightsDir, { recursive: true, force: true });
for (const filename of ["index.html"]) {
  const target = join(portfolioInsightsDir, filename);
  const content = await readFile(target, "utf8");
  await writeFile(target, content.replaceAll("__NBO_INSIGHTS_VERSION__", portfolioBuildVersion));
}

console.log(`GitHub Pages 已生成：${projects.length} 个直达入口，${internalProjects.length} 个永久项目主页，1 个真实好评系统 + NFC 顾客版 + 写真复刻台 + 客片 V1/V2 + 固定短链接 /p/ + 固定成交洞察 /i/`);
console.log(`客片 V2 资源版本：${portfolioBuildVersion}`);
