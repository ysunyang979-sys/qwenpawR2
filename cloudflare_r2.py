# -*- coding: utf-8 -*-
"""Cloudflare R2 Tool Plugin Entry Point."""

import importlib.util
import logging
import os

from qwenpaw.plugins.api import PluginApi

logger = logging.getLogger(__name__)

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_tool_module():
    """Load cloudflare_r2_tool.py from plugin directory via importlib."""
    tool_path = os.path.join(_PLUGIN_DIR, "cloudflare_r2_tool.py")
    spec = importlib.util.spec_from_file_location("cloudflare_r2_tool", tool_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CloudflareR2ToolPlugin:
    """Cloudflare R2 Tool Plugin for QwenPaw Agent."""

    def register(self, api: PluginApi):
        """Register R2 cloud storage tools into Agent toolkit."""
        tool = _load_tool_module()

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


# Export plugin instance
plugin = CloudflareR2ToolPlugin()
