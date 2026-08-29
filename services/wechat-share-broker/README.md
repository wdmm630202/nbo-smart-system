# Nanbo WeChat Share Broker

该服务部署到「南铂摄影」服务号所属的微信云托管环境，通过「开放接口服务」获取 `jsapi_ticket` 并在容器内为 `https://p.nanbostudio.com/` 生成 JS-SDK 签名。

## 必需配置

- 云调用权限只开启 `/cgi-bin/ticket/getticket`。
- 开启「开放接口服务」后再创建服务版本。
- `WECHAT_APP_ID`：服务号 AppID。
- `BROKER_SHARED_SECRET`：至少 32 字节的随机密钥，必须与 Cloudflare Worker Secret 一致。

本服务不需要、不保存 AppSecret 或 `access_token`。

## 端点

- `GET /healthz`：无鉴权健康检查。
- `POST /v1/signature`：需要 `Authorization: Bearer ...`，请求体为 `{ "url": "https://p.nanbostudio.com/" }`。

成功响应只包含 `appId`、`timestamp`、`nonceStr`、`signature` 和 `url`，不包含 ticket 或任何密钥。
