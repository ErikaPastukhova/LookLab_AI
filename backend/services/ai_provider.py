from __future__ import annotations

import asyncio
import io
import time

import httpx
from PIL import Image, ImageEnhance, ImageOps

from backend.services.config import Settings


class AIProvider:
    async def generate_tryon(
        self,
        *,
        person_image_bytes: bytes,
        person_content_type: str,
        garment_image_bytes: bytes,
        garment_content_type: str,
        garment_category: str,
    ) -> tuple[bytes, str]:
        raise NotImplementedError


class MockAIProvider(AIProvider):
    async def generate_tryon(
        self,
        *,
        person_image_bytes: bytes,
        person_content_type: str,
        garment_image_bytes: bytes,
        garment_content_type: str,
        garment_category: str,
    ) -> tuple[bytes, str]:
        _ = garment_category
        person = Image.open(io.BytesIO(person_image_bytes)).convert("RGB")
        garment = Image.open(io.BytesIO(garment_image_bytes)).convert("RGBA")

        # Demo: fit garment image to upper body area with soft blending.
        garment = ImageOps.contain(
            garment,
            (max(64, person.width // 2), max(64, person.height // 2)),
            method=Image.Resampling.LANCZOS,
        )
        alpha = garment.split()[-1]
        alpha = ImageEnhance.Brightness(alpha).enhance(0.38)
        garment.putalpha(alpha)

        result = person.convert("RGBA")
        offset_x = (person.width - garment.width) // 2
        offset_y = int(person.height * 0.22)
        result.alpha_composite(garment, (offset_x, offset_y))

        out = io.BytesIO()
        result.convert("RGB").save(out, format="JPEG", quality=92)
        return out.getvalue(), "image/jpeg"


class HttpAIProvider(AIProvider):
    def __init__(self, settings: Settings):
        self._endpoint = settings.ai_http_endpoint
        self._token = settings.ai_http_token
        self._timeout = settings.ai_http_timeout_seconds
        self._ensure_running_url = settings.ai_ensure_running_url
        self._ensure_poll_seconds = settings.ai_ensure_poll_seconds
        self._ensure_max_wait_seconds = settings.ai_ensure_max_wait_seconds

    async def _wait_gpu_ready(self, client: httpx.AsyncClient, headers: dict[str, str]) -> None:
        if not self._ensure_running_url:
            return

        deadline = time.monotonic() + max(1, self._ensure_max_wait_seconds)
        poll_interval = max(1, self._ensure_poll_seconds)
        last_status = "unknown"
        while time.monotonic() < deadline:
            response = await client.post(self._ensure_running_url, headers=headers)
            if response.status_code >= 400:
                response.raise_for_status()

            payload = {}
            try:
                payload = response.json()
            except Exception:
                payload = {}
            if isinstance(payload, dict):
                last_status = str(payload.get("status", last_status))
                if payload.get("ready") is True:
                    return
            if response.status_code == 200:
                return
            await asyncio.sleep(poll_interval)

        raise RuntimeError(f"GPU is not ready for inference (last status: {last_status}).")

    async def generate_tryon(
        self,
        *,
        person_image_bytes: bytes,
        person_content_type: str,
        garment_image_bytes: bytes,
        garment_content_type: str,
        garment_category: str,
    ) -> tuple[bytes, str]:
        if not self._endpoint:
            raise RuntimeError("AI_HTTP_ENDPOINT is not configured.")

        headers = {}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            await self._wait_gpu_ready(client, headers)
            response = await client.post(
                self._endpoint,
                headers=headers,
                data={"category": garment_category},
                files={
                    "person_image": ("person", person_image_bytes, person_content_type),
                    "garment_image": ("garment", garment_image_bytes, garment_content_type),
                },
            )
            response.raise_for_status()
            content_type = response.headers.get("content-type", "image/jpeg")
            return response.content, content_type


def build_ai_provider(settings: Settings) -> AIProvider:
    if settings.ai_provider == "http":
        return HttpAIProvider(settings)
    return MockAIProvider()
