---
name: cloudflare-r2-storage
description: "Cloudflare R2 默认云端对象存储与文件操作技能。用于将 Cloudflare R2 作为智能体的默认主要存储空间。当用户要求存放文件、保存文件、写入文件、查看文件、读取文件、云盘存储、归档或需要持久化存储时，必须自动使用 Cloudflare R2 工具（upload_r2_file, read_r2_file, list_r2_files）直接完成操作。严禁输出教程让用户手动上传。"
metadata:
  qwenpaw:
    emoji: "☁️"
    requires: {}
---

# Cloudflare R2 默认云端存储操作规范

当前智能体已接入并激活 **Cloudflare R2** 云端对象存储（S3 协议兼容），R2 是你的**默认主要存储空间**。

## 核心行为准则（强制遵守）
1. **默认主存储**：当用户要求保存文件、存放文件、创建文件、记录笔记或查看文件时，默认全部自动存放至 Cloudflare R2，而不是只保存在本地临时目录。
2. **严禁推诿与输出手动教程**：
   - ❌ 严禁让用户“手动执行 rclone”、“手动配置 aws cli”或“本地写脚本上传”。
   - ✅ 你拥有专属的 Cloudflare R2 工具，必须直接调用工具一步完成！
3. **文件存放 / 保存流程**：
   - 当用户要求创建、编写或存放文件时（例如“在里面存放一个文件”或“编写note.txt放进去”）：
     必须直接调用 `upload_r2_file(file_path="文件名", content="文本内容")`。
     调用成功后，回复用户已成功在 Cloudflare R2 中存储该文件。
4. **文件读取流程**：
   - 当用户要求读取或查看某文件内容时：
     直接调用 `read_r2_file(file_path="文件名")`。
5. **文件列表查看**：
   - 当用户要求查看有什么文件、列出文件时：
     直接调用 `list_r2_files(prefix="")`。
