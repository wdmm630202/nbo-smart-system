# NBO南铂智能系统

南铂摄影开发的 App、网页、自动化工作流与 AI 智能体统一入口。

- 固定网站：<https://wdmm630202.github.io/nbo-smart-system/>
- 源代码由 GitHub 长期保存，可在新电脑重新克隆。
- `docs/` 是无服务器静态版本，不依赖原电脑在线。
- 12 张项目卡片都是直达链接；不需要展开详情，也不再使用“本机运行”入口。
- 网站内容更新后运行 `pnpm pages:build`，再提交并推送即可同步固定网站。

## 长期项目规则

1. 每个项目必须有独立、固定、可收藏的网址。
2. 入口必须支持电脑和手机，不以某一台 Mac 开机为前提。
3. GitHub 保存源代码和静态站点，换电脑后仍可恢复和继续开发。
4. 本地 App 可以作为增强工具，但不能成为项目的唯一入口。
5. 尚未完成网页功能迁移的项目，先建立永久项目主页，并在后续版本把实际功能接入同一网址。

当前可直接使用的线上功能：

- Stash 长期运行中心：<https://stash-status.nanbostudio.com/>（受 Cloudflare Access 安全登录保护）
- NBO 灵感封面：<https://wdmm630202.github.io/nbo-cover-copy/>

其余项目的独立入口统一使用：

`https://wdmm630202.github.io/nbo-smart-system/projects/<项目代号>/`
