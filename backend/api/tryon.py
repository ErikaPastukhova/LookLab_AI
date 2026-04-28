from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from PIL import Image, ImageDraw

from backend.models.schemas import TryOnJobCreateResponse, TryOnJobStatus, TryOnJobStatusResponse

router = APIRouter()


@dataclass
class JobRecord:
    status: TryOnJobStatus
    result_image_url: str | None = None
    error: str | None = None


JOBS: dict[str, JobRecord] = {}
JOBS_LOCK = asyncio.Lock()


def _map_catalog_category_to_fashn(category: str) -> str:
    c = (category or "").strip().lower()
    mapped = {
        # Canonical categories (legacy / generic).
        "top": "tops",
        "outerwear": "tops",
        "bottom": "bottoms",
        "skirt": "bottoms",
        "dress": "one-pieces",
        # Catalog categories used by this project.
        "tees_tops": "tops",
        "shirts": "tops",
        "sweaters": "tops",
        "pants": "bottoms",
        "skirts": "bottoms",
        "dresses": "one-pieces",
    }
    return mapped.get(c, "tops")


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    c = (hex_color or "").strip().lstrip("#")
    if len(c) != 6:
        return (64, 99, 235)
    try:
        return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))
    except ValueError:
        return (64, 99, 235)


def _build_fallback_garment_image(item_name: str, item_color: str) -> tuple[bytes, str]:
    width, height = 512, 768
    base = _hex_to_rgb(item_color)
    img = Image.new("RGBA", (width, height), (*base, 235))
    draw = ImageDraw.Draw(img)

    # Subtle card-like frame and text for visual debugging.
    draw.rectangle((8, 8, width - 8, height - 8), outline=(255, 255, 255, 120), width=4)
    draw.rectangle((30, 30, width - 30, height // 4), fill=(255, 255, 255, 35))
    draw.text((44, 48), item_name[:28], fill=(255, 255, 255, 220))

    output = io.BytesIO()
    img.save(output, format="PNG")
    return output.getvalue(), "image/png"


@router.post("/jobs", response_model=TryOnJobCreateResponse)
async def create_tryon_job(
    request: Request,
    garment_item_id: str = Form(...),
    person_image: UploadFile = File(...),
) -> TryOnJobCreateResponse:
    settings = request.app.state.settings
    catalog_service = request.app.state.catalog_service
    storage = request.app.state.storage
    ai_provider = request.app.state.ai_provider

    if not person_image.content_type or not person_image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="person_image must be an image file")

    person_bytes = await person_image.read()
    max_bytes = settings.tryon_max_upload_mb * 1024 * 1024
    if len(person_bytes) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"person_image is too large. Max {settings.tryon_max_upload_mb}MB",
        )

    catalog_item = catalog_service.get_item_by_id(garment_item_id)
    if not catalog_item:
        raise HTTPException(status_code=404, detail="garment item not found")

    person_object = storage.save_bytes(
        directory="inputs/person",
        data=person_bytes,
        content_type=person_image.content_type,
    )

    job_id = uuid4().hex
    async with JOBS_LOCK:
        JOBS[job_id] = JobRecord(status=TryOnJobStatus.queued)

    async def process_job() -> None:
        try:
            async with JOBS_LOCK:
                JOBS[job_id].status = TryOnJobStatus.running

            async with httpx.AsyncClient(timeout=60) as client:
                try:
                    garment_resp = await client.get(str(catalog_item.garmentImageUrl))
                    garment_resp.raise_for_status()
                    garment_bytes = garment_resp.content
                    garment_content_type = garment_resp.headers.get("content-type", "image/png")
                except Exception:
                    garment_bytes, garment_content_type = _build_fallback_garment_image(
                        catalog_item.name,
                        catalog_item.color,
                    )

            result_bytes, result_content_type = await ai_provider.generate_tryon(
                person_image_bytes=person_bytes,
                person_content_type=person_image.content_type,
                garment_image_bytes=garment_bytes,
                garment_content_type=garment_content_type,
                garment_category=_map_catalog_category_to_fashn(catalog_item.category),
            )
            result_object = storage.save_bytes(
                directory="outputs/results",
                data=result_bytes,
                content_type=result_content_type,
            )
            async with JOBS_LOCK:
                JOBS[job_id].status = TryOnJobStatus.done
                JOBS[job_id].result_image_url = result_object.url
        except Exception as exc:
            async with JOBS_LOCK:
                JOBS[job_id].status = TryOnJobStatus.failed
                JOBS[job_id].error = str(exc)

    asyncio.create_task(process_job())
    _ = person_object  # kept for observability and future metadata linking
    return TryOnJobCreateResponse(jobId=job_id, status=TryOnJobStatus.queued)


@router.get("/jobs/{job_id}", response_model=TryOnJobStatusResponse)
async def get_tryon_job(job_id: str) -> TryOnJobStatusResponse:
    async with JOBS_LOCK:
        record = JOBS.get(job_id)
        if not record:
            raise HTTPException(status_code=404, detail="job not found")
        return TryOnJobStatusResponse(
            jobId=job_id,
            status=record.status,
            resultImageUrl=record.result_image_url,
            error=record.error,
        )
