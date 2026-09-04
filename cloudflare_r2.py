# -*- coding: utf-8 -*-
"""Cloudflare R2 Tool & App Plugin Entry Point."""

import importlib.util
import logging
import os
from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
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
            description="Check connection status and configuration of Cloudflare R2 bucket",
            icon="⚡",
            enabled=True,
            tool_type="network",
        )

        api.register_tool(
            tool_name="list_r2_files",
            tool_func=tool.list_r2_files,
            description="List files and directories in Cloudflare R2 bucket with optional prefix path",
            icon="☁️",
            enabled=True,
            tool_type="network",
        )

        api.register_tool(
            tool_name="read_r2_file",
            tool_func=tool.read_r2_file,
            description="Read text content of a file from Cloudflare R2 cloud bucket",
            icon="📄",
            enabled=True,
            tool_type="network",
        )

        api.register_tool(
            tool_name="upload_r2_file",
            tool_func=tool.upload_r2_file,
            description="Upload text or content directly to a path in Cloudflare R2 bucket",
            icon="⬆️",
            enabled=True,
            tool_type="network",
        )

        api.register_tool(
            tool_name="delete_r2_file",
            tool_func=tool.delete_r2_file,
            description="Delete a file from Cloudflare R2 bucket",
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


plugin = CloudflareR2Plugin()
