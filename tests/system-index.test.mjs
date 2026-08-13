import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

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
  assert.match(published, /南铂客户选片中心/);
  assert.match(published, /南铂成交洞察后台/);
  assert.match(published, /南铂写真复刻台/);
  assert.match(published, /照片视频一键分类/);
  assert.match(readme, /南铂智能系统是唯一项目总目录/);
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
  assert.match(app, /function templateAnalysis/);
  assert.match(css, /@media \(max-width: 590px\)/);
});

test("总台卡片编号唯一且连续", async () => {
  const source = await read("app/page.tsx");
  const indexes = [...source.matchAll(/index: "(\d{2})"/g)].map((match) => Number(match[1]));
  assert.deepEqual(indexes, Array.from({ length: indexes.length }, (_, index) => index + 1));
  assert.equal(new Set(indexes).size, indexes.length);
});
