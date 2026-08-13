# 照片视频一键分类

南铂摄影的 macOS Finder 素材整理工具。固定项目入口：

<https://wdmm630202.github.io/nbo-smart-system/projects/photo-video-sorter/>

## 当前归档

- App 版本：8.1
- 支持：Intel 与 Apple 芯片 Mac
- 源码：`source/main.applescript`、`source/classify.sh`
- 恢复包：`downloads/photo-video-sorter-v8.1-macos.zip`
- SHA-256：`83874b3bbae5e859f7e55c0fb7407f782cd55c733332e9e7d6ead72bc5fa27ac`
- 8.1 修复：中文数量单位紧跟变量时被 Shell 误判为变量名，导致目标文件夹名为空。

## 功能边界

- 只处理 Finder 当前文件夹第一层。
- CR2、CR3、JPG/JPEG 按格式、拍摄日期、时间、数量和总大小建立目录。
- 视频按 2K、3K、4K 建立目录；低于 2K 或无法识别的视频保留原位。
- 其他文件保持原位。
- 工具会移动文件并可能补全旧照片文件夹名称，目前没有预览和一键撤销。重要客片第一次使用时，先对文件夹副本运行。

## 更新规则

每次升级 App 后，同时替换恢复包、源码和版本号，更新 SHA-256，再运行总台导出与测试。线上页面只是长期档案和下载入口，实际整理必须在 Mac 本机运行。
