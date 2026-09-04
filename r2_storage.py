# -*- coding: utf-8 -*-
"""Cloudflare R2 Storage Adapter for QwenPaw.

Provides unified file operations (list, read, write, delete, status, local sync)
against Cloudflare R2 buckets using S3 compatible protocol.
Automatically syncs credentials into os.environ, shell rc files,
and enables agent tools so AI can seamlessly operate R2.
"""

import json
import logging
import mimetypes
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
    bucket_name: str = "mypaw"
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
        r2_tools = ["upload_r2_file", "sync_local_to_r2", "list_r2_files", "read_r2_file", "delete_r2_file", "get_r2_status"]
        for agent_file in workspaces_dir.glob("*/agent.json"):
            try:
                with open(agent_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                tools = data.get("tools", [])
                modified = False
                for t in r2_tools:
                    if t not in tools:
                        tools.append(t)
                        modified = True
                if modified:
                    data["tools"] = tools
                    with open(agent_file, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
            except Exception:
                pass


class R2Service:
    """Core R2 management operations."""

    def __init__(self):
        self.config_file = Path.home() / ".qwenpaw" / "cloudflare_r2_config.json"
        self.config = self._load_config()
        sync_env_and_agents(self.config)

    def _load_config(self) -> R2Config:
        account_id = os.environ.get("CF_ACCOUNT_ID", os.environ.get("R2_ACCOUNT_ID", "ac7f8382d9e3b89d84dcf5ed1d8054f9"))
        access_key = os.environ.get("AWS_ACCESS_KEY_ID", os.environ.get("R2_ACCESS_KEY_ID", ""))
        secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY", os.environ.get("R2_SECRET_ACCESS_KEY", ""))
        bucket = os.environ.get("R2_BUCKET_NAME", "mypaw")
        endpoint = os.environ.get("AWS_ENDPOINT_URL", os.environ.get("AWS_ENDPOINT", ""))

        if self.config_file.is_file():
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    account_id = data.get("account_id") or account_id
                    access_key = data.get("access_key_id") or access_key
                    secret_key = data.get("secret_access_key") or secret_key
                    bucket = data.get("bucket_name") or bucket
                    endpoint = data.get("endpoint_url") or endpoint
            except Exception as e:
                logger.warning(f"Failed to read R2 config file: {e}")

        return R2Config(
            account_id=account_id.strip(),
            access_key_id=access_key.strip(),
            secret_access_key=secret_key.strip(),
            bucket_name=bucket.strip(),
            endpoint_url=endpoint.strip(),
        )

    def update_config(self, updates: Dict[str, Any]) -> None:
        if "account_id" in updates:
            self.config.account_id = str(updates["account_id"]).strip()
        if "access_key_id" in updates:
            self.config.access_key_id = str(updates["access_key_id"]).strip()
        if "secret_access_key" in updates:
            self.config.secret_access_key = str(updates["secret_access_key"]).strip()
        if "bucket_name" in updates:
            self.config.bucket_name = str(updates["bucket_name"]).strip()
        if "endpoint_url" in updates:
            self.config.endpoint_url = str(updates["endpoint_url"]).strip()

        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_file, "w", encoding="utf-8") as f:
            json.dump({
                "account_id": self.config.account_id,
                "access_key_id": self.config.access_key_id,
                "secret_access_key": self.config.secret_access_key,
                "bucket_name": self.config.bucket_name,
                "endpoint_url": self.config.endpoint_url,
            }, f, indent=2)

        sync_env_and_agents(self.config)

    def _get_s3(self):
        if not HAS_BOTO3:
            raise RuntimeError("boto3 is not installed. Please install boto3.")
        if not self.config.has_s3_creds:
            raise ValueError(
                "Cloudflare R2 credentials not configured. Please set CF_ACCOUNT_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY."
            )
        endpoint = self.config.effective_endpoint
        return boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=self.config.access_key_id,
            aws_secret_access_key=self.config.secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )

    def get_status(self) -> Dict[str, Any]:
        configured = self.config.has_s3_creds
        connected = False
        error_msg = None

        if configured:
            try:
                s3 = self._get_s3()
                s3.head_bucket(Bucket=self.config.bucket_name)
                connected = True
            except Exception as e:
                error_msg = str(e)
        else:
            error_msg = "缺少 R2 凭证 (Account ID, Access Key 或 Secret Key)"

        return {
            "configured": configured,
            "connected": connected,
            "bucket": self.config.bucket_name,
            "account_id": self.config.account_id,
            "endpoint": self.config.effective_endpoint,
            "error": error_msg,
        }

    def list_directory(self, path: str = "", limit: int = 200) -> Dict[str, Any]:
        s3 = self._get_s3()
        prefix = path.lstrip("/")
        if prefix and not prefix.endswith("/"):
            prefix += "/"

        paginator = s3.get_paginator("list_objects_v2")
        page_iterator = paginator.paginate(
            Bucket=self.config.bucket_name,
            Prefix=prefix,
            Delimiter="/",
            PaginationConfig={"MaxItems": limit, "PageSize": limit},
        )

        entries = []
        for page in page_iterator:
            for cp in page.get("CommonPrefixes", []):
                dir_prefix = cp.get("Prefix", "")
                dir_name = dir_prefix.rstrip("/").split("/")[-1]
                entries.append({
                    "name": dir_name,
                    "path": dir_prefix.rstrip("/"),
                    "kind": "directory",
                    "size": None,
                    "modified_at": None,
                })

            for obj in page.get("Contents", []):
                key = obj.get("Key", "")
                if key.endswith("/") and key == prefix:
                    continue
                file_name = key.split("/")[-1]
                if not file_name:
                    continue
                mtime = obj.get("LastModified")
                entries.append({
                    "name": file_name,
                    "path": key,
                    "kind": "file",
                    "size": obj.get("Size", 0),
                    "modified_at": mtime.isoformat() if mtime else None,
                    "etag": obj.get("ETag", "").strip('"'),
                })

        return {
            "path": path,
            "entries": entries,
            "total": len(entries),
        }

    def read_file_chunk(self, path: str, offset: int = 0, limit: int = 50000) -> Dict[str, Any]:
        key = path.lstrip("/")
        s3 = self._get_s3()
        resp = s3.get_object(Bucket=self.config.bucket_name, Key=key)
        total_size = resp.get("ContentLength", 0)
        body = resp["Body"].read()

        try:
            text = body[offset: offset + limit].decode("utf-8")
        except UnicodeDecodeError:
            text = body[offset: offset + limit].decode("utf-8", errors="replace")

        return {
            "path": path,
            "total_size": total_size,
            "content": text,
        }

    def save_text_file(self, path: str, content: str) -> Dict[str, Any]:
        key = path.lstrip("/")
        s3 = self._get_s3()
        raw = content.encode("utf-8")
        content_type, _ = mimetypes.guess_type(key)
        if not content_type:
            if key.endswith((".md", ".markdown")):
                content_type = "text/markdown; charset=utf-8"
            elif key.endswith((".json", ".js")):
                content_type = "application/json; charset=utf-8"
            else:
                content_type = "text/plain; charset=utf-8"
        s3.put_object(Bucket=self.config.bucket_name, Key=key, Body=raw, ContentType=content_type)
        return {"path": path, "size": len(raw)}

    def find_local_file(self, filename: str) -> Optional[Path]:
        """Search for a local file in workspace, /tmp, or current directory."""
        raw_p = Path(filename)
        if raw_p.is_file():
            return raw_p

        # Check /tmp
        tmp_p = Path("/tmp") / filename
        if tmp_p.is_file():
            return tmp_p

        # Check current working directory
        cwd_p = Path.cwd() / filename
        if cwd_p.is_file():
            return cwd_p

        base_name = Path(filename).name

        # Check ~/.qwenpaw/workspaces/
        ws_root = Path.home() / ".qwenpaw" / "workspaces"
        if ws_root.is_dir():
            for f in ws_root.glob(f"**/{base_name}"):
                if f.is_file():
                    return f

        # Check /run/csi/mount-root
        csi_root = Path("/run/csi/mount-root")
        if csi_root.is_dir():
            for f in csi_root.glob(f"**/{base_name}"):
                if f.is_file():
                    return f

        return None

    def upload_local_file(self, local_path: str, r2_path: str = "") -> Dict[str, Any]:
        """Read local file and upload to R2 bucket."""
        target = self.find_local_file(local_path)
        if not target or not target.is_file():
            raise FileNotFoundError(f"本地文件未找到: {local_path}")

        raw = target.read_bytes()
        dest_key = (r2_path or target.name).lstrip("/")
        s3 = self._get_s3()
        content_type, _ = mimetypes.guess_type(dest_key)
        if not content_type:
            content_type = "text/markdown; charset=utf-8" if dest_key.endswith(".md") else "text/plain; charset=utf-8"
        s3.put_object(Bucket=self.config.bucket_name, Key=dest_key, Body=raw, ContentType=content_type)
        return {"path": dest_key, "size": len(raw), "local_path": str(target)}

    def list_local_workspace_files(self) -> List[Dict[str, Any]]:
        """List local files available in current workspace for easy sync."""
        results = []
        candidates = []
        ws_root = Path.home() / ".qwenpaw" / "workspaces"
        if ws_root.is_dir():
            candidates.extend(ws_root.glob("**/*"))
        csi_root = Path("/run/csi/mount-root")
        if csi_root.is_dir():
            candidates.extend(csi_root.glob("**/*"))
        cwd_p = Path.cwd()
        candidates.extend(cwd_p.glob("*"))

        seen_names = set()
        for p in candidates:
            if p.is_file() and not p.name.startswith("."):
                ext = p.suffix.lower()
                if ext in [".md", ".txt", ".json", ".py", ".js", ".html", ".log", ".yaml", ".yml", ".csv"]:
                    if p.name not in seen_names:
                        seen_names.add(p.name)
                        try:
                            st = p.stat()
                            results.append({
                                "name": p.name,
                                "local_path": str(p),
                                "size": st.st_size,
                            })
                        except Exception:
                            pass
        return results[:30]

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
