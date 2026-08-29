# 南铂客户看样固定入口

`https://p.nanbostudio.com/` 通过独立 Cloudflare Worker 读取现有 GitHub Pages 客片站。

- 固定公开入口：`https://p.nanbostudio.com/`
- 内容源：`https://wdmm630202.github.io/nbo-smart-system/p/`
- 不修改 GitHub Pages 的主域名，不影响南铂智能系统总台。
- 不依赖本地电脑或 `NBO-Immich` 隧道。
- 客片页面默认在空闲时启动匿名统计；客户可从说明页停止。浏览数据由同一个 Worker 直接写入亚太区 D1 数据库，不再经过可能被拦截的 `chatgpt.site`。
- 统计接口固定为 `https://p.nanbostudio.com/api/portfolio-analytics/collect`，只接受看样站与本地预览来源。
- 入口缓存 10 分钟；照片更新仍以 GitHub Pages 发布流程为准。
