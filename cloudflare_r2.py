# -*- coding: utf-8 -*-
"""Cloudflare R2 Tool & App Plugin Entry Point."""

import importlib.util
import logging
import os
from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException, Query
from qwenpaw.plugins.api import PluginApi

logger = logging.getLogger(__name__)

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_tool_module():
    tool_path = os.path.join(_PLUGIN_DIR, "cloudflare_r2_tool.py")
    spec = importlib.util.spec_from_file_location("cloudflare_r2_tool", tool_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_storage_module():
    storage_path = os.path.join(_PLUGIN_DIR, "r2_storage.py")
    spec = importlib.util.spec_from_file_location("r2_storage", storage_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Create the HTTP Router for the visual Web App
r2_router = APIRouter()


@r2_router.get("/status")
async def api_get_status():
    storage = _load_storage_module()
    return storage.get_service().get_status()


@r2_router.post("/config")
async def api_save_config(body: Dict[str, Any] = Body(...)):
    storage = _load_storage_module()
    storage.get_service().update_config(body)
    return storage.get_service().get_status()


@r2_router.get("/tree")
async def api_list_tree(path: str = Query("", description="Folder prefix")):
    storage = _load_storage_module()
    try:
        return storage.get_service().list_directory(path=path, limit=200)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@r2_router.get("/read")
async def api_read_file(path: str = Query(..., description="File path")):
    storage = _load_storage_module()
    try:
        return storage.get_service().read_file_chunk(path=path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@r2_router.post("/upload")
async def api_upload_text(body: Dict[str, Any] = Body(...)):
    path = body.get("path")
    content = body.get("content", "")
    if not path:
        raise HTTPException(status_code=400, detail="Missing path")
    storage = _load_storage_module()
    try:
        return storage.get_service().save_text_file(path=path, content=content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@r2_router.post("/sync-local")
async def api_sync_local(body: Dict[str, Any] = Body(...)):
    local_path = body.get("local_path")
    r2_path = body.get("r2_path", "")
    if not local_path:
        raise HTTPException(status_code=400, detail="Missing local_path")
    storage = _load_storage_module()
    try:
        return storage.get_service().upload_local_file(local_path=local_path, r2_path=r2_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@r2_router.get("/local-files")
async def api_list_local_files():
    storage = _load_storage_module()
    try:
        return storage.get_service().list_local_workspace_files()
    except Exception as e:
        return []


@r2_router.delete("/delete")
async def api_delete_file(path: str = Query(..., description="File path to delete")):
    storage = _load_storage_module()
    try:
        ok = storage.get_service().delete_file(path=path)
        return {"success": ok, "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class CloudflareR2Plugin:
    """Cloudflare R2 App & Tool Plugin for QwenPaw."""

    def register(self, api: PluginApi):
        tool = _load_tool_module()

        # 1. Register Agent Tools (Auto-Enabled)
        api.register_tool(
            tool_name="get_r2_status",
            tool_func=tool.get_r2_status,
            description="查询 Cloudflare R2 存储桶连通状态与配置 (Check R2 bucket status)",
            icon="⚡",
            enabled=True,
            tool_type="network",
        )

        api.register_tool(
            tool_name="list_r2_files",
            tool_func=tool.list_r2_files,
            description="列出 Cloudflare R2 存储桶中的文件与目录列表 (List files and directories in R2)",
            icon="☁️",
            enabled=True,
            tool_type="network",
        )

        api.register_tool(
            tool_name="read_r2_file",
            tool_func=tool.read_r2_file,
            description="读取 Cloudflare R2 存储桶中文件的文本内容 (Read file content from R2)",
            icon="📄",
            enabled=True,
            tool_type="network",
        )

        api.register_tool(
            tool_name="upload_r2_file",
            tool_func=tool.upload_r2_file,
            description="【核心】在 Cloudflare R2 云端存储空间中创建、写入、保存或上传文件。当用户指示在'存储空间'、'R2'、'云端'中【创建/存放/保存/写入/新建】文件时，必须调用本工具直接存入 R2，不要使用本地工作区文件工具！",
            icon="⬆️",
            enabled=True,
            tool_type="network",
        )

        api.register_tool(
            tool_name="sync_local_to_r2",
            tool_func=tool.sync_local_to_r2,
            description="将本地工作区中已有的文件（例如刚刚创建在本地的 note.txt）同步上传到 Cloudflare R2 云端存储空间",
            icon="🔄",
            enabled=True,
            tool_type="network",
        )

        api.register_tool(
            tool_name="delete_r2_file",
            tool_func=tool.delete_r2_file,
            description="从 Cloudflare R2 存储桶中删除指定文件 (Delete a file from R2)",
            icon="🗑️",
            enabled=True,
            tool_type="network",
        )

        # 2. Register HTTP Router for Visual UI
        try:
            api.register_http_router(r2_router, prefix="/r2", tags=["cloudflare-r2"])
            logger.info("Cloudflare R2 HTTP router registered under /api/r2")
        except Exception as e:
            logger.warning(f"Failed to register R2 HTTP router: {e}")


# Export plugin instance for QwenPaw PluginLoader
plugin = CloudflareR2Plugin()
app = plugin
