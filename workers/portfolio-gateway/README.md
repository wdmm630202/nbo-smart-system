# 南铂客户看样固定入口

`https://p.nanbostudio.com/` 通过独立 Cloudflare Worker 读取现有 GitHub Pages 客片站。

- 固定公开入口：`https://p.nanbostudio.com/`
- 内容源：`https://wdmm630202.github.io/nbo-smart-system/p/`
- 不修改 GitHub Pages 的主域名，不影响南铂智能系统总台。
- 不依赖本地电脑或 `NBO-Immich` 隧道。
- 入口缓存 10 分钟；照片更新仍以 GitHub Pages 发布流程为准。
