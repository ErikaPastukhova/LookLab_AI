from fastapi import APIRouter, Request

from backend.models.schemas import CatalogItemsResponse

router = APIRouter()


@router.get("/items", response_model=CatalogItemsResponse)
async def get_catalog_items(request: Request) -> CatalogItemsResponse:
    catalog_service = request.app.state.catalog_service
    return CatalogItemsResponse(items=catalog_service.get_items())
