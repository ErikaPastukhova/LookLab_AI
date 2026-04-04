from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.api.catalog import router as catalog_router
from backend.api.tryon import router as tryon_router
from backend.services.ai_provider import build_ai_provider
from backend.services.catalog_service import CatalogService
from backend.services.config import get_settings
from backend.services.storage import build_storage


def create_app() -> FastAPI:
    settings = get_settings()
    storage = build_storage(settings)
    catalog_service = CatalogService(settings=settings)
    ai_provider = build_ai_provider(settings)

    app = FastAPI(title="Virtual Try-On API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )

    app.state.settings = settings
    app.state.storage = storage
    app.state.catalog_service = catalog_service
    app.state.ai_provider = ai_provider

    @app.get("/health")
    async def healthcheck() -> dict[str, str]:
        return {"status": "ok"}

    if settings.storage_backend == "local":
        app.mount(
            settings.storage_local_mount,
            StaticFiles(directory=settings.storage_local_dir),
            name="storage",
        )

    app.include_router(catalog_router, prefix="/api/v1/catalog", tags=["catalog"])
    app.include_router(tryon_router, prefix="/api/v1/tryon", tags=["tryon"])
    return app


app = create_app()
