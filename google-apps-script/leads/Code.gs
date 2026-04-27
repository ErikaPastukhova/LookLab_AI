/**
 * Google Apps Script Web App для приёма заявок с лендинга и записи в Google Sheets.
 *
 * Как использовать:
 * - Откройте Google Sheet → Extensions → Apps Script
 * - Вставьте этот файл как Code.gs
 * - Убедитесь, что в таблице есть лист с названием SHEET_NAME
 * - Deploy → New deployment → Type: Web app → Execute as: Me → Who has access: Anyone
 * - Вставьте URL деплоя в graduation_project_erika_dasha/request-form.js (APPS_SCRIPT_URL)
 */

const SHEET_NAME = 'Leads';
const MAX_FIELD_LEN = 2000;
const DEDUPE_TTL_SECONDS = 60; // защита от повторной отправки "на двойной клик"

function doGet() {
  return json_({ ok: true, service: 'leads', sheet: SHEET_NAME, now: new Date().toISOString() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    const body = parseBody_(e);

    const honeypot = safeStr_(body.honeypot);
    if (honeypot) {
      // Молча отвечаем ok, но не пишем в таблицу.
      return json_({ ok: true });
    }

    const name = required_(safeStr_(body.name), 'name');
    const contact = required_(safeStr_(body.contact), 'contact');
    const store = required_(safeStr_(body.store), 'store');
    const comment = safeStr_(body.comment);
    const pageUrl = safeStr_(body.pageUrl);
    const userAgent = safeStr_(body.userAgent);

    enforceLen_(name, 'name');
    enforceLen_(contact, 'contact');
    enforceLen_(store, 'store');
    enforceLen_(comment, 'comment');
    enforceLen_(pageUrl, 'pageUrl');
    enforceLen_(userAgent, 'userAgent');

    // Дедупликация на короткое окно (например, двойной клик).
    // IP недоступен в Apps Script Web App, поэтому используем "контакт + магазин" как ключ.
    const dedupeKey = `lead:${hash_(contact + '|' + store)}`;
    const cache = CacheService.getScriptCache();
    if (cache.get(dedupeKey)) {
      return json_({ ok: true, deduped: true });
    }
    cache.put(dedupeKey, '1', DEDUPE_TTL_SECONDS);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      return json_({ ok: false, error: `Sheet '${SHEET_NAME}' not found.` }, 500);
    }

    // Колонки:
    // created_at, name, contact, store, comment, page_url, user_agent
    sheet.appendRow([
      new Date().toISOString(),
      name,
      contact,
      store,
      comment,
      pageUrl,
      userAgent,
    ]);

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) }, 400);
  } finally {
    lock.releaseLock();
  }
}

function parseBody_(e) {
  const contentType = (e && e.postData && e.postData.type) ? String(e.postData.type) : '';

  // В Apps Script form-urlencoded и multipart часто уже распарсены в e.parameter,
  // поэтому если параметры присутствуют — используем их в приоритете.
  if (e && e.parameter && Object.keys(e.parameter).length > 0) {
    return e.parameter;
  }

  // JSON POST (application/json)
  if (contentType.includes('application/json')) {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!raw) throw new Error('Empty body');
    try {
      return JSON.parse(raw);
    } catch (err) {
      // Некоторые клиенты/прокси могут прислать неверный content-type.
      // Если JSON не парсится, попробуем fallback ниже.
    }
  }

  // Fallback: попробуем как JSON, иначе — параметры.
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      // ignore
    }
  }
  return e && e.parameter ? e.parameter : {};
}

function required_(value, field) {
  if (!value) throw new Error(`Missing field: ${field}`);
  return value;
}

function safeStr_(value) {
  return String(value == null ? '' : value).trim();
}

function enforceLen_(value, field) {
  if (value && value.length > MAX_FIELD_LEN) {
    throw new Error(`Field too long: ${field}`);
  }
}

function hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map((b) => {
    const v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

function json_(obj, statusCode) {
  // В Web App с ContentService заголовки CORS управляются платформой.
  // На практике `fetch()` с URL вида https://script.google.com/macros/s/.../exec работает при публичном деплое.
  const out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);

  // statusCode параметр оставлен для совместимости (ContentService не умеет кастомные HTTP коды).
  // eslint-disable-next-line no-unused-vars
  const _ignored = statusCode;

  return out;
}

