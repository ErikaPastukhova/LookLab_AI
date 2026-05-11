from __future__ import annotations

import json

import httpx

from backend.models.schemas import CatalogItem
from backend.services.config import Settings
from backend.services.storage import StorageService


class CatalogService:
    def __init__(self, settings: Settings, storage: StorageService):
        self._settings = settings
        self._storage = storage
        self._items = self._load_items()

    def get_items(self) -> list[CatalogItem]:
        return self._items

    def get_item_by_id(self, item_id: str) -> CatalogItem | None:
        return next((item for item in self._items if item.id == item_id), None)

    def _load_items(self) -> list[CatalogItem]:
        bucket = (self._settings.catalog_bucket or "").strip()
        key = (self._settings.catalog_object_key or "").strip()
        base = (self._settings.catalog_http_base_url or "").strip().rstrip("/")

        if not key:
            raise RuntimeError(
                "Catalog is not configured. Set CATALOG_OBJECT_KEY (e.g. catalog/catalog.json)."
            )

        # In production we typically use S3-backed storage for both media and catalog.
        # For local dev we often keep media in local filesystem, while catalog lives in public Object Storage.
        if self._settings.storage_backend == "s3":
            if not bucket:
                raise RuntimeError(
                    "Catalog is not configured for S3. Set CATALOG_BUCKET and CATALOG_OBJECT_KEY."
                )
            raw = self._storage.read_bytes(key=key, bucket=bucket)
            source_label = f"s3://{bucket}/{key}"
        else:
            if base:
                url = f"{base}/{key}"
            else:
                if not bucket:
                    raise RuntimeError(
                        "Catalog is not configured. Set CATALOG_BUCKET and CATALOG_OBJECT_KEY, "
                        "or set CATALOG_HTTP_BASE_URL (e.g. https://www.looklab-ai.ru) together with "
                        "CATALOG_OBJECT_KEY to fetch the catalog from a public HTTPS site."
                    )
                url = f"https://storage.yandexcloud.net/{bucket}/{key}"
            source_label = url
            try:
                with httpx.Client(timeout=20, follow_redirects=True, trust_env=False) as client:
                    resp = client.get(url)
                    resp.raise_for_status()
                    raw = resp.content
            except Exception as exc:  # noqa: BLE001 - surface context to ops
                raise RuntimeError(f"Failed to fetch catalog via HTTP: {url}") from exc

        if not raw:
            raise RuntimeError(f"Catalog is empty or missing: {source_label}")

        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - surface context to ops
            raise RuntimeError(f"Failed to parse catalog JSON: {source_label}") from exc

        items_raw = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items_raw, list) or not items_raw:
            raise RuntimeError(f"Catalog JSON has no items: {source_label}")

        items: list[CatalogItem] = []
        for it in items_raw:
            items.append(CatalogItem.model_validate(it))
        return items
