# 南铂男士写真选风格 V2

- V1 保持在 `apps/portfolio` 与 `/projects/portfolio/`，不被本版本覆盖。
- V2 发布到 `/projects/portfolio-v2/`，复用 V1 的 158 张优化图片，避免重复占用仓库和网络流量。
- 核心路径：首屏 → 风格方向 → 真实客片 → 喜欢清单 → 图文需求 → 拍前准备。
- 本地喜欢与需求设置沿用 V1 的 localStorage 键，客户切换版本时已选照片不会丢失。
- V1 稳定回退标签：`portfolio-v1-stable-20260812`。
- 对外唯一固定入口：`https://wdmm630202.github.io/nbo-smart-system/p/`，不加版本参数，不再更换。

## 本地换图

Finder 中双击仓库根目录的 `打开南铂客片管理.command`，不要直接修改 `docs`。

1. 在管理台找到客片编号，选择新的 3:4 精修图。
2. 确认替换后先打开本地网站预览。
3. 确认无误后点“同步到网站”，管理台会校验、导出、提交、推送并等待 GitHub Pages 上线。

照片目录仍以 `apps/portfolio/assets/photos` 为唯一源头。主题、场景和展示顺序集中在 `apps/portfolio-v2/catalog.js`，页面和本地管理台共用同一份清单。
