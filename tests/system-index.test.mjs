import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  ]) {
    assert.match(source, new RegExp(path.replaceAll("/", "\\/")));
    assert.match(published, new RegExp(path.replaceAll("/", "\\/")));
  }
  assert.match(source, /南铂客户选片中心/);
  assert.match(source, /南铂成交洞察后台/);
  assert.match(source, /南铂写真复刻台/);
  assert.match(published, /南铂客户选片中心/);
  assert.match(published, /南铂成交洞察后台/);
  assert.match(published, /南铂写真复刻台/);
  assert.match(readme, /南铂智能系统是唯一项目总目录/);
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
