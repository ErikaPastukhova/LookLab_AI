# RUNBOOK: graduation_project_erika_dasha (Yandex Cloud)

Этот документ — “операционный паспорт” проекта для агента/инженера, который впервые видит репозиторий и текущий деплой в Yandex Cloud.  
Цель: быстро понять **что где лежит**, **как это связано**, **как подключаться**, **как безопасно менять/обновлять/перезапускать**.

> Важно: ниже **нет секретов** (токенов/паролей). Секреты/ENV упоминаются только по месту хранения и назначению.

## 1) Что это за проект (кратко)

Проект состоит из:
- **Статического фронтенда** (landing + страницы демо) — отдается из **Yandex Object Storage** как сайт.
- **Virtual Try-On фронта** (`frontend/VirtualTryOn/*`) — тоже статический, лежит в Object Storage.
- **Backend API (FastAPI)** — крутится на VM `om-backend` и принимает запросы от фронта через **API Gateway**.
- **GPU inference VM** (`gpu-vm`) — отдельная GPU VM под `fashn-vton-1.5` (сейчас в облаке VM остановлена). Ее старт/стоп автоматизируется **Cloud Functions**.

Высокоуровневая схема:

1. Пользователь открывает сайт из `Object Storage` (бакет `onlinemannequin`).
2. Frontend вызывает API Gateway `om-gate`:
   - `GET /api/v1/catalog/items` → проксируется на backend VM.
   - `POST /api/v1/tryon/jobs` → проксируется на backend VM.
3. Backend при необходимости дергает “ensure running” endpoint, который через API Gateway вызывает Cloud Function и (best-effort) запускает GPU VM.
4. Результаты и входные изображения лежат в Object Storage (бакет `onlinemanequine-media`), а каталог одежды — в `onlinemannequin` (`catalog/catalog.json`).

## 2) Структура репозитория (что где лежит)

Корень репозитория содержит несколько папок, но **основной “продуктовый” репозиторий** — `graduation_project_erika_dasha/`.

Внутри `graduation_project_erika_dasha/`:
- **`README.md`**: описание проекта, локальный запуск, описание API.
- **`frontend/`**: весь статический фронтенд (landing + demo + VirtualTryOn + `ui/*` + ассеты).
  - landing/demo страницы: `frontend/index.html`, `frontend/try.html`, `frontend/demo.html`
  - стили/скрипты: `frontend/landing.css`, `frontend/style.css`, `frontend/script.js`, `frontend/request-form.js`, `frontend/ui/*`
  - Virtual Try-On: `frontend/VirtualTryOn/*`
  - 3D модели: `frontend/assets/models/*`
- **`backend/`**: FastAPI backend.
  - `backend/main.py`: создание `FastAPI`, подключение роутеров, CORS, (опционально) static mount для локального storage.
  - `backend/api/*`: HTTP-эндпоинты.
  - `backend/services/*`: конфиг, storage (local/s3), каталог, провайдер AI и т.п.
  - `backend/.env.example`: шаблон переменных окружения.
  - `backend/requirements.txt`: зависимости.
- **`cloud-functions/`**: функции для управления GPU VM.
  - `cloud-functions/om-ensure-running/index.py`: “ensure running” (старт GPU VM + health probe).
  - `cloud-functions/om-gpu-stop/index.py`: “idle stop” (останов GPU VM при простое).
- **`om-gate-openapi.yaml`**: спецификация API Gateway (OpenAPI с `x-yc-apigateway-integration`).
- **`google-apps-script/`**: скрипт для лид-формы → Google Sheets.

## 3) Инвентаризация Yandex Cloud (как сейчас развернуто)

### 3.1 Организация / Cloud / Folder

`yc config list` показывает:
- **cloud**: `cloud-daryohas` (`cloud-id: b1g3l59nh3tmnvhilj74`)
- **folder**: `default` (`folder-id: b1gmkcue20ntomp1f117`)
- зона по умолчанию: `ru-central1-a`

> Все команды ниже предполагают этот `folder-id`, если не указано иначе.

### 3.2 Compute Instances (VM)

#### Backend VM
- **name**: `om-backend`
- **status**: RUNNING
- **private IP**: `10.128.0.14`
- **public NAT IP**: `111.88.254.136`
- **OS**: Ubuntu 24.04.4 LTS (по диску/фактам на VM)

#### GPU VM
- **name**: `gpu-vm`
- **platform**: `standard-v3-t4i`
- **gpus**: 1
- **private IP**: `10.128.0.20`
- **status**: может быть `RUNNING` или `STOPPED` (по необходимости)
- **public NAT IP**: отключен (инференс используется по приватному IP из VPC)

Важно:
- Включать NAT для `gpu-vm` не требуется. Это снижает риск упереться в квоту/лимиты на создание external IP при старте.

### 3.3 API Gateway

- **name**: `om-gate`
- **domain**: `d5dnmn8hm7jc5rsrfis2.nkhmighe.apigw.yandexcloud.net`
- **spec**: соответствует `graduation_project_erika_dasha/om-gate-openapi.yaml`

Ключевые маршруты (важно для отладки):
- `POST /gpu/ensure_running` → Cloud Function `om-ensure-running`
- `GET /api/v1/catalog/items` → `http://10.128.0.14:8000/api/v1/catalog/items`
- `POST /api/v1/tryon/jobs` → `http://10.128.0.14:8000/api/v1/tryon/jobs`
- `GET /api/v1/tryon/jobs/{job_id}` → `http://10.128.0.14:8000/api/v1/tryon/jobs/{job_id}`

### 3.4 Cloud Functions

В папке есть 2 функции:
- `om-ensure-running` (invoke URL вида `https://functions.yandexcloud.net/<id>`)
- `om-gpu-stop`

Назначение:
- `om-ensure-running`: при вызове пытается стартовать GPU VM через Compute API и проверяет `GPU_HEALTH_URL`.
- `om-gpu-stop`: по маркеру “последней активности” (`control/last_seen.json` в примонтированном бакете) определяет простои и останавливает GPU VM.

Таймер авто-остановки:
- Trigger `gpu-stop-timer` (cron `0/1 * * * ? *`) вызывает `om-gpu-stop`.
- Таймаут простоя задается в env функции `om-gpu-stop`: `IDLE_TIMEOUT_SEC` (сейчас 900 секунд = 15 минут).

### 3.5 Object Storage (бакеты и ключи)

#### Бакет “сайт + каталог”
- **bucket**: `onlinemannequin`
- в корне лежат: `index.html`, `landing.css`, `landing.js`, `script.js`, `style.css`, `demo.html`, `try.html`, `.glb` модели
- **VirtualTryOn**: `VirtualTryOn/virtual-try-on.html`, `VirtualTryOn/virtualTryOn.js`, `VirtualTryOn/virtualTryOn.css`, и т.д.
- **каталог одежды**: `catalog/catalog.json`
- **картинки одежды**: `catalog/garments/*`

#### Бакет “медиа try-on”
- **bucket**: `onlinemanequine-media`
- ключи (префиксы): `inputs/`, `outputs/`, `control/`
  - `inputs/person/*` — загруженные фото
  - `outputs/results/*` — результаты
  - `control/last_seen.json` — маркер активности для авт-остановки GPU VM (используется функциями)

### 3.6 Сеть / Security Group

- VPC: `default`
- subnet: `default-ru-central1-a` (и другие зоны)
- security group по умолчанию: `default-sg-*` с:
  - **INGRESS ANY 0.0.0.0/0**
  - **EGRESS ANY 0.0.0.0/0**

> Это максимально открытая конфигурация. Для продакшна обычно ограничивают порты/источники, но менять ничего не требуется, если задача — “держать как есть”.

### 3.7 Managed сервисы / LB

На момент инвентаризации:
- Network LB: нет
- Application LB: нет
- Managed PostgreSQL / Redis: нет

## 4) Как работать с `yc` (CLI) — минимум для агента

### 4.1 Проверить, что CLI настроен

```bash
yc --version
yc config profile list
yc config list
```

Ожидается что в конфиге видны `cloud-id` и `folder-id`.

### 4.2 Базовые команды “посмотреть что есть”

```bash
# VM
yc compute instance list --folder-id b1gmkcue20ntomp1f117
yc compute instance get --name om-backend --folder-id b1gmkcue20ntomp1f117

# Functions
yc serverless function list --folder-id b1gmkcue20ntomp1f117

# API Gateway
yc serverless api-gateway list --folder-id b1gmkcue20ntomp1f117
yc serverless api-gateway get-spec om-gate --folder-id b1gmkcue20ntomp1f117

# Object Storage buckets
yc storage bucket list

# Список объектов в бакете (через s3api)
yc storage s3api list-objects --bucket onlinemannequin --delimiter / --max-keys 1000
yc storage s3api list-objects --bucket onlinemannequin --prefix catalog/ --max-keys 1000
```

### 4.3 Как выгрузить/залить объект в Object Storage

```bash
# Скачать объект в stdout (например, посмотреть каталог)
yc storage s3api get-object --bucket onlinemannequin --key catalog/catalog.json --body /tmp/catalog.json

# Загрузить файл (обновить каталог/фронт) — ОСТОРОЖНО: это перезапишет объект по ключу
yc storage s3api put-object --bucket onlinemannequin --key catalog/catalog.json --body ./catalog.json
```

> Для сайта обычно загружают сразу набор статических файлов (index.html/css/js/VirtualTryOn/*).  
> Это можно делать тем же `put-object`, либо отдельным инструментом (например, `aws s3 sync`), но в рамках текущего контура достаточно `yc storage s3api put-object`.

## 5) Что лежит на backend VM и как туда подключаться

### 5.1 SSH доступ

Backend VM: `111.88.254.136`

Рабочий способ (проверено): **SSH пользователем `ubuntu`** с ключом `~/.ssh/id_ed25519`:

```bash
ssh ubuntu@111.88.254.136
```

Если надо явно указать ключ:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@111.88.254.136
```

### 5.2 Что запущено на VM (факты)

- Сервис backend слушает **порт 8000** на всех интерфейсах: `0.0.0.0:8000`.
- Backend запущен как systemd service: **`om-backend.service`**.
- Процесс: `uvicorn backend.main:app ...`

### 5.3 Где лежит backend код и конфиг на VM

На VM есть пользователь `daryohas` (под ним крутится сервис).

Основное:
- Код backend: **`/home/daryohas/backend/`**
- Virtualenv: **`/home/daryohas/venvs/backend/`**
- ENV файл для systemd: **`/home/daryohas/backend/.env`**
- Локальное хранилище (если `STORAGE_BACKEND=local`): **`/home/daryohas/backend/storage_data/`**

### 5.4 Команды для диагностики на VM

```bash
# Проверить локально health
curl -sS http://127.0.0.1:8000/health

# Посмотреть слушающие порты
ss -lntp | sed -n '1,120p'

# Статус сервиса
sudo systemctl status om-backend --no-pager -l

# Логи (последние строки)
sudo journalctl -u om-backend -n 200 --no-pager

# Логи в реальном времени
sudo journalctl -u om-backend -f
```

## 6) Как “менять/обновлять/перезапускать” (runbook)

Ниже перечислены типовые операции. Они **меняют состояние**, поэтому выполнять их только когда действительно нужно.

### 6.0 Полный выкат (фронт + бэкенд)

Один скрипт из репозитория проекта (нужны `yc` и `ssh` с доступом к VM):

```bash
git submodule update --init --recursive
bash graduation_project_erika_dasha/scripts/deploy_yandex.sh
```

Скрипт: [scripts/deploy_yandex.sh](../scripts/deploy_yandex.sh) — по очереди вызывает выкат статики в бакет (см. [deploy_bucket_static.sh](../scripts/deploy_bucket_static.sh)) и доставку `backend/` на VM `om-backend` с `pip install` и `systemctl restart om-backend`.

Переменные окружения: `BUCKET` (по умолчанию `onlinemannequin`), `OM_BACKEND_SSH` (по умолчанию `ubuntu@111.88.254.136`), `OM_SSH_IDENTITY` (опционально путь к ключу), `DRY_RUN=1` (только печать шагов). Флаги: `--frontend-only` (только бакет), `--backend-only` (только VM).

### 6.1 Перезапуск backend

На VM:

```bash
sudo systemctl restart om-backend
sudo systemctl status om-backend --no-pager -l
```

### 6.2 Изменить конфиг backend (ENV)

Файл: `/home/daryohas/backend/.env`

Паттерн:
1) аккуратно правим `.env` (не ломаем формат)
2) перезапускаем сервис:

```bash
sudo systemctl restart om-backend
```

Подсказка по возможным ключам — в репозитории `backend/.env.example`.

### 6.3 Обновить backend код на VM

Код лежит в `/home/daryohas/backend/`. Способ обновления зависит от того, как вы доставляете код (git pull/копирование/CI).  
Минимальный безопасный алгоритм:

1) доставить новый код в `/home/daryohas/backend/`
2) при изменении зависимостей — обновить venv:

```bash
sudo -u daryohas /home/daryohas/venvs/backend/bin/pip install -r /home/daryohas/backend/requirements.txt
```

3) рестарт:

```bash
sudo systemctl restart om-backend
```

### 6.4 Обновить каталог одежды

Каталог в Object Storage:
- bucket: `onlinemannequin`
- key: `catalog/catalog.json`

Обновление:
1) залить новый `catalog.json`:

```bash
yc storage s3api put-object --bucket onlinemannequin --key catalog/catalog.json --body ./catalog.json
```

2) **перезапустить backend**, потому что он грузит каталог при старте:

```bash
ssh ubuntu@111.88.254.136 'sudo systemctl restart om-backend'
```

### 6.5 Обновить фронтенд (статический сайт)

Фронт лежит в бакете `onlinemannequin` (в корне + `VirtualTryOn/*` + `ui/*`).

**Рекомендуемый способ:** скрипт из репозитория проекта (после актуального checkout подмодуля / клона):

```bash
# из корня монорепозитория, если `graduation_project_erika_dasha` — подмодуль:
git submodule update --init --recursive
bash graduation_project_erika_dasha/scripts/deploy_bucket_static.sh
```

Скрипт: [scripts/deploy_bucket_static.sh](../scripts/deploy_bucket_static.sh) — заливает полный набор статики (включая `request-form.js`), выставляет **`Content-Type`** (`text/html`, `text/css`, `application/javascript` с `charset=utf-8`), чтобы браузер не предлагал «сохранить страницу» вместо отображения. Ключи в бакете с префиксом **`catalog/`** (корневой каталог одежды) скрипт **не трогает**; путь `VirtualTryOn/catalog/categories.js` разрешён.

Ручная заливка одного файла (при необходимости задайте `--content-type`):

```bash
yc storage s3api put-object --bucket onlinemannequin --key index.html --body ./index.html --content-type "text/html; charset=utf-8"
```

### 6.6 GPU VM старт/стоп (ручной контроль)

Через `yc`:

```bash
yc compute instance start --name gpu-vm --folder-id b1gmkcue20ntomp1f117
yc compute instance stop  --name gpu-vm --folder-id b1gmkcue20ntomp1f117
yc compute instance get   --name gpu-vm --folder-id b1gmkcue20ntomp1f117
```

Через API Gateway (логика “ensure running”):
- `POST https://<om-gate-domain>/gpu/ensure_running`

> В текущей реализации это дергает Cloud Function, которая делает best-effort старт и отдает `200` (ready) или `202` (starting/not-ready).

Если GPU VM “не стартует” и зависает в `starting`:
- проверьте статус `gpu-vm`: `yc compute instance get --name gpu-vm ...`
- проверьте, что у `gpu-vm` выключен one-to-one NAT (иначе старт может упираться в лимиты на создание external IP):

```bash
yc compute instance remove-one-to-one-nat --name gpu-vm --network-interface-index 0 --folder-id b1gmkcue20ntomp1f117
```

### 6.7 Обновить API Gateway spec

Файл в репозитории: `om-gate-openapi.yaml`.  
Проверка текущей спеки в облаке:

```bash
yc serverless api-gateway get-spec om-gate --folder-id b1gmkcue20ntomp1f117
```

Применение новой спеки — это уже изменение инфраструктуры. Делать только если точно нужно (команда зависит от ваших прав и желаемого процесса деплоя).

## 7) Быстрая шпаргалка: “если что-то сломалось”

- **Не открывается сайт**:
  - проверить, что нужные файлы реально лежат в бакете `onlinemannequin` (и что bucket настроен как website, если используете website endpoint)
  - проверить, что `index.html` обновлен и браузер не держит кеш

- **API не отвечает**:
  - проверить `om-backend`:
    - `ssh ubuntu@111.88.254.136`
    - `curl http://127.0.0.1:8000/health`
    - `sudo systemctl status om-backend`
    - `sudo journalctl -u om-backend -n 200 --no-pager`
  - проверить API Gateway spec (`yc serverless api-gateway get-spec ...`) и что прокси идет на `10.128.0.14:8000`

- **Каталог пустой/ошибка каталога**:
  - проверить наличие `catalog/catalog.json` в `onlinemannequin`
  - проверить, что backend настроен на S3 чтение (ENV `CATALOG_BUCKET`, `CATALOG_OBJECT_KEY`, плюс `STORAGE_BACKEND=s3` и S3 креды/endpoint если используется boto3)
  - перезапустить backend после обновления каталога

- **Try-on не генерируется**:
  - проверить, что GPU VM стартует (вручную `yc compute instance start --name gpu-vm ...`)
  - проверить, что endpoint `GPU_HEALTH_URL` (на стороне Cloud Function) доступен и возвращает ожидаемый payload
  - посмотреть входные/выходные объекты в `onlinemanequine-media` (`inputs/`, `outputs/`)

