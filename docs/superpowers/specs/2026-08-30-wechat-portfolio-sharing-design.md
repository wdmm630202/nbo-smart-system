# 南铂客片链接微信分享接入设计

## 目标

在不改变客户入口 `https://p.nanbostudio.com/`、不影响现有客片浏览和匿名统计的前提下，接入已认证的“南铂摄影”微信服务号。客户或门店人员在微信内打开客片网页后，使用右上角“发送给朋友”时，应显示南铂摄影的标题、简介、封面和固定链接，而不是仅显示裸网址。

微信收藏后再次转发保留现有网页元数据，并作为实机兼容性检查项；微信官方只明确提供“分享给朋友”和“分享到朋友圈”的自定义接口，因此收藏转发不作为可强制保证的接口能力。

## 当前状态

- 客片固定入口由 `workers/portfolio-gateway/worker.js` 提供，代理 GitHub Pages 的 `/p/` 发布内容。
- `p.nanbostudio.com` 已在线，现有页面和分享图均可返回 HTTP 200。
- `apps/portfolio-v2/index.html` 已包含 Open Graph、Twitter 和 itemprop 分享元数据。
- Cloudflare Worker 已绑定 `p.nanbostudio.com`，并绑定 D1 数据库用于匿名访问统计。
- 已认证服务号尚未与客片站的 JS 接口安全域名、服务端签名和前端 JS-SDK 初始化连接。

## 成功标准

1. 原网址、客片浏览、收藏客片、生成需求和匿名统计保持正常。
2. 在微信内打开 `https://p.nanbostudio.com/` 后，从右上角发送给朋友，分享内容为：
   - 标题：`南铂摄影｜真实客片选风格`
   - 简介：`浏览真实男士客片，挑选喜欢的场景与主题，生成你的拍摄需求。`
   - 链接：`https://p.nanbostudio.com/`
   - 封面：现有 1200×630 `share-card.jpg`
3. 签名接口只接受 `https://p.nanbostudio.com/` 域名下的 HTTPS 页面地址，拒绝第三方域名、凭据缺失、非法方法和畸形输入。
4. AppSecret、access token 和 jsapi ticket 不进入浏览器、不写入 Git、不出现在日志和接口响应中。
5. access token 与 jsapi ticket 有共享缓存，正常页面访问不会逐次请求微信 API。
6. 微信 SDK 加载或签名失败时，页面仍可正常浏览；失败只影响微信自定义分享，不阻断客片站。

## 非目标

- 不做微信登录、用户授权、获取 OpenID、公众号菜单、模板消息或支付。
- 不改变客片页视觉、图片、筛选和客户数据流程。
- 不保证直接把网址粘贴进聊天时一定生成卡片。
- 不宣称微信收藏转发一定采用自定义分享数据；该场景按真机结果记录。
- 不把公众号 AppSecret 交给第三方服务。

## 方案选择

采用现有 Cloudflare Worker 作为签名服务，并使用 Cloudflare KV 作为两小时凭据的共享缓存。

该方案复用现有域名和 Worker，不新增客户入口，也不依赖门店电脑在线。AppSecret 通过 Wrangler 写入 Worker Secret；AppID 使用普通 Worker 变量。KV 保存短期 access token 和 jsapi ticket，并按微信返回的有效期提前五分钟失效。

若微信 API 因接口 IP 白名单返回 `40164`，不扩大 Cloudflare 动态出口 IP 白名单。实施在该检查点停止，并改用能提供稳定出口或微信托管令牌的服务端；在用户确认新的托管选择前，不接入付费基础设施。

## 架构与数据流

### 公众号后台

1. 在服务号设置中配置 `p.nanbostudio.com` 为 JS 接口安全域名。
2. 如微信要求校验文件，将官方生成的 `MP_verify_*.txt` 作为根路径静态文件提供，确认公网能读取后再完成域名校验。
3. 读取开发者 AppID；由用户本人在本机终端将 AppSecret 输入 Wrangler Secret，聊天和截图中不传 AppSecret。

### Cloudflare Worker

新增 `workers/portfolio-gateway/wechat-share.js`，职责限定为：

- 规范化并校验待签名 URL，移除 `#` 及其后内容，只允许 `https://p.nanbostudio.com`。
- 从 KV 读取仍有效的 access token；缺失时调用微信稳定版凭据接口并缓存。
- 从 KV 读取仍有效的 jsapi ticket；缺失时使用 access token 获取并缓存。
- 使用 `jsapi_ticket`、`noncestr`、`timestamp` 和完整无哈希 URL 按微信规则生成 SHA-1 签名。
- 只返回 `appId`、`timestamp`、`nonceStr`、`signature` 和规范化 URL。

`workers/portfolio-gateway/worker.js` 增加 `GET /api/wechat-share/signature?url=...` 路由。该路由：

- 只允许 GET 和同站调用；不为任意外域提供签名。
- 对正常响应设置 `Cache-Control: no-store`，避免浏览器或中间缓存复用含随机数的响应。
- 将微信错误映射为不泄露内部凭据的稳定错误码，例如 `wechat_credentials_unavailable`、`wechat_ip_not_allowed` 和 `wechat_ticket_unavailable`。
- 不记录请求中的签名、token、ticket 或密钥。

### Cloudflare 配置

`workers/portfolio-gateway/wrangler.jsonc` 增加：

- 普通变量 `WECHAT_APP_ID`。
- KV binding `WECHAT_CACHE`。

`WECHAT_APP_SECRET` 只通过 `wrangler secret put WECHAT_APP_SECRET` 写入已部署 Worker，不出现在配置文件、设计文档、命令历史示例值或提交中。

### 客片网页

新增 `apps/portfolio-v2/wechat-share.js`，并由 `apps/portfolio-v2/index.html` 加载微信官方 `jweixin-1.6.0.js` 与该模块。

前端行为：

1. 仅在微信内置浏览器中初始化，普通浏览器不发起签名请求。
2. 用 `location.href.split("#")[0]` 取得当前完整页面 URL，并向同域签名接口请求配置。
3. 调用 `wx.config`，只声明 `updateAppMessageShareData` 与 `updateTimelineShareData`。
4. 在 `wx.ready` 中设置固定标题、简介、链接和封面。
5. `wx.error` 和网络失败只写不含敏感信息的开发诊断，不显示阻断弹窗。

`tools/export-github-pages.mjs` 将 `wechat-share.js` 纳入发布副本，并继续替换资源版本号。固定短链接 `/p/` 和 `docs/projects/portfolio-v2/` 使用同一模块。

## 安全边界

- 允许签名的协议固定为 HTTPS，主机固定为 `p.nanbostudio.com`，端口固定为默认 443。
- 不接受用户提供的 AppID、AppSecret、token 或 ticket。
- 签名响应不设置跨域开放头；浏览器从同域调用。
- 微信接口响应仅提取业务所需字段，错误内容经过白名单映射后再返回。
- KV 键仅保存当前凭据和明确到期时间；不保存访客 URL、OpenID、微信用户信息或客户资料。
- 域名校验文件只提交微信官方生成的单个文件，不允许任意文件上传。

## 测试策略

先测试、后实现，每个行为执行红—绿验证。

### Worker 单元测试

- 正确规范化带查询参数和哈希的同域 URL。
- 拒绝 HTTP、非默认端口、用户信息、非南铂域名和畸形 URL。
- 使用固定 ticket、随机串、时间戳和 URL 产生手工核对的 SHA-1 结果。
- 有效 KV 缓存命中时不调用微信 API。
- 缓存缺失时依次取得 token 和 ticket，并按 `expires_in - 300` 缓存。
- 微信返回 `40164` 时映射为 `wechat_ip_not_allowed`，不回传 AppSecret 或微信原始响应体。
- 签名路由拒绝非 GET 方法和缺失 URL。

### 静态发布测试

- 源页面加载官方 JS-SDK 与 `wechat-share.js`。
- Pages 导出后 `/p/` 和 `/projects/portfolio-v2/` 都包含同版本脚本。
- 现有图库验证、匿名统计测试和 GitHub Pages 导出测试继续通过。

### 线上验证

1. 本地 Worker 测试、客片测试、Pages 导出和 lint 全部通过。
2. 部署 Worker 后请求签名端点，只检查字段结构和状态，不输出签名或凭据到交付说明。
3. 检查 `p.nanbostudio.com`、分享图、客片资源和匿名统计接口仍正常。
4. 在微信真机中打开页面，从右上角发送给一个测试联系人，确认标题、简介、封面和链接。
5. 收藏网页后再转发一次，记录微信当前客户端的实际显示；不把该次结果外推为所有版本保证。

## 发布与回退

发布分两段进行：

1. 先部署 Worker 签名接口和密钥，确认签名链路可用且无 `40164`。
2. 再发布网页 JS-SDK 初始化代码，避免前端先上线而接口尚未就绪。

如果 Worker 接口异常，移除前端 `wechat-share.js` 加载即可回退到当前可浏览、可复制链接的状态；客片内容和固定网址不受影响。若前端已部署但签名接口暂时失败，网页自动降级为当前普通分享行为。

## 用户需要完成的官方后台动作

- 登录微信公众平台确认服务号“微信认证”有效。
- 将 `p.nanbostudio.com` 配置为 JS 接口安全域名，并提供微信官方下载的域名校验文件（如页面要求）。
- 在本机受控输入 AppID 与 AppSecret；AppSecret 不发送到聊天。
- 配合一次微信真机分享验收。
