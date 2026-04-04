from backend.models.schemas import CatalogItem
from backend.services.config import Settings


class CatalogService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._items = self._build_mock_items()

    def get_items(self) -> list[CatalogItem]:
        return self._items

    def get_item_by_id(self, item_id: str) -> CatalogItem | None:
        return next((item for item in self._items if item.id == item_id), None)

    def _build_mock_items(self) -> list[CatalogItem]:
        # Demo garment images. In production this should point to product assets from CMS/catalog.
        return [
            CatalogItem(
                id="black-jacket-01",
                name="Черная куртка",
                category="outerwear",
                categoryLabel="Куртка",
                color="#111827",
                garmentImageUrl="https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/black_jacket.jpg",
            ),
            CatalogItem(
                id="black-top-01",
                name="Черный топ",
                category="top",
                categoryLabel="Топ",
                color="#111827",
                garmentImageUrl="https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/black_top.jpg",
            ),
            CatalogItem(
                id="green-pullover-01",
                name="Зеленый пуловер",
                category="top",
                categoryLabel="Пуловер",
                color="#166534",
                garmentImageUrl="https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/green_pullover.jpg",
            ),
            CatalogItem(
                id="grey-pullover-01",
                name="Серый пуловер",
                category="top",
                categoryLabel="Пуловер",
                color="#6b7280",
                garmentImageUrl="https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/grey_pullover.jpg",
            ),
            CatalogItem(
                id="white-jacket-01",
                name="Белая куртка",
                category="outerwear",
                categoryLabel="Куртка",
                color="#e5e7eb",
                garmentImageUrl="https://storage.yandexcloud.net/onlinemannequin/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%B2%D0%B5%D1%89%D0%B5%D0%B9/white_jacket.jpg",
            ),
        ]
