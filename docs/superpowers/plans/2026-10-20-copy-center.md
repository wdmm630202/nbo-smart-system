# 南铂文案中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 交付已接入南铂智能系统、手机电脑可用的八平台简体中文文案中心。

**Architecture:** 独立 Cloudflare Worker 提供同源 UI、登录、API 与 AI 生成，独立 D1 保存记录。GitHub Pages 提供固定入口与总台卡片。

**Tech Stack:** 原生 HTML/CSS/ES modules、Cloudflare Workers、D1、Workers AI、Node 内置测试。

**Spec:** `docs/superpowers/specs/2026-10-20-copy-center-design.md`

## Global Constraints

- 八个平台：抖音、小红书、快手、视频号、TikTok、Instagram、Facebook、YouTube。
- 全部简体中文；地区不改变文字制式。
- 广告私有、手机电脑云端同步、程序进入 GitHub 总台，运行不依赖本机。
- 不上传客户视频或照片；不自动发布；生成失败保留现有版本。
- 原仓库最新分支的其他功能与数据保持完整。

## Review Focus

- CSV 引号、换行、BOM、重复编号、公式单元格及超量行。
- 两个设备同时编辑、保存途中断网、生成过程中手动修改。
- 匿名调用、跨来源写入、登录猜测和有害 HTML 输入。
- AI 缺平台、错误字段、繁体内容和非 JSON 返回。
- 390px 窄屏、空库、新导入百条广告、复制降级和备份合并。

### Task 1: 文案数据与生成规则

**Files:** Create `apps/copy-center/core.mjs`, `tests/copy-center-core.test.mjs`.

**Interfaces:** `PLATFORMS`, `validateAd(input)`, `buildPrompt(ad, settings, rules, platforms)`, `parseGenerated(result, platforms)`, `parseCsv(text)`, `prepareImport(rows, existing)`, `csvExport(rows)`.

- [ ] 先测试八平台、简体指令、资料边界、AI 校验、CSV 换行与重复记录、CSV 导出公式防护，运行确认失败。
- [ ] 实现以上纯函数；运行 Node 测试确认通过。
- [ ] 提交功能和测试。

### Task 2: 云端登录和数据 API

**Files:** Create `workers/copy-center/worker.mjs`, `schema.sql`, `wrangler.jsonc`, `tests/copy-center-api.test.mjs`.

**Interfaces:** `fetch(request, env)`; `/api/login`, `/api/logout`, `/api/state`, `/api/ads`, `/api/ads/:id`, `/api/generate`, `/api/import`, `/api/settings`, `/api/rules`; 所有数据接口登录检查，乐观版本比较。

- [ ] 先测试认证、来源检查、字段验证、冲突、AI 故障保留、导入事务，运行确认失败。
- [ ] 实现 D1 schema、会话、限流、API；写入限制与版本事务；运行测试通过。
- [ ] 创建专用 D1，应用迁移，部署独立 Worker，秘密仅配置到 Cloudflare。
- [ ] 提交 API、迁移和公开配置。

### Task 3: 响应式工作台、总台接入和验证

**Files:** Create `apps/copy-center/index.html`, `styles.css`, `app.mjs`, `README.md`; modify `app/page.tsx`, `app/project-visuals.mjs`, `app/project-visuals.d.ts`, `app/globals.css`, `tools/export-github-pages.mjs`, `README.md`; add `tests/copy-center-integration.test.mjs`.

**Interfaces:** UI 使用 Task 1 的平台定义和 Task 2 的同源 API。来源目录生成 Worker UI 模块；公开固定入口只包含跳转与进入链接。

- [ ] 实现登录、广告库、编辑器、生成、规则、看板、导入预览、备份和设置。
- [ ] 接入总台；运行既有总台测试和新功能测试；生成 GitHub Pages 静态文件并检查差异。
- [ ] 验证桌面与窄屏、两个登录会话、真实 AI 请求、JSON 恢复和 CSV 导入；清除测试广告。
- [ ] 按请求发布 Worker 与 GitHub Pages，核对上线页面和入口。
- [ ] 完成整分支独立评审，修正重要问题并验证，交付链接与登录方式。
