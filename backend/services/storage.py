from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import boto3

from backend.services.config import Settings


@dataclass
class StoredObject:
    key: str
    url: str


class StorageService:
    def save_bytes(self, *, directory: str, data: bytes, content_type: str) -> StoredObject:
        raise NotImplementedError


class LocalStorageService(StorageService):
    def __init__(self, settings: Settings):
        self._settings = settings
        self._base_dir = Path(settings.storage_local_dir)
        self._base_dir.mkdir(parents=True, exist_ok=True)

    def save_bytes(self, *, directory: str, data: bytes, content_type: str) -> StoredObject:
        suffix = mimetypes.guess_extension(content_type or "") or ".bin"
        filename = f"{uuid4().hex}{suffix}"
        rel_path = Path(directory) / filename
        abs_path = self._base_dir / rel_path
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(data)

        base_url = self._settings.app_base_url.rstrip("/")
        mount = self._settings.storage_local_mount.rstrip("/")
        url = f"{base_url}{mount}/{rel_path.as_posix()}"
        return StoredObject(key=rel_path.as_posix(), url=url)


class S3StorageService(StorageService):
    def __init__(self, settings: Settings):
        self._settings = settings
        self._bucket = settings.s3_bucket
        self._client = boto3.client(
            "s3",
            region_name=settings.s3_region or None,
            aws_access_key_id=settings.s3_access_key_id or None,
            aws_secret_access_key=settings.s3_secret_access_key or None,
            endpoint_url=settings.s3_endpoint_url or None,
        )

    def save_bytes(self, *, directory: str, data: bytes, content_type: str) -> StoredObject:
        suffix = mimetypes.guess_extension(content_type or "") or ".bin"
        key = f"{directory}/{uuid4().hex}{suffix}"
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type or "application/octet-stream",
        )
        url = self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=self._settings.s3_url_ttl_seconds,
        )
        return StoredObject(key=key, url=url)


def build_storage(settings: Settings) -> StorageService:
    if settings.storage_backend == "s3":
        return S3StorageService(settings)
    return LocalStorageService(settings)
