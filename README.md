# Graduation Project: AI Virtual Try-On

Проект содержит:
- статический frontend (`index.html`, `demo.html`, `VirtualTryOn/*`);
- backend на FastAPI для AI-примерки (`backend/*`).

## Быстрый запуск

### 1) Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example .env
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Проверка:
- `GET http://localhost:8000/health`
- `GET http://localhost:8000/api/v1/catalog/items`

### 2) Frontend

Запустите любой статический сервер из корня репозитория, например:

```bash
python3 -m http.server 5500
```

Откройте:
- `http://localhost:5500/index.html`
- `http://localhost:5500/VirtualTryOn/virtual-try-on.html`

## API виртуальной примерки

- `POST /api/v1/tryon/jobs` (`multipart/form-data`)
  - `garment_item_id`: `string`
  - `person_image`: `image/*`
- `GET /api/v1/tryon/jobs/{jobId}`
  - возвращает статус: `queued | running | done | failed`
  - при `done` содержит `resultImageUrl`

## Конфигурация AI провайдера

Через `.env`:
- `AI_PROVIDER=mock` — локальный mock-провайдер (по умолчанию);
- `AI_PROVIDER=http` — вызов внешнего AI endpoint.

Для HTTP-провайдера задайте:
- `AI_HTTP_ENDPOINT`
- `AI_HTTP_TOKEN` (опционально)
- `AI_HTTP_TIMEOUT_SECONDS`

### HTTP контракт для внешнего inference-сервиса (вариант 2)

При `AI_PROVIDER=http` backend отправляет `POST` на `AI_HTTP_ENDPOINT`:
- `multipart/form-data` файл `person_image`
- `multipart/form-data` файл `garment_image`
- form-поле `category` со значением: `tops | bottoms | one-pieces`

Маппинг категорий каталога в FASHN-формат:
- `top`, `outerwear` -> `tops`
- `bottom`, `skirt` -> `bottoms`
- `dress` -> `one-pieces`

Ожидаемый ответ inference-сервиса:
- тело ответа: сгенерированное изображение (`image/jpeg` или `image/png`)
- HTTP `200 OK`
- `Content-Type` должен быть установлен в тип изображения

## Хранение изображений

- `STORAGE_BACKEND=local`: файлы сохраняются в `backend/storage_data` и отдаются через `/storage/*`;
- `STORAGE_BACKEND=s3`: используется S3-совместимое хранилище с pre-signed URL.
