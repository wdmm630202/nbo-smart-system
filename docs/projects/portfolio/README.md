# 南铂 158 张真实客片画廊

面向企业微信客户的手机优先静态网页，已收录 158 张竖版 `1080 × 1440` 样片。

## 浏览性能

- 首屏只渲染 30 张，点击“继续浏览”后每次增加 30 张。
- 列表使用 480 × 640 WebP 缩略图，158 张合计约 2.9 MB。
- 点击某张照片时，才加载对应的 1080 × 1440 高清 JPG。
- 支持风格筛选、全屏左右滑动、键盘切换和复制照片编号。

## 照片目录

- `assets/photos/thumbs/`：网页列表缩略图。
- `assets/photos/full/`：全屏查看高清图。
- `assets/photos/featured/`：首页精选视觉。

重新生成全部资源：

```bash
python3 tools/build_gallery_assets.py
```

## 本机预览

```bash
python3 -m http.server 8765
```

浏览器打开 `http://127.0.0.1:8765`。正式链接由 GitHub Pages 提供 HTTPS，企业微信中直接填写公开网址即可。
