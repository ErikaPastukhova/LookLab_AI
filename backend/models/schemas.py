from enum import Enum

from pydantic import BaseModel, HttpUrl


class CatalogItem(BaseModel):
    id: str
    name: str
    category: str
    categoryLabel: str
    color: str
    garmentImageUrl: HttpUrl


class CatalogItemsResponse(BaseModel):
    items: list[CatalogItem]


class TryOnJobStatus(str, Enum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class TryOnJobCreateResponse(BaseModel):
    jobId: str
    status: TryOnJobStatus


class TryOnJobStatusResponse(BaseModel):
    jobId: str
    status: TryOnJobStatus
    resultImageUrl: HttpUrl | None = None
    error: str | None = None
