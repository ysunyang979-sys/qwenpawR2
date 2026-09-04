# -*- coding: utf-8 -*-
"""Self-contained Cloudflare R2 Storage Client for QwenPaw Plugin."""

import json
import logging
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False
    Config = None
    ClientError = Exception


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
        configured = bool(self.config.has_s3_creds)
        res = {
            "configured": configured,
            "connected": False,
            "bucket": self.config.bucket_name,
            "account_id": self.config.account_id,
            "error": None,
        }
        if not configured:
            res["error"] = "未配置 R2 S3 凭证，请点击右上角「配置凭证」进行设置。"
            return res

        try:
            s3 = self._get_s3()
            s3.head_bucket(Bucket=self.config.bucket_name)
            res["connected"] = True
            return res
        except Exception as e:
            res["error"] = str(e)
            return res

    def list_directory(self, path: str = "", limit: int = 200) -> Dict[str, Any]:
        prefix = path.strip("/")
        if prefix and not prefix.endswith("/"):
            prefix += "/"

        s3 = self._get_s3()
        resp = s3.list_objects_v2(
            Bucket=self.config.bucket_name,
            Prefix=prefix,
            Delimiter="/",
            MaxKeys=min(limit, 1000),
        )

        entries = []
        for p in resp.get("CommonPrefixes", []):
            dir_prefix = p.get("Prefix", "")
            dir_name = dir_prefix.rstrip("/").split("/")[-1]
            entries.append({
                "name": dir_name,
                "path": dir_prefix.rstrip("/"),
                "kind": "directory",
                "size": None,
                "modified_at": datetime.now(timezone.utc).isoformat(),
            })

        for obj in resp.get("Contents", []):
            key = obj.get("Key", "")
            if key == prefix:
                continue
            name = key.split("/")[-1]
            entries.append({
                "name": name,
                "path": key,
                "kind": "file",
                "size": obj.get("Size", 0),
                "modified_at": obj.get("LastModified", datetime.now(timezone.utc)).isoformat(),
            })

        return {"directory": path, "entries": entries}

    def read_file_chunk(self, path: str, offset: int = 0, limit: int = 100000) -> Dict[str, Any]:
        key = path.lstrip("/")
        s3 = self._get_s3()
        range_header = f"bytes={offset}-{offset + limit - 1}"
        try:
            resp = s3.get_object(Bucket=self.config.bucket_name, Key=key, Range=range_header)
            content_bytes = resp["Body"].read()
            total_size = resp.get("ContentRange", "").split("/")[-1]
        except Exception:
            resp = s3.get_object(Bucket=self.config.bucket_name, Key=key)
            content_bytes = resp["Body"].read()[offset:offset + limit]
            total_size = resp.get("ContentLength", len(content_bytes))

        try:
            content_str = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content_str = f"[二进制或媒体文件，大小: {len(content_bytes)} 字节]"

        return {
            "path": path,
            "content": content_str,
            "total_size": int(total_size) if str(total_size).isdigit() else len(content_bytes),
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
