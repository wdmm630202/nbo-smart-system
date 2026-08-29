import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const ERP_URL = "https://erp.nanbostudio.com";
const legacyErpUrl = ["nanbo-photo-erp-2026", "wdmm630202", "chatgpt.site"].join(".");

test("南铂智能系统登记所有已上线核心入口", async () => {
  const [source, published, readme] = await Promise.all([
    read("app/page.tsx"),
    read("docs/index.html"),
    read("README.md"),
  ]);

  for (const path of [
    "/nbo-smart-system/p/",
    "/nbo-smart-system/i/",
    "/nbo-smart-system/projects/photo-recreation/",
    "/nbo-smart-system/projects/photo-video-sorter/",
  ]) {
    assert.match(source, new RegExp(path.replaceAll("/", "\\/")));
    assert.match(published, new RegExp(path.replaceAll("/", "\\/")));
  }
  assert.match(source, /南铂客户选片中心/);
  assert.match(source, /南铂成交洞察后台/);
  assert.match(source, /南铂写真复刻台/);
  assert.match(source, /照片视频一键分类/);
  const erpCard = source.match(/id: "erp",[\s\S]*?linkLabel: "打开南铂摄影 ERP",/);
  assert.ok(erpCard, "ERP card exists");
  assert.match(erpCard[0], new RegExp(ERP_URL));
  assert.match(erpCard[0], /status: "内部账号运行中"/);
  for (const detail of [
    "最高管理员、经理、普通员工",
    "电脑与手机",
    "自有域名",
    "私有会话",
    "\\/login",
    "老板账号恢复路径由 Cloudflare Access 保护",
    "客户历史面板",
    "累计消费",
  ]) {
    assert.match(erpCard[0], new RegExp(detail), detail);
  }
  assert.match(published, /南铂客户选片中心/);
  assert.match(published, /南铂成交洞察后台/);
  assert.match(published, /南铂写真复刻台/);
  assert.match(published, /照片视频一键分类/);
  assert.match(published, /南铂摄影 ERP/);
  assert.match(published, new RegExp(ERP_URL));
  assert.match(published, /内部账号运行中/);
  assert.match(published, /最高管理员、经理、普通员工/);
  assert.match(published, /客户历史面板/);
  assert.match(published, /累计消费/);
  assert.match(readme, /南铂智能系统是唯一项目总目录/);
  assert.match(readme, /南铂摄影 ERP/);
  assert.match(readme, new RegExp(ERP_URL));
  assert.match(readme, /内部账号运行中/);
  assert.match(readme, /最高管理员、经理、普通员工/);
  assert.match(readme, /客户历史面板/);
  assert.match(readme, /累计消费/);
  for (const document of [source, published, readme]) {
    assert.equal(document.includes(legacyErpUrl), false, "legacy ERP URL is removed");
  }
  assert.match(source, /南铂店内选片系统/);
  assert.match(source, /\/nbo-smart-system\/projects\/nanbo-select\//);
  assert.match(published, /南铂店内选片系统/);
  assert.match(readme, /南铂店内选片系统/);
});

test("NBO 音乐中枢登记本机入口和迁移用途", async () => {
  const [source, published, readme] = await Promise.all([
    read("app/page.tsx"),
    read("docs/index.html"),
    read("README.md"),
  ]);

  for (const document of [source, published, readme]) {
    assert.match(document, /NBO 音乐中枢/);
  }
  const card = source.match(/id: "music-hub",[\s\S]*?linkLabel: "打开音乐中枢档案",/);
  assert.ok(card, "music hub card exists");
  assert.match(card[0], /category: "App"/);
  assert.match(card[0], /status: "本机运行"/);
  assert.match(card[0], /Docker/);
  assert.match(card[0], /127\.0\.0\.1:4533/);
  assert.match(card[0], /127\.0\.0\.1:23333\/health/);
  assert.match(card[0], /projects\/music-hub\//);
});

test("NBO 音源雷达登记安全边界和固定入口", async () => {
  const [source, published, readme] = await Promise.all([
    read("app/page.tsx"),
    read("docs/index.html"),
    read("README.md"),
  ]);
  for (const document of [source, published, readme]) assert.match(document, /NBO 音源雷达/);
  const card = source.match(/id: "source-radar",[\s\S]*?linkLabel: "打开音源雷达档案",/);
  assert.ok(card, "source radar card exists");
  assert.match(card[0], /category: "自动化"/);
  assert.match(card[0], /status: "每日扫描"/);
  assert.match(card[0], /127\.0\.0\.1:23333\/radar/);
  assert.match(card[0], /不执行、不自动导入/);
  assert.match(card[0], /projects\/source-radar\//);
});

test("小红书真实客片封面工具可跨电脑使用且照片只在浏览器本地处理", async () => {
  const [source, publishedIndex, toolHtml, renderer] = await Promise.all([
    read("app/page.tsx"),
    read("docs/index.html"),
    read("docs/projects/xhs-cover/index.html"),
    read("docs/projects/xhs-cover/src/renderer.js"),
  ]);
  for (const document of [source, publishedIndex]) {
    assert.match(document, /小红书真实客片封面/);
    assert.match(document, /projects\/xhs-cover\//);
  }
  assert.match(toolHtml, /照片只在本机处理/);
  assert.match(toolHtml, /1080/);
  assert.match(toolHtml, /1440/);
  assert.match(renderer, /drawBlendedEvidence/);
  assert.match(renderer, /setLineDash/);
});

test("南铂店内选片系统有固定项目页和 Intel Mac 恢复包", async () => {
  const [page, installerStat] = await Promise.all([
    read("docs/projects/nanbo-select/index.html"),
    stat(new URL("../docs/projects/nanbo-select/downloads/NANBO-SELECT-1.0.1-Intel-Mac.dmg", import.meta.url)),
  ]);

  assert.match(page, /NANBO SELECT 1\.0\.1/);
  assert.match(page, /店内 Mac 或 NAS 本地读取/);
  assert.match(page, /NANBO-SELECT-1\.0\.1-Intel-Mac\.dmg/);
  assert.match(page, /已修复本地照片显示/);
  assert.match(page, /等待签名发布/);
  assert.ok(installerStat.size > 1_000_000);
});

test("截图中的四个 Mac 工具都已登记并可恢复", async () => {
  const [source, sorterHtml, sorterScript, packageBuffer, packageStat] = await Promise.all([
    read("app/page.tsx"),
    read("docs/projects/photo-video-sorter/index.html"),
    read("docs/projects/photo-video-sorter/source/classify.sh"),
    readFile(new URL("../docs/projects/photo-video-sorter/downloads/photo-video-sorter-v8.1-macos.zip", import.meta.url)),
    stat(new URL("../docs/projects/photo-video-sorter/downloads/photo-video-sorter-v8.1-macos.zip", import.meta.url)),
  ]);

  for (const name of ["南铂 Stash 长期运行中心", "NBO OS 珠宝修图工作流", "Codex 余量 Pro", "照片视频一键分类"]) {
    assert.match(source, new RegExp(name));
  }
  assert.match(sorterHtml, /Mac 本机使用/);
  assert.match(sorterHtml, /目前没有预览和一键撤销/);
  assert.match(sorterScript, /\$\{count\}张/);
  assert.doesNotMatch(sorterScript, /\$count张/);
  assert.ok(packageStat.size > 1_000_000);
  assert.equal(createHash("sha256").update(packageBuffer).digest("hex"), "83874b3bbae5e859f7e55c0fb7407f782cd55c733332e9e7d6ead72bc5fa27ac");
});

test("写真复刻台发布完整静态功能文件", async () => {
  const [html, app, css] = await Promise.all([
    read("docs/projects/photo-recreation/index.html"),
    read("docs/projects/photo-recreation/app.js"),
    read("docs/projects/photo-recreation/styles.css"),
  ]);

  assert.match(html, /南铂写真复刻台/);
  assert.match(html, /src="app\.js"/);
  assert.match(html, /先生成复刻指令/);
  assert.match(html, /Google Gemini/);
  assert.match(html, /gemini-3\.1-flash-image/);
  assert.match(app, /function templateAnalysis/);
  assert.match(app, /x-goog-api-key/);
  assert.match(app, /:generateContent/);
  assert.match(app, /\/interactions/);
  assert.match(app, /geminiInlineImage/);
  assert.match(app, /无法连接/);
  assert.doesNotMatch(app, /AIza[0-9A-Za-z_-]{20,}/);
  assert.match(css, /@media \(max-width: 590px\)/);
});

test("总台卡片编号唯一且连续", async () => {
  const source = await read("app/page.tsx");
  const indexes = [...source.matchAll(/index: "(\d{2})"/g)].map((match) => Number(match[1]));
  assert.deepEqual(indexes, Array.from({ length: indexes.length }, (_, index) => index + 1));
  assert.equal(new Set(indexes).size, indexes.length);
});

test("总台每张卡片直接展示能说明用途的应用界面", async () => {
  const published = await read("docs/index.html");
  const visualKinds = [...published.matchAll(/data-project-ui="([^"]+)"/g)].map((match) => match[1]);
  const miniInterfaces = [...published.matchAll(/data-mini-interface="true"/g)];

  assert.equal(visualKinds.length, 21, "21 张卡片都应有代表性应用界面");
  assert.equal(new Set(visualKinds).size, 21, "每个项目应使用自己的界面场景");
  assert.equal(miniInterfaces.length, 20, "除真实 Stash 截图外，其余卡片应使用轻量微缩界面");

  for (const description of [
    "南铂 Stash 设备与灾备运行界面",
    "正在制作封面图",
    "服务器与备份运行状态",
    "珠宝照片精修流程",
    "比赛赔率与风险界面",
    "竖屏视频剪辑时间线",
    "企业微信客户跟进界面",
    "男士写真三天运营计划",
    "封面安全扩图对比",
    "Codex 用量监控界面",
    "投注情景与仓位风险表",
    "真实好评生成界面",
    "客户真实客片选片界面",
    "成交洞察数据面板",
    "写真参考图与本人图复刻界面",
    "照片视频自动分类界面",
    "摄影 ERP 客户订单界面",
    "店内全屏选片界面",
    "私人音乐库播放界面",
    "音源项目安全扫描界面",
    "小红书真实客片封面制作界面",
  ]) {
    assert.match(published, new RegExp(`aria-label="${description}"`), description);
  }
});

test("卡片人物预览使用专用轻量资源", async () => {
  const published = await read("docs/index.html");
  const assetNames = ["system-preview-after.jpg", "system-preview-before.jpg"];

  for (const assetName of assetNames) {
    assert.match(published, new RegExp(`/nbo-smart-system/${assetName}`), assetName);
    const assetStat = await stat(new URL(`../docs/${assetName}`, import.meta.url));
    assert.ok(assetStat.size < 180_000, `${assetName} 应小于 180KB，实际 ${assetStat.size} bytes`);
  }
});
