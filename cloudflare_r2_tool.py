# -*- coding: utf-8 -*-
"""Cloudflare R2 Tool Implementation for QwenPaw Agent."""

import logging
from agentscope.message import TextBlock, ToolResultState
from agentscope.tool import ToolChunk

logger = logging.getLogger(__name__)


def _text_chunk(text: str, success: bool = True) -> ToolChunk:
    return ToolChunk(
        is_last=True,
        state=ToolResultState.SUCCESS if success else ToolResultState.ERROR,
        content=[TextBlock(type="text", text=text)],
    )


def _get_service():
    import importlib.util
    import os
    plugin_dir = os.path.dirname(os.path.abspath(__file__))
    r2_storage_path = os.path.join(plugin_dir, "r2_storage.py")
    spec = importlib.util.spec_from_file_location("r2_storage", r2_storage_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.get_service()


async def get_r2_status() -> ToolChunk:
    """查询 Cloudflare R2 云端存储桶连接状态与配置信息 (Check R2 bucket status and credentials)."""
    try:
        service = _get_service()
        st = service.get_status()
        status_lines = [
            "=== Cloudflare R2 状态 ===",
            f"配置就绪: {st.get('configured')}",
            f"连通正常: {st.get('connected')}",
            f"存储桶名: {st.get('bucket')}",
            f"账户 ID: {st.get('account_id')}",
        ]
        if st.get("error"):
            status_lines.append(f"提示信息: {st.get('error')}")
        return _text_chunk("\n".join(status_lines))
    except Exception as exc:
        return _text_chunk(f"检查 R2 状态失败: {str(exc)}", success=False)


async def list_r2_files(prefix: str = "", limit: int = 50) -> ToolChunk:
    """列出 Cloudflare R2 云端存储桶中的文件与目录列表 (List files and folders in Cloudflare R2 bucket).

    Args:
        prefix (str, optional): 筛选目录前缀路径，例如 'docs/' 或留空查看根目录。
        limit (int, optional): 最大返回项数，默认为 50。
    """
    try:
        service = _get_service()
        res = service.list_directory(path=prefix, limit=limit)
        entries = res.get("entries", [])
        if not entries:
            return _text_chunk(f"Cloudflare R2 目录 '{prefix or '/'}' 下暂无文件。")

        lines = [f"=== Cloudflare R2 [{prefix or '/'}] 文件列表 (共 {len(entries)} 项) ==="]
        for e in entries:
            kind_mark = "[目录]" if e.get("kind") == "directory" else "[文件]"
            size_info = f" ({e.get('size')} 字节)" if e.get("size") is not None else ""
            lines.append(f"{kind_mark} {e.get('name')}{size_info} - 更新时间: {e.get('modified_at', '')}")
        return _text_chunk("\n".join(lines))
    except Exception as exc:
        return _text_chunk(f"列出 R2 文件失败: {str(exc)}", success=False)


async def read_r2_file(file_path: str, max_bytes: int = 50000) -> ToolChunk:
    """读取 Cloudflare R2 云端存储桶中文件的文本内容 (Read file content from Cloudflare R2 bucket).

    Args:
        file_path (str): R2 存储桶中的文件相对路径（例如 'note.txt' 或 'docs/readme.md'）。
        max_bytes (int, optional): 最大读取字节数，默认为 50000。
    """
    try:
        service = _get_service()
        chunk = service.read_file_chunk(path=file_path, offset=0, limit=max_bytes)
        content = chunk.get("content", "")
        total_size = chunk.get("total_size", len(content))
        return _text_chunk(f"=== 文件: {file_path} (大小: {total_size} 字节) ===\n\n{content}")
    except Exception as exc:
        return _text_chunk(f"读取 R2 文件 '{file_path}' 失败: {str(exc)}", success=False)


async def upload_r2_file(file_path: str, content: str = "", local_file_path: str = "") -> ToolChunk:
    """【核心文件创建与上传工具】在用户的 Cloudflare R2 云端存储空间中创建、写入或上传文件。

    ⚠️ 极其重要：当用户在对话中提到在'存储空间'、'云存储'、'R2'、'网盘'中【创建文件】、【写一个文件】、【存一个文件】、【保存文件】、【上传文件】时，
    必须且只能调用此工具直接存入 R2！严禁调用本地的 write_file 或创建文件工具！
    如果调用了本地工具，文件只会留在本地容器磁盘，无法在用户的「R2 云端文件」界面中显示！

    Args:
        file_path (str): R2 存储空间中的目标文件名或路径（如 'note.txt' 或 'docs/readme.md'）。
        content (str, optional): 要写入文件的文本、Markdown 或代码内容。
        local_file_path (str, optional): 本地工作区已有文件的路径（如 'note.txt'），传入时自动上传该本地文件。
    """
    try:
        service = _get_service()
        bucket = service.config.bucket_name
        # 1. Direct content write
        if content:
            res = service.save_text_file(path=file_path, content=content)
            return _text_chunk(
                f"✅ 文件已成功创建并保存到 Cloudflare R2 云端存储空间！\n"
                f"- 存储桶: {bucket}\n"
                f"- 文件路径: {file_path}\n"
                f"- 文件大小: {res.get('size')} 字节\n"
                f"在左侧导航栏的「R2 云端文件」页面中已实时显示并可随时在线查看与编辑。"
            )

        # 2. Local file upload / sync
        target_local = local_file_path or file_path
        local_found = service.find_local_file(target_local)
        if local_found:
            res = service.upload_local_file(local_path=str(local_found), r2_path=file_path)
            return _text_chunk(
                f"✅ 已从本地同步并上传到 Cloudflare R2 云端存储空间！\n"
                f"- 存储桶: {bucket}\n"
                f"- 文件路径: {res.get('path')}\n"
                f"- 文件大小: {res.get('size')} 字节\n"
                f"现在打开「R2 云端文件」界面即可立即查看该文件。"
            )

        # 3. If content empty and file not found, write empty file
        res = service.save_text_file(path=file_path, content="")
        return _text_chunk(f"✅ 已在 Cloudflare R2 存储桶 ({bucket}) 中创建空文件: {file_path}")
    except Exception as exc:
        return _text_chunk(f"在 R2 存储空间创建/上传文件失败: {str(exc)}", success=False)


async def sync_local_to_r2(file_path: str, r2_path: str = "") -> ToolChunk:
    """将本地工作区中已有的文件（例如之前在本地创建的 note.txt）同步上传到 Cloudflare R2 云端存储空间。

    当用户询问“刚刚写的文件为什么在 R2 没显示”或要求“把本地文件存入 R2”时，调用此工具即可将本地文件一键推送到 R2！

    Args:
        file_path (str): 本地文件名或路径（例如 'note.txt' 或 '/tmp/note.txt'）。
        r2_path (str, optional): R2 目标路径。若为空则保持相同文件名。
    """
    try:
        service = _get_service()
        bucket = service.config.bucket_name
        res = service.upload_local_file(local_path=file_path, r2_path=r2_path)
        dest = res.get("path")
        return _text_chunk(
            f"✅ 本地文件 '{file_path}' 已成功同步上传至 Cloudflare R2 存储桶 ({bucket})！\n"
            f"- R2 路径: {dest}\n"
            f"- 文件大小: {res.get('size')} 字节\n"
            f"用户在「R2 云端文件」界面中刷新即可立即看到此文件。"
        )
    except Exception as exc:
        return _text_chunk(f"同步本地文件到 R2 失败: {str(exc)}", success=False)


async def delete_r2_file(file_path: str) -> ToolChunk:
    """从 Cloudflare R2 云端存储桶中删除指定文件 (Delete a file from Cloudflare R2 bucket).

    Args:
        file_path (str): 要删除的文件路径（例如 'note.txt'）。
    """
    try:
        service = _get_service()
        ok = service.delete_file(path=file_path)
        if ok:
            return _text_chunk(f"✅ 已成功从 Cloudflare R2 存储桶中删除文件: {file_path}")
        return _text_chunk(f"删除失败: 文件未能删除", success=False)
    except Exception as exc:
        return _text_chunk(f"删除 R2 文件失败: {str(exc)}", success=False)
