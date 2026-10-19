# 南铂文案中心

入口：<https://wdmm630202.github.io/nbo-smart-system/projects/copy-center/>

云端应用：<https://copy.nanbostudio.com/>

八个平台统一简体中文，目标地区默认国内，可选马来西亚、新加坡、台湾和海外华人。广告与八平台各地区版本保存到独立 Cloudflare D1；复制文案后在相应 App 发布。

## 日常使用

1. 输入访问码。访问码保存在负责人处，服务器通过 Cloudflare Secret 配置，不写入公开源码。
2. 新建广告并录入真实素材信息；或下载 CSV 模板整理后批量导入，每次最多 500 条。
3. 在工作台选择地区，补全八平台文案或生成当前平台。生成成功后保存为草稿，可继续修改。
4. 单独复制标题、正文或整段文案；发布后记录状态、日期与链接。
5. 修改前的最近 20 个版本可恢复；品牌与备份页支持 JSON 完整备份、CSV 文案导出和备份合并。已有广告不会在合并时被覆盖。

默认平台字数属于运营建议；实际硬性要求应在发布入口核对并写入平台规则。套餐与服务地点由用户填写。视频仅保存链接，AI 生成只接收文字资料，不读取链接中的媒体。

## 部署和恢复

源代码与总台在同一个 GitHub 仓库。数据库、登录会话和访问码不进入 GitHub。依次运行：

```sh
node tools/build-copy-center.mjs
npx wrangler deploy --config workers/copy-center/wrangler.jsonc
node tools/export-github-pages.mjs
```

首次安装通过 `workers/copy-center/schema.sql` 初始化专用 D1；现有库无需重新创建。绑定 `DB`、Workers AI `AI`，以 Secret `COPY_ACCESS_KEY` 配置访问码。变更访问码后如需立即撤销全部已登录设备，清空此应用专用库的 `sessions` 表。

`OpenCC-LICENSE` 对应 OpenCC 繁简转换字符词典；生成与保存时统一转换成简体中文。
