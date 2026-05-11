# Graduation Project: AI Virtual Try-On

Проект содержит:
- статический frontend (`index.html`, `demo.html`, `VirtualTryOn/*`);
- backend на FastAPI для AI-примерки (`backend/*`).

## Деплой статики в Yandex Object Storage

Из корня этого репозитория (после `git submodule update --init --recursive`, если вы клонировали проект как подмодуль в монорепозитории):

```bash
bash scripts/deploy_bucket_static.sh
```

Скрипт заливает нужные HTML/CSS/JS в прод-бакет **`www.looklab-ai.ru`** с корректными `Content-Type` и не трогает корневой префикс `catalog/` в бакете. Другой бакет: `BUCKET=… bash scripts/deploy_bucket_static.sh`. Полный операционный контекст — [docs/RUNBOOK_YANDEX_CLOUD.md](docs/RUNBOOK_YANDEX_CLOUD.md) (раздел 6.5).

Полный выкат **фронта и бэкенда** на Yandex Cloud: `bash scripts/deploy_yandex.sh` (см. runbook, раздел 6.0).

## Сбор заявок (форма на лендинге) → Google Sheets

На лендинге в `index.html` есть форма «Оставить заявку». Для сохранения заявок в Google Sheets используйте Google Apps Script Web App.

Инструкция и готовый шаблон скрипта:
- `google-apps-script/leads/SETUP.md`
- `google-apps-script/leads/Code.gs`

После деплоя Apps Script вставьте URL Web App в `request-form.js` (переменная `APPS_SCRIPT_URL`).

## Быстрый запуск

### Один скрипт (туннель + backend + frontend)

Запуск из директории `graduation_project_erika_dasha/`:

```bash
bash scripts/run_local.sh
```

Скрипт поднимет:
- SSH-туннель до cloud inference (`localhost:8001 -> 10.128.0.20:8001` через `om-backend`);
- backend на `http://localhost:8000`;
- frontend на `http://localhost:<порт>/VirtualTryOn/virtual-try-on.html` (порт выбирается автоматически).

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

Запустите любой статический сервер из директории `frontend/`, например:

```bash
cd frontend
python3 -m http.server 5500
```

Откройте:
- `http://localhost:5500/index.html`
- `http://localhost:5500/VirtualTryOn/virtual-try-on.html`

При открытии на `localhost` VirtualTryOn по умолчанию обращается к локальному backend: `http://localhost:8000/api/v1`.

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

### Локальный запуск с cloud inference (через SSH tunnel)

В облаке inference-сервис доступен по внутреннему адресу VPC (например `10.128.0.20:8001`), поэтому с ноутбука напрямую он обычно недоступен.
Для локального backend используйте SSH-туннель через VM `om-backend`:

```bash
ssh -L 8001:10.128.0.20:8001 ubuntu@111.88.254.136
```

После этого в локальном `.env` укажите:
- `AI_HTTP_ENDPOINT=http://127.0.0.1:8001/infer`

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

## Каталог одежды

Backend загружает `catalog.json` при старте: при `STORAGE_BACKEND=s3` — из S3 по `CATALOG_BUCKET` / `CATALOG_OBJECT_KEY`; при **локальном** `STORAGE_BACKEND=local` — по **HTTPS** (публичный Object Storage или ваш сайт).

### Настройки (ENV)

- `CATALOG_OBJECT_KEY`: ключ к JSON (по умолчанию `catalog/catalog.json`), обязателен.
- `CATALOG_BUCKET`: имя бакета для **path-style** URL Yandex (`https://storage.yandexcloud.net/{bucket}/{key}`). В шаблоне [`.env.example`](graduation_project_erika_dasha/backend/.env.example) по умолчанию задан бакет **`www.looklab-ai.ru`**; для старого бакета укажите, например, `onlinemannequin`.
- `CATALOG_HTTP_BASE_URL`: опционально, **корень сайта** без завершающего `/` (например `https://www.looklab-ai.ru`). Если задан при `STORAGE_BACKEND=local`, каталог запрашивается как `{CATALOG_HTTP_BASE_URL}/{CATALOG_OBJECT_KEY}`; `CATALOG_BUCKET` для этой загрузки не используется.

После обновления `catalog.json` в хранилище требуется рестарт backend.

### Формат `catalog.json`

Файл должен содержать объект с полем `items` — массивом вещей:

```json
{
  "items": [
    {
      "id": "black-top-01",
      "name": "Черный топ",
      "category": "top",
      "categoryLabel": "Топ",
      "color": "#111827",
      "garmentImageUrl": "https://www.looklab-ai.ru/catalog/garments/black_top.jpg"
    }
  ]
}
```

### Как добавить новую вещь

1) Загрузите изображение одежды в бакет (пример ключа): `catalog/garments/my_new_item.jpg`.
2) Отредактируйте `catalog/catalog.json` и добавьте новую запись в `items[]`.
   - `id` должен быть уникальным.
   - `garmentImageUrl` должен быть публично доступным URL (в текущей реализации backend скачивает изображение по URL).
3) Перезапустите backend (на VM `om-backend`):
   - если systemd: `sudo systemctl restart <service>`
   - если docker compose: `docker compose restart <service>`
