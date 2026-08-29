# 南铂微信云托管签名中转 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用微信官方云托管开放接口服务取得 `jsapi_ticket` 并生成网页分享签名，代替已因 API IP 白名单失败的 Cloudflare + AppSecret 直连链路。

**Architecture:** 浏览器仍请求 `p.nanbostudio.com`。Cloudflare Worker 使用受保护的 Bearer 密钥调用微信云托管；云托管在容器内通过「开放接口服务」无 AppSecret、无 `access_token`、无 IP 白名单获取 ticket，生成 SHA-1 签名后只返回 JS-SDK 公开配置。

**Tech Stack:** Node.js 22 内置 HTTP/crypto/test runner、Docker、微信云托管、开放接口服务、Cloudflare Workers/Wrangler。

**Spec:** `docs/superpowers/specs/2026-08-30-wechat-cloud-hosting-broker-design.md`

## Global Constraints

- 不改变 `https://p.nanbostudio.com/`。
- 不再使用或要求用户提供 AppSecret。
- ticket、Bearer 密钥和旧 Cloudflare AppSecret 不进入 Git、聊天、浏览器响应或日志。
- 云托管仅授权 `/cgi-bin/ticket/getticket`，不新增用户信息、OpenID、消息、支付或存储权限。
- 使用最低容器规格、最小实例 1 和预算告警；不购买固定 IP 或其他附加产品。
- 先验证云托管和 Cloudflare 签名链路为 200，再发布已完成的前端 JS-SDK 代码。
- 新行为测试必须先见到预期失败，再写最小实现。
- Node 命令使用 `/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。

---

### Task 1: 云托管 ticket 与签名核心

**Files:**
- Create: `services/wechat-share-broker/wechat.js`
- Create: `services/wechat-share-broker/wechat.test.mjs`

- [ ] 写 URL 规范化失败测试：只接受 HTTPS `p.nanbostudio.com`，拒绝 HTTP、外域、用户信息、非默认端口和畸形 URL，移除 hash。
- [ ] 运行 `node --test services/wechat-share-broker/wechat.test.mjs`，确认因模块/导出缺失失败。
- [ ] 实现 `normalizeWechatPageUrl`，运行测试通过。
- [ ] 写固定向量 SHA-1 失败测试，实现 `createWechatSignature`并通过。
- [ ] 写开放接口请求失败测试：URL 必须为 `http://api.weixin.qq.com/cgi-bin/ticket/getticket?type=jsapi`，不得携带 `access_token`，成功响应必须有 `x-openapi-seqid`。
- [ ] 实现 `fetchWechatJsapiTicket`，将缺失云调用响应头、非 2xx、微信 errcode 和缺失 ticket 映射为稳定错误。
- [ ] 写内存缓存失败测试：有效缓存不再请求，提前 300 秒过期，并发刷新只请求一次。
- [ ] 实现实例内 ticket 缓存与并发合并。
- [ ] 运行 Task 1 测试，预期 0 FAIL。

### Task 2: 受保护的 HTTP 签名服务

**Files:**
- Create: `services/wechat-share-broker/server.js`
- Create: `services/wechat-share-broker/server.test.mjs`

- [ ] 写 HTTP 契约失败测试：`GET /healthz`、`POST /v1/signature`、401、404、405、JSON 限制和 8 KiB 请求体限制。
- [ ] 运行测试，确认因服务导出缺失失败。
- [ ] 实现 `createServer` 与定时安全 Bearer 比较；不记录请求头和请求体。
- [ ] 写成功响应字段集失败测试，注入固定 ticket、时间和 nonce，断言只返回五个公开字段。
- [ ] 实现签名响应和错误白名单，所有响应设置 `Cache-Control: no-store`。
- [ ] 运行 Task 1+2 测试，预期 0 FAIL。

### Task 3: 容器化与本地验证

**Files:**
- Create: `services/wechat-share-broker/Dockerfile`
- Create: `services/wechat-share-broker/.dockerignore`
- Create: `services/wechat-share-broker/README.md`

- [ ] 写 Docker 静态检查失败测试：非 root 用户、存在 shell、Node LTS、`PORT` 监听、健康检查。
- [ ] 创建最小 Dockerfile 和 `.dockerignore`，不复制任何 `.env` 或密钥。
- [ ] 如 Docker 可用，构建镜像并用本地模拟 ticket 依赖执行 HTTP 验证；如不可用，直接用 Node 启动同一服务执行契约测试。
- [ ] 运行服务全部测试和敏感词扫描，预期 0 FAIL 且无密钥文件。

### Task 4: Cloudflare 切换为云托管代理

**Files:**
- Modify: `workers/portfolio-gateway/wechat-share.js`
- Modify: `workers/portfolio-gateway/wechat-share.test.mjs`
- Modify: `workers/portfolio-gateway/wrangler.jsonc`

- [ ] 先写代理失败测试：POST 目标为 `WECHAT_BROKER_URL/v1/signature`，携带 Bearer 密钥，不携带 AppSecret/token/ticket，响应只接受五字段。
- [ ] 运行现有 Worker 测试，确认新契约因旧直连实现失败。
- [ ] 删除生产路径的 `stable_token`、AppSecret 和 KV ticket 依赖，实现 `fetchBrokerSignature`。
- [ ] 将 Wrangler 配置切换为 `WECHAT_BROKER_URL` + 必需 Secret `WECHAT_BROKER_SECRET`，移除代码对 `WECHAT_CACHE` 的依赖。
- [ ] 运行 Worker 、导出、客片验证与改动文件 lint，预期新增测试全部通过。

### Task 5: 开通微信云托管并发布中转服务

**External state:** 微信云托管控制台、计费账户、服务版本。

- [ ] 以当前服务号开通云托管环境，不开通与分享无关的产品。
- [ ] 如控制台要求账户充值或实名确认，暂停在该页让用户本人完成，不代替支付。
- [ ] 创建 `nanbo-wx-share`，开启公网访问，使用最低规格和最小实例 1，配置预算告警。
- [ ] 开启「开放接口服务」，只添加 `/cgi-bin/ticket/getticket`权限，确认开关已开后再创建版本。
- [ ] 在本机生成 32 字节以上随机密钥，分别写入云托管 `BROKER_SHARED_SECRET` 和 Cloudflare `WECHAT_BROKER_SECRET`，不打印具体值。
- [ ] 构建并发布服务版本，记录版本 ID 和公网域名，不记录密钥。
- [ ] 验证 `/healthz` 200、无鉴权 `/v1/signature` 401、正确鉴权签名 200 和云调用链路标记存在。

### Task 6: 线上切换、前端发布与真机验收

- [ ] 将云托管公网域名写入 Cloudflare `WECHAT_BROKER_URL`，部署 Worker。
- [ ] 请求 `https://p.nanbostudio.com/api/wechat-share/signature?...`，只记录 HTTP 状态和字段名，确认 200 且无 ticket/token/secret。
- [ ] 签名端点成功后，将现有前端 JS-SDK 代码合并到主分支并发布 GitHub Pages。
- [ ] 验证线上客片页、分享图、静态资源、匿名统计和签名端点均正常。
- [ ] 从 Cloudflare 删除旧 `WECHAT_APP_SECRET`。如 `WECHAT_CACHE` 已无代码引用，只移除 Worker binding，不删除远程 namespace。
- [ ] 请用户在微信真机执行一次右上角「发送给朋友」，确认标题、简介、封面和链接。
- [ ] 收藏后转发作为当前微信客户端实测项，不作官方能力保证。

### Task 7: 最终验证与交付

- [ ] 运行 broker、Worker、客片、Pages 导出和改动文件 lint 的全部相关测试。
- [ ] 检查 Git 差异和敏感信息扫描，确认无密钥、ticket、token 或用户无关文件。
- [ ] 只在真实线上状态和真机结果已验证时标记完成；若等待微信后台、充值或真机操作，明确说明当前检查点。
