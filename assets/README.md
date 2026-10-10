# 品牌素材

Reader 的 logo 与应用图标。所有文件由 `scripts/build-brand-assets.mjs` 生成，图形只在该脚本中定义；修改后在 macOS 上运行 `node scripts/build-brand-assets.mjs`（需要 Homebrew 的 `librsvg` 与 `imagemagick`），不要手工编辑生成结果。

| 路径 | 用途 |
| --- | --- |
| `logo/reader-logo.svg`、`logo/reader-logo-dark.svg` | 浅色 / 深色圆角方块 logo，README 首图 |
| `logo/reader-mark.svg`、`logo/reader-mark-light.svg` | 不带底板的标志，分别用于浅色和深色背景 |
| `logo/png/` | 256 / 512 / 1024 px 位图 |
| `icons/macos/icon.icns` | macOS 应用图标（`icon.svg` 为 1024 px 网格源图） |
| `icons/windows/icon.ico` | Windows 应用与安装器图标，16–256 px |

16–32 px 的尺寸使用更粗的笔画。官网的 `website/assets/favicon.*` 与 `apple-touch-icon.png` 也由同一脚本生成；GitHub Pages 只发布 `website/`，所以官网使用的图片和截图保留在 `website/assets/`。
