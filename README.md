# NBO南铂智能系统

南铂摄影开发的 App、网页、自动化工作流与 AI 智能体统一入口。

- 固定网站：<https://wdmm630202.github.io/nbo-smart-system/>
- 源代码由 GitHub 长期保存，可在新电脑重新克隆。
- `docs/` 是无服务器静态版本，不依赖原电脑在线。
- 21 张项目卡片都是直达链接；不需要展开详情。
- Stash 卡片直接显示真实管理界面预览；点击整张卡片进入受安全登录保护的云端运行中心。
- 网站内容更新后运行 `pnpm pages:build`，再提交并推送即可同步固定网站。

## 长期项目规则

1. 每个项目必须有独立、固定、可收藏的网址。
2. 入口必须支持电脑和手机，不以某一台 Mac 开机为前提。
3. GitHub 保存源代码和静态站点，换电脑后仍可恢复和继续开发。
4. 本地 App 可以作为增强工具，但不能成为项目的唯一入口。
5. 尚未完成网页功能迁移的项目，先建立永久项目主页，并在后续版本把实际功能接入同一网址。
6. **南铂智能系统是唯一项目总目录。** 以后新建或完成任何智能体、网页、App、自动化工具，都必须在同一次交付中登记到总台；没有进入总台，不算完成。
7. 项目卡片至少记录名称、类型、用途、状态、固定网址，并在上线前验证电脑和手机都能打开。

当前可直接使用的线上功能：

- Stash 长期运行中心：<https://stash-status.nanbostudio.com/>（受 Cloudflare Access 安全登录保护）
- NBO 灵感封面：<https://wdmm630202.github.io/nbo-cover-copy/>
- 南铂客户选片中心：<https://wdmm630202.github.io/nbo-smart-system/p/>
- 南铂成交洞察后台：<https://wdmm630202.github.io/nbo-smart-system/i/>
- 南铂写真复刻台：<https://wdmm630202.github.io/nbo-smart-system/projects/photo-recreation/>（无 API 可生成复刻指令；AI 分析和出图需要可用模型与额度）
- 照片视频一键分类：<https://wdmm630202.github.io/nbo-smart-system/projects/photo-video-sorter/>（线上档案与 Mac 恢复包；实际分类需在 Mac 本机运行）
- 南铂摄影 ERP：<https://erp.nanbostudio.com>（内部账号运行中；`/` 会跳转内部 `/login`。最高管理员、经理、普通员工可在电脑/手机使用自有域名私有会话；老板账号恢复路径由 Cloudflare Access 保护。客户历史面板会将同一客户的独立订单集中显示，并汇总累计消费、实收、待收与拍摄历史）
- 南铂店内选片系统：<https://wdmm630202.github.io/nbo-smart-system/projects/nanbo-select/>（店内本地高清选片；Intel Mac 1.0.1 恢复包）
- NBO 音乐中枢：<https://wdmm630202.github.io/nbo-smart-system/projects/music-hub/>（Docker 本机运行；Navidrome `127.0.0.1:4533`；网关健康 `127.0.0.1:23333/health`；支持整体备份和换电脑恢复）
- NBO 音源雷达：<https://wdmm630202.github.io/nbo-smart-system/projects/source-radar/>（每日只读扫描 GitHub 元数据；本机仪表盘 `127.0.0.1:23333/radar`；不执行、不自动导入网友音源）
- 小红书真实客片封面：<https://wdmm630202.github.io/nbo-smart-system/projects/xhs-cover/>（Mac、Windows 直接打开；照片只在浏览器本地处理；导出 1080×1440 PNG）

截图中的 4 个 Mac 工具均已登记：01 南铂 Stash 长期运行中心、04 NBO OS 珠宝修图工作流、10 Codex 余量 Pro、16 照片视频一键分类。可公开的分类工具源码与恢复包随本仓库保存；其余本机 App、工程源码和加密配置另存 GitHub 私有恢复库，不公开客户素材、明文密钥或设备令牌。

其余项目的独立入口统一使用：

`https://wdmm630202.github.io/nbo-smart-system/projects/<项目代号>/`
