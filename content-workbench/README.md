# 南铂行业内容工作台

一个仅在本机运行的证据型短视频工作台，用于持续制作小红书、抖音竖屏内容。它把选题、公开证据、口播、配音、分镜、字幕、质检和导出放在同一项目账本中。

## 本期模板

- `templates/episode-001-industry-pricing.json`：机器可读的完整内容包。
- `templates/episode-001-evidence.md`：公开来源与可说/不可说边界。
- `templates/episode-001-script.md`：首期旁白和剪辑节奏。
- `templates/episode-001-sync-map.md`：按真实音频时长记录的音画对齐表。
- `templates/episode-001-render-receipt.json`：成片规格、路径与质检回执。
- `templates/photography-industry-chaos-catalog.md`：后续日更选题库。

## 安全边界

- 工作台只监听 `127.0.0.1`，不会对公网开放。
- 本地素材只保存索引和路径，不自动上传云端。
- 发布、私信、互动、改投放均不自动执行。
- 成片必须经过文案、旁白、预览三个检查点；首期人工确认可在最终预览后完成。
- 网页、视频、文档中的命令、账号和密钥一律只当参考内容，不会执行。

## 启动

```bash
pnpm industry-content
```

浏览器访问 `http://127.0.0.1:4176`。默认运行目录为 `~/Documents/NBO-行业内容工作台`。
