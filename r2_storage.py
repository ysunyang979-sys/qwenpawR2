# -*- coding: utf-8 -*-
"""Cloudflare R2 Storage Adapter for QwenPaw.

Provides unified file operations (list, read, write, delete, status)
against Cloudflare R2 buckets using S3 compatible protocol.
Automatically syncs credentials into os.environ, shell rc files,
and enables agent tools so AI can seamlessly operate R2.
"""

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False

logger = logging.getLogger(__name__)


@dataclass
class R2Config:
    account_id: str = ""
    access_key_id: str = ""
    secret_access_key: str = ""
    bucket_name: str = "recovery-fusebox"
    endpoint_url: str = ""
    token: str = ""

    @property
    def effective_endpoint(self) -> str:
        if self.endpoint_url:
            return self.endpoint_url
        if self.account_id:
            return f"https://{self.account_id}.r2.cloudflarestorage.com"
        return ""

    @property
    def has_s3_creds(self) -> bool:
        return bool(self.access_key_id and self.secret_access_key and (self.endpoint_url or self.account_id))


def sync_env_and_agents(cfg: R2Config) -> None:
    """Synchronize R2 S3 credentials into os.environ, ~/.bashrc, and agent configs."""
    if not cfg.has_s3_creds:
        return

    # 1. Inject into Python os.environ
    if cfg.account_id:
        os.environ["CF_ACCOUNT_ID"] = cfg.account_id
        os.environ["R2_ACCOUNT_ID"] = cfg.account_id
    if cfg.access_key_id:
        os.environ["AWS_ACCESS_KEY_ID"] = cfg.access_key_id
        os.environ["R2_ACCESS_KEY_ID"] = cfg.access_key_id
    if cfg.secret_access_key:
        os.environ["AWS_SECRET_ACCESS_KEY"] = cfg.secret_access_key
        os.environ["R2_SECRET_ACCESS_KEY"] = cfg.secret_access_key
    if cfg.bucket_name:
        os.environ["R2_BUCKET_NAME"] = cfg.bucket_name
    if cfg.effective_endpoint:
        os.environ["AWS_ENDPOINT_URL"] = cfg.effective_endpoint
        os.environ["AWS_ENDPOINT"] = cfg.effective_endpoint
        os.environ["R2_ENDPOINT_URL"] = cfg.effective_endpoint
    os.environ["AWS_DEFAULT_REGION"] = "auto"

    # 2. Write export lines to ~/.bashrc, ~/.profile, ~/.zshrc for Linux/Container shells
    lines = [
        f'export CF_ACCOUNT_ID="{cfg.account_id}"',
        f'export AWS_ACCESS_KEY_ID="{cfg.access_key_id}"',
        f'export AWS_SECRET_ACCESS_KEY="{cfg.secret_access_key}"',
        f'export AWS_ENDPOINT="{cfg.effective_endpoint}"',
        f'export AWS_ENDPOINT_URL="{cfg.effective_endpoint}"',
        f'export R2_BUCKET_NAME="{cfg.bucket_name}"',
        'export AWS_DEFAULT_REGION="auto"',
    ]
    block = "\n# --- Cloudflare R2 Credentials (auto-generated) ---\n" + "\n".join(lines) + "\n"
    for rc in [".bashrc", ".profile", ".zshrc"]:
        rc_path = Path.home() / rc
        try:
            text = rc_path.read_text(encoding="utf-8", errors="ignore") if rc_path.is_file() else ""
            if "AWS_SECRET_ACCESS_KEY" not in text or cfg.secret_access_key not in text:
                with open(rc_path, "a", encoding="utf-8") as f:
                    f.write(block)
        except Exception:
            pass

    # 3. Automatically enable R2 tools in all agent configurations
    workspaces_dir = Path.home() / ".qwenpaw" / "workspaces"
    if workspaces_dir.is_dir():
        r2_tools = ["upload_r2_file", "list_r2_files", "read_r2_file", "delete_r2_file", "get_r2_status"]
        for agent_file in workspaces_dir.glob("*/agent.json"):
            try:
                with open(agent_file, "r", encoding="utf-8") as f:
                    adata = json.load(f)
                b_tools = adata.setdefault("tools", {}).setdefault("builtin_tools", {})
                changed = False
                for t in r2_tools:
                    if t in b_tools:
                        if not b_tools[t].get("enabled"):
                            b_tools[t]["enabled"] = True
                            changed = True
                    else:
                        b_tools[t] = {
                            "name": t,
                            "enabled": True,
                            "description": "",
                            "display_to_user": True,
                            "async_execution": False,
                            "icon": "☁️",
                            "config": {}
                        }
                        changed = True
                if changed:
                    with open(agent_file, "w", encoding="utf-8") as f:
                        json.dump(adata, f, indent=2, ensure_ascii=False)
                    logger.info(f"Auto-enabled R2 tools in {agent_file}")
            except Exception as e:
                logger.debug(f"Failed enabling R2 tools in {agent_file}: {e}")


def load_config() -> R2Config:
    def _env(name: str, default: str = "") -> str:
        return os.environ.get(f"QWENPAW_{name}", os.environ.get(name, default)).strip()

    cfg = R2Config(
        account_id=_env("R2_ACCOUNT_ID"),
        access_key_id=_env("R2_ACCESS_KEY_ID"),
        secret_access_key=_env("R2_SECRET_ACCESS_KEY"),
        bucket_name=_env("R2_BUCKET_NAME", "recovery-fusebox"),
        endpoint_url=_env("R2_ENDPOINT_URL"),
        token=_env("R2_TOKEN", _env("CLOUDFLARE_API_TOKEN")),
    )

    try:
        cfg_path = Path.home() / ".qwenpaw" / "config.json"
        if cfg_path.is_file():
            with open(cfg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                r2_data = data.get("r2", {})
                if isinstance(r2_data, dict):
                    if not cfg.account_id:
                        cfg.account_id = str(r2_data.get("account_id", "")).strip()
                    if not cfg.access_key_id:
                        cfg.access_key_id = str(r2_data.get("access_key_id", "")).strip()
                    if not cfg.secret_access_key:
                        cfg.secret_access_key = str(r2_data.get("secret_access_key", "")).strip()
                    if not cfg.bucket_name or cfg.bucket_name == "recovery-fusebox":
                        cfg.bucket_name = str(r2_data.get("bucket_name", cfg.bucket_name)).strip()
                    if not cfg.endpoint_url:
                        cfg.endpoint_url = str(r2_data.get("endpoint_url", "")).strip()
                    if not cfg.token:
                        cfg.token = str(r2_data.get("token", "")).strip()
    except Exception as e:
        logger.debug("Failed reading ~/.qwenpaw/config.json: %s", e)

    sync_env_and_agents(cfg)
    return cfg


def save_config(new_cfg: Dict[str, Any]) -> None:
    cfg_dir = Path.home() / ".qwenpaw"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = cfg_dir / "config.json"
    data = {}
    if cfg_path.is_file():
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}

    data.setdefault("r2", {})
    for k in ["account_id", "access_key_id", "secret_access_key", "bucket_name", "endpoint_url"]:
        if k in new_cfg and new_cfg[k] is not None:
            data["r2"][k] = str(new_cfg[k]).strip()

    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


class R2Service:
    def __init__(self, config: Optional[R2Config] = None):
        self.config = config or load_config()
        self._s3_client = None

    def update_config(self, cfg_dict: Dict[str, Any]):
        save_config(cfg_dict)
        self.config = load_config()
        self._s3_client = None

    def _get_s3(self):
        if not HAS_BOTO3:
            raise RuntimeError("Python package 'boto3' is not installed.")
        if not self.config.has_s3_creds:
            raise ValueError("Cloudflare R2 S3 凭证未配置。请点击右上角「配置凭证」设置。")
        if self._s3_client is None:
            self._s3_client = boto3.client(
                "s3",
                endpoint_url=self.config.effective_endpoint,
                aws_access_key_id=self.config.access_key_id,
                aws_secret_access_key=self.config.secret_access_key,
                region_name="auto",
                config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
            )
        return self._s3_client

    def get_status(self) -> Dict[str, Any]:
        has_cfg = self.config.has_s3_creds
        res = {
            "configured": has_cfg,
            "connected": False,
            "bucket": self.config.bucket_name,
            "account_id": self.config.account_id,
            "endpoint": self.config.effective_endpoint,
            "error": None,
        }
        if not has_cfg:
            res["error"] = "Cloudflare R2 S3 凭证未配置，请点击右上角「配置凭证」设置。"
            return res

        try:
            s3 = self._get_s3()
            s3.head_bucket(Bucket=self.config.bucket_name)
            res["connected"] = True
            sync_env_and_agents(self.config)
        except Exception as e:
            res["error"] = f"连接失败: {str(e)}"
        return res

    def list_directory(self, path: str = "", limit: int = 100) -> Dict[str, Any]:
        s3 = self._get_s3()
        prefix = path.lstrip("/")
        if prefix and not prefix.endswith("/"):
            prefix += "/"

        resp = s3.list_objects_v2(
            Bucket=self.config.bucket_name,
            Prefix=prefix,
            Delimiter="/",
            MaxKeys=limit,
        )

        entries = []
        for cp in resp.get("CommonPrefixes", []):
            dir_prefix = cp.get("Prefix", "")
            name = dir_prefix.rstrip("/").split("/")[-1]
            entries.append({
                "name": name,
                "path": dir_prefix.rstrip("/"),
                "kind": "directory",
                "size": None,
                "modified_at": None,
            })

        for obj in resp.get("Contents", []):
            k = obj.get("Key", "")
            if k == prefix:
                continue
            name = k.split("/")[-1]
            entries.append({
                "name": name,
                "path": k,
                "kind": "file",
                "size": obj.get("Size", 0),
                "modified_at": obj.get("LastModified").isoformat() if obj.get("LastModified") else None,
            })

        return {"current_path": path, "entries": entries}

    def read_file_chunk(self, path: str, offset: int = 0, limit: int = 1024 * 1024) -> Dict[str, Any]:
        key = path.lstrip("/")
        s3 = self._get_s3()
        head = s3.head_object(Bucket=self.config.bucket_name, Key=key)
        total_size = head.get("ContentLength", 0)

        byte_range = f"bytes={offset}-{offset + limit - 1}"
        resp = s3.get_object(Bucket=self.config.bucket_name, Key=key, Range=byte_range)
        body = resp["Body"].read()
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            text = body.decode("latin-1", errors="replace")

        return {
            "path": path,
            "total_size": total_size,
            "offset": offset,
            "content": text,
        }

    def save_text_file(self, path: str, content: str) -> Dict[str, Any]:
        key = path.lstrip("/")
        s3 = self._get_s3()
        raw = content.encode("utf-8")
        s3.put_object(Bucket=self.config.bucket_name, Key=key, Body=raw, ContentType="text/plain; charset=utf-8")
        return {"path": path, "size": len(raw)}

    def delete_file(self, path: str) -> bool:
        key = path.lstrip("/")
        s3 = self._get_s3()
        s3.delete_object(Bucket=self.config.bucket_name, Key=key)
        return True


_INSTANCE = None

def get_service() -> R2Service:
    global _INSTANCE
    if _INSTANCE is None:
        _INSTANCE = R2Service()
    return _INSTANCE
