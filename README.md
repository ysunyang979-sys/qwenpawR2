# Cloudflare R2 Storage Tool for QwenPaw

[![QwenPaw Plugin](https://img.shields.io/badge/QwenPaw-Plugin-blue.svg)](https://github.com/ysunyang979-sys/qwenpawR2)
[![Release](https://img.shields.io/github/v/release/ysunyang979-sys/qwenpawR2)](https://github.com/ysunyang979-sys/qwenpawR2/releases)

QwenPaw 官方标准扩展插件：为 QwenPaw Agent 赋予无缝管理与读写 **Cloudflare R2 云端对象存储**的能力。

---

## ✨ 核心特性

- ☁️ **云端文件列表 (list_r2_files)**：查询指定路径或存储桶根目录下的文件与文件夹。
- 📄 **云端文件读取 (ead_r2_file)**：按需分块流式读取云端代码、配置、Markdown 或文档内容。
- ⬆️ **文件一键上传 (upload_r2_file)**：AI 对话中生成的文件、报告与数据直接写入 Cloudflare R2。
- 🗑️ **云端文件删除 (delete_r2_file)**：精确删除指定云端对象。
- ⚡ **连接健康监控 (get_r2_status)**：快速检测 R2 存储桶与凭证连接状态。

---

## 🚀 安装方法

### 方式一：在 QwenPaw Web 控制台通过 URL 安装（最便捷）

1. 在 QwenPaw 左侧菜单点击 **「插件」**（Plugins）。
2. 点击右上角 **「安装插件」**。
3. 在弹出的安装窗口底部 **「或通过 URL 安装」** 输入框中粘贴以下链接：
   `	ext
   https://github.com/ysunyang979-sys/qwenpawR2/releases/download/v1.0.0/cloudflare-r2.zip
   `
4. 点击 **「从 URL 安装」**，系统将全自动下载、校验并热加载生效。

### 方式二：命令行 CLI 安装

在 QwenPaw 运行环境下执行：
`ash
qwenpaw plugin install https://github.com/ysunyang979-sys/qwenpawR2/releases/download/v1.0.0/cloudflare-r2.zip
`
或直接从本地目录安装：
`ash
qwenpaw plugin install ./cloudflare-r2
`

---

## ⚙️ 配置说明

在 QwenPaw 的根目录 .env 或 ~/.qwenpaw/config.json 中配置你的 Cloudflare R2 凭证：

`ini
R2_ACCOUNT_ID=你的Cloudflare账户ID
R2_ACCESS_KEY_ID=你的R2访问密钥ID
R2_SECRET_ACCESS_KEY=你的R2秘密访问密钥
R2_BUCKET_NAME=你的存储桶名称
`
