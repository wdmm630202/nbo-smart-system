import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "app/page.tsx"), "utf8");
const css = await readFile(join(root, "app/globals.css"), "utf8");
const match = source.match(/const projects: Project\[\] = (\[[\s\S]*?\n\]);\n\nconst filters/);

if (!match) throw new Error("无法读取项目数据");

const projects = Function(`"use strict"; return (${match[1]});`)();
const marks = { network: "N", studio: "15", server: "99", workflow: "◇", odds: "2:1", video: "▶", crm: "透明", agent: "AI", expand: "9:16", meter: "72%", risk: "−18", reviews: "★★★★★" };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const cards = projects.map((project) => `
  <details class="project-card tone-${escapeHtml(project.tone)}">
    <summary>
      <div class="project-card-top"><span class="project-index">${escapeHtml(project.index)}</span><span class="project-status"><i></i>${escapeHtml(project.status)}</span></div>
      <div class="project-visual visual-${escapeHtml(project.visual)}"><span>${escapeHtml(marks[project.visual])}</span><small>${escapeHtml(project.category)}</small></div>
      <div class="project-copy"><span class="project-eyebrow">${escapeHtml(project.eyebrow)}</span><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.summary)}</p><div class="tag-row">${project.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></div>
      <span class="open-project">查看详情 <b>＋</b></span>
    </summary>
    <div class="static-detail"><p>${escapeHtml(project.detail)}</p>${project.href ? `<a href="${escapeHtml(project.href)}" target="_blank" rel="noreferrer">${escapeHtml(project.linkLabel || "打开项目")} ↗</a>` : `<span>${escapeHtml(project.linkLabel || "内部系统")}</span>`}</div>
  </details>`).join("");

const staticCss = `
main{min-height:100vh}.static-page .top-nav{position:sticky;top:10px;margin:10px auto 0;transform:none;left:auto}.static-page .work-section{padding-top:32px}.static-page .results-header{min-height:128px}.static-page .project-card{display:block}.static-page .project-card summary{position:relative;min-height:374px;list-style:none}.static-page .project-card summary::-webkit-details-marker{display:none}.static-page .project-copy h2{margin:7px 0;font-size:clamp(18px,1.35vw,24px);line-height:1.12;letter-spacing:-.035em}.static-page .static-detail{margin-top:12px;padding:14px;border-top:1px solid rgba(20,25,35,.08);color:#5f646c;font-size:11px;line-height:1.7}.static-page .static-detail p{margin:0 0 12px}.static-page .static-detail a,.static-page .static-detail>span{display:inline-flex;padding:8px 10px;border-radius:9px;background:#171a1f;color:white;font-weight:750}.static-page details[open] .open-project b{transform:rotate(45deg)}.static-page details[open]{content-visibility:visible}.static-page .open-project{opacity:1;transform:none}@media(max-width:640px){.static-page .top-nav{position:sticky}.static-page .work-section{padding-top:22px}.static-page .project-card summary{min-height:429px}}
`;

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
      <header class="results-header"><div><p>NBO SYSTEM INDEX · 2026</p><h1>NBO南铂智能系统</h1><span>打开即看结果 · 电脑、手机均可使用</span></div><div class="result-count"><strong>${projects.length}</strong><span>全部系统</span></div></header>
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
console.log(`GitHub Pages 已生成：${projects.length} 个系统`);
