# 南铂客片微信云托管签名中转设计

## 背景与决策

原方案由 Cloudflare Worker 使用服务号 AppSecret 直接获取 `access_token` 和 `jsapi_ticket`。线上实测返回微信错误 `40164`，原因是 Cloudflare 动态出口 IP 无法稳定写入服务号 API IP 白名单。

用户已确认改用微信官方云托管。新方案保留客户唯一入口 `https://p.nanbostudio.com/` 和现有 Cloudflare Worker，新增一个最小微信云托管服务作为签名中转。云托管通过「开放接口服务」调用微信 API，不再使用 AppSecret、`access_token` 或 API IP 白名单。

## 成功标准

1. `https://p.nanbostudio.com/` 保持不变，现有客片浏览、需求生成和匿名统计不受影响。
2. Cloudflare 签名端点线上返回 HTTP 200，响应只包含 `appId`、`timestamp`、`nonceStr`、`signature` 和规范化后的 `url`。
3. 云托管调用 `http://api.weixin.qq.com/cgi-bin/ticket/getticket?type=jsapi` 时不携带 `access_token`，且微信响应头包含 `x-openapi-seqid`。
4. 云托管公网端点必须通过共享 Bearer 密钥验证，无密钥或密钥错误时返回 401。
5. 任何接口均不返回、记录或存储 `jsapi_ticket`、共享密钥或已废弃的 AppSecret。
6. 微信内真机右上角「发送给朋友」显示既定标题、简介、封面和固定链接。

## 方案选择

### 采用：Cloudflare 同域代理 + 微信云托管签名中转

- 浏览器仍只请求 `p.nanbostudio.com`，不新增 CORS 和第二个客户域名。
- Cloudflare Worker 仅校验 URL、调用云托管并转发签名响应。
- 云托管获取 `jsapi_ticket`、在容器内生成 SHA-1 签名，不向 Cloudflare 暴露 ticket。
- Cloudflare Secret 与云托管环境变量保存同一个随机 Bearer 密钥。密钥在本机生成和写入，不进入 Git、聊天、浏览器网页或日志。

### 不采用：云托管直接对浏览器开放

该方案需要第二个客户可见域名和 CORS，且公开签名端点更容易被滥用。

### 不采用：为 Cloudflare 购买固定出口 IP

该方案需要更高等级云服务或额外月费，只是为了绕过微信的 IP 白名单，成本和运维均不合适。

## 数据流

1. 微信内置浏览器打开 `https://p.nanbostudio.com/`。
2. 前端请求同域 `/api/wechat-share/signature?url=...`。
3. Cloudflare Worker 规范化 URL，只允许 HTTPS 的 `p.nanbostudio.com`。
4. Worker 以 POST JSON 调用云托管 `/v1/signature`，并在 `Authorization` 请求头携带 Bearer 密钥。
5. 云托管再次校验密钥和 URL，然后通过开放接口服务获取 `jsapi_ticket`。
6. 云托管使用最多 `expires_in - 300` 秒的内存缓存，并合并并发刷新。
7. 云托管在内存中生成随机串、时间戳与 SHA-1 签名，只返回可交给 JS-SDK 的公开配置。
8. Cloudflare Worker 校验响应结构后同域返回给页面，前端调用 `wx.config`。

## 云托管服务

### 项目结构

新增 `services/wechat-share-broker/`：

- `server.js`：只使用 Node.js 内置模块的 HTTP 服务。
- `wechat.js`：URL 校验、云调用 ticket 获取、缓存、签名和错误映射。
- `server.test.mjs` 与 `wechat.test.mjs`：使用 Node.js 内置测试器，不增加运行时依赖。
- `Dockerfile`：基于官方 Node LTS Alpine 镜像，保留 `/bin/sh`，监听环境变量 `PORT`。
- `.dockerignore`：排除 Git、测试临时文件和本机密钥。

### 公网契约

- `GET /healthz`：返回 `{ "ok": true }`，不调用微信。
- `POST /v1/signature`：仅接受 `application/json` 的 `{ "url": "..." }`。
- 其他方法或路径返回 404/405；请求体限制为 8 KiB。
- 所有响应设置 `Cache-Control: no-store`，不设置 CORS 允许头。
- 错误只返回稳定代码：`unauthorized`、`invalid_wechat_url`、`wechat_openapi_unavailable`、`wechat_ticket_unavailable`。

### 环境变量

- `WECHAT_APP_ID`：服务号 AppID，可见于微信后台。
- `BROKER_SHARED_SECRET`：随机至少 32 字节密钥，只存在云托管和 Cloudflare Secret。

云托管不存储 AppSecret。

## 微信云托管配置

1. 为服务号创建一个云托管环境。
2. 开启「开放接口服务」，并只授权 `/cgi-bin/ticket/getticket`。
3. 在开关已开启的状态下创建新版本；官方说明开关不会自动追加到旧版本。
4. 服务名使用 `nanbo-wx-share`，开启允许公网访问，但业务端点由 Bearer 密钥保护。
5. 容器采用控制台允许的最低 CPU 和内存规格。最小实例数保持 1，避免官方文档明确说明的「最小副本为 0 时服务不可访问」。
6. 设置预算告警；不购买固定出口 IP、数据库、对象存储或负载均衡附加项。

## Cloudflare 改造

- `workers/portfolio-gateway/wechat-share.js` 保留 URL 校验和同域端点契约。
- 删除生产路径对 `stable_token`、AppSecret、KV access token 和 KV ticket 的依赖。
- 使用 `WECHAT_BROKER_URL` 普通变量和 `WECHAT_BROKER_SECRET` Worker Secret 调用云托管。
- 对云托管响应做严格字段校验，只转发五个指定字段。
- 云托管签名端点经验证为 200 后，从 Cloudflare 删除旧 `WECHAT_APP_SECRET`。不在新方案中保留凭据回退。
- `WECHAT_CACHE` KV 若未被其他功能使用，在代码切换完成后从 Worker 绑定中移除；不自动删除远程 KV namespace。

## 安全与运维边界

- Bearer 密钥比较使用定时安全比较，不在错误中回显输入值。
- 云托管与 Cloudflare 都严格限制可签名 origin，防止为其他站点提供签名。
- 不记录请求头、请求体、签名原文、ticket 或完整微信错误响应。
- 仅保留健康状态、稳定错误码、HTTP 状态和 `x-openapi-seqid` 是否存在的布尔诊断。
- 旧 AppSecret 已被用户重置；新 AppSecret 也不再用于该链路。

## 测试与发布

1. 先为云托管服务写 URL、鉴权、ticket 缓存、开放接口响应头和签名的失败测试，再写实现。
2. 将容器在本机以模拟 ticket 接口运行，验证健康检查、401、URL 拒绝和成功字段集。
3. 开通云托管、开启开放接口服务、配置单个微信接口权限，然后创建版本。
4. 直接请求云托管健康端点和带密钥的签名端点，成功时不输出签名值。
5. 切换 Cloudflare Worker 为中转模式，验证同域端点 HTTP 200 和五字段契约。
6. 只在签名端点已经成功后，发布现有前端 JS-SDK 初始化。
7. 用微信真机执行「发送给朋友」验收；收藏转发只记录当前客户端实测结果。

## 回退

- 前端未发布前，线上页面仍是现有普通分享，无客户影响。
- 中转端点失败时，前端静默降级，不阻断客片站。
- Cloudflare Worker 代码可回退到上一已知正常版本；云托管服务可暂停公网访问。
- 不回退到 Cloudflare + AppSecret 直连方案，因为其 IP 白名单前提已经线上证伪。
