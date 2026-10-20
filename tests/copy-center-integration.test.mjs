import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('总台源码、静态发布页和说明登记同一个手机电脑入口',async()=>{
 for(const path of ['app/page.tsx','docs/index.html','README.md']){const text=await read(path);assert.match(text,/南铂文案中心/);assert.match(text,/projects\/copy-center\//);}
 const entry=await read('docs/projects/copy-center/index.html');assert.match(entry,/https:\/\/copy.nanbostudio.com\//);assert.match(entry,/统一简体中文/);
});
test('发布构建包含完整响应式应用与 API，不带开发访问码',async()=>{
 const worker=await read('workers/copy-center/.deploy/worker.mjs');
 for(const asset of ['/index.html','/styles.css','/app.mjs','/core.mjs','/simplified.mjs'])assert.ok(worker.includes(JSON.stringify(asset)),asset);
 assert.match(worker,/\/api\/generate/);assert.match(worker,/HttpOnly; Secure; SameSite=Strict/);
 assert.equal(worker.includes('test-code-with-enough-length'),false);
 const css=await read('apps/copy-center/styles.css');assert.match(css,/@media\(max-width:650px\)/);
});
test('实际发布模块可加载，并逐字返回带特殊字符的应用资源',async()=>{
 let built;await assert.doesNotReject(async()=>{built=(await import('../workers/copy-center/.deploy/worker.mjs')).default;});
 for(const name of ['core.mjs','app.mjs']){const response=await built.fetch(new Request('https://copy.nanbostudio.com/'+name),{});assert.equal(response.status,200);assert.equal(await response.text(),await read('apps/copy-center/'+name));}
});
