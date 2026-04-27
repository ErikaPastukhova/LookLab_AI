# Leads → Google Sheets (Apps Script)

## 1) Создайте таблицу

Создайте Google Sheet и добавьте лист с названием: `Leads`.

Рекомендуемые колонки (первая строка заголовков):

- `created_at`
- `name`
- `contact`
- `store`
- `comment`
- `page_url`
- `user_agent`

> Технически заголовки не обязательны: скрипт использует `appendRow()` и просто добавляет строки в конец.

## 2) Добавьте Apps Script

Откройте таблицу → **Extensions → Apps Script** → вставьте содержимое файла `Code.gs`.

Файл в репозитории: `graduation_project_erika_dasha/google-apps-script/leads/Code.gs`.

## 3) Задеплойте как Web App

В Apps Script:

- **Deploy → New deployment**
- Type: **Web app**
- Execute as: **Me**
- Who has access: **Anyone**

Скопируйте URL вида:
`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`

## 4) Подключите URL на фронте

Вставьте URL в:

- `graduation_project_erika_dasha/request-form.js` → `APPS_SCRIPT_URL`

## 5) Проверка

- Откройте лендинг, заполните форму, нажмите «Отправить заявку».
- В Google Sheet должна появиться новая строка.

## Антиспам (что уже есть)

- **Honeypot**: скрытое поле `website` (если заполнено — заявка игнорируется).
- **Дедупликация 60 секунд**: если быстро отправить повторно с тем же `contact+store`, запись не дублируется.

