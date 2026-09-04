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
    """Check Cloudflare R2 connection status and current bucket configuration."""
    try:
        service = _get_service()
        st = service.get_status()
        status_lines = [
            "=== Cloudflare R2 状态报告 ===",
            f"已配置凭证: {st.get('configured')}",
            f"云端联通: {st.get('connected')}",
            f"存储桶名: {st.get('bucket')}",
            f"账户 ID: {st.get('account_id')}",
        ]
        if st.get("error"):
            status_lines.append(f"详情/提示: {st.get('error')}")
        return _text_chunk("\n".join(status_lines))
    except Exception as exc:
        return _text_chunk(f"检查 R2 状态失败: {str(exc)}", success=False)


async def list_r2_files(prefix: str = "", limit: int = 50) -> ToolChunk:
    """List files and folders in Cloudflare R2 bucket.

    Args:
        prefix (str, optional): Folder path or prefix to list, e.g. "文档/" or "".
        limit (int, optional): Maximum items to return. Defaults to 50.
    """
    try:
        service = _get_service()
        res = service.list_directory(path=prefix, limit=limit)
        entries = res.get("entries", [])
        if not entries:
            return _text_chunk(f"Cloudflare R2 路径 '{prefix or '/'}' 下未找到任何文件。")
        
        lines = [f"=== Cloudflare R2 [{prefix or '/'}] 文件列表 (共 {len(entries)} 项) ==="]
        for e in entries:
            kind_mark = "[目录]" if e.get("kind") == "directory" else "[文件]"
            size_info = f" ({e.get('size')} 字节)" if e.get("size") is not None else ""
            lines.append(f"{kind_mark} {e.get('name')}{size_info} - 更新时间: {e.get('modified_at', '')}")
        return _text_chunk("\n".join(lines))
    except Exception as exc:
        return _text_chunk(f"列出 R2 文件失败: {str(exc)}", success=False)


async def read_r2_file(file_path: str, max_bytes: int = 50000) -> ToolChunk:
    """Read content of a text or code file from Cloudflare R2 bucket.

    Args:
        file_path (str): Relative path of the file in R2 (e.g. '文档/readme.txt').
        max_bytes (int, optional): Maximum bytes to read. Defaults to 50000.
    """
    try:
        service = _get_service()
        chunk = service.read_file_chunk(path=file_path, offset=0, limit=max_bytes)
        content = chunk.get("content", "")
        total_size = chunk.get("total_size", len(content))
        return _text_chunk(f"=== 文件: {file_path} (大小: {total_size} 字节) ===\n\n{content}")
    except Exception as exc:
        return _text_chunk(f"读取 R2 文件 '{file_path}' 失败: {str(exc)}", success=False)


async def upload_r2_file(file_path: str, content: str) -> ToolChunk:
    """Upload text or code content directly to Cloudflare R2 bucket.

    Args:
        file_path (str): Destination path in R2 bucket (e.g. '文档/notes.txt').
        content (str): Text content to write.
    """
    try:
        service = _get_service()
        res = service.save_text_file(path=file_path, content=content)
        return _text_chunk(f"✅ 文件成功上传至 Cloudflare R2: {file_path} (大小: {res.get('size')} 字节)")
    except Exception as exc:
        return _text_chunk(f"上传文件至 R2 失败: {str(exc)}", success=False)


async def delete_r2_file(file_path: str) -> ToolChunk:
    """Delete a file from Cloudflare R2 bucket.

    Args:
        file_path (str): Path of the file to delete in R2 bucket.
    """
    try:
        service = _get_service()
        ok = service.delete_file(path=file_path)
        if ok:
            return _text_chunk(f"✅ 成功从 Cloudflare R2 删除文件: {file_path}")
        return _text_chunk(f"删除失败: 文件未删除", success=False)
    except Exception as exc:
        return _text_chunk(f"删除 R2 文件失败: {str(exc)}", success=False)
