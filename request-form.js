import { normalizeNetworkError, showError } from './ui/messages.js';

/**
 * Вставьте сюда URL деплоя Google Apps Script Web App.
 * Пример: https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
 */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbytTgHLSYXQnwH67RbqrXUZ7JfwXLmgbUSPePzkBHVxW9PGHDAY8NtRuR4-5TziZoA5uQ/exec';

function isConfigured() {
  return typeof APPS_SCRIPT_URL === 'string' && APPS_SCRIPT_URL.trim().length > 0;
}

function getForm() {
  return document.getElementById('request-form-el');
}

function getSuccessEl() {
  return document.getElementById('form-success');
}

function getLoaderEl() {
  return document.getElementById('request-loader');
}

function setBusy(form, busy) {
  if (!form) return;
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = Boolean(busy);

  const loader = getLoaderEl();
  if (loader) loader.hidden = !busy;
}

function setFormCompleted(form, completed) {
  if (!form) return;
  const fields = form.querySelectorAll('.form-field');
  fields.forEach((el) => {
    // Keep honeypot hidden regardless.
    if (el.getAttribute('aria-hidden') === 'true') return;
    el.hidden = Boolean(completed);
  });
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.hidden = Boolean(completed);
}

async function submitLead(payload) {
  // Важно: отправляем как application/x-www-form-urlencoded без кастомных заголовков,
  // чтобы браузер не делал CORS preflight (OPTIONS), который у Apps Script часто 405.
  const body = new URLSearchParams();
  body.set('name', payload.name || '');
  body.set('contact', payload.contact || '');
  body.set('store', payload.store || '');
  body.set('comment', payload.comment || '');
  body.set('honeypot', payload.honeypot || '');
  body.set('pageUrl', payload.pageUrl || '');
  body.set('userAgent', payload.userAgent || '');

  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok || !data || data.ok !== true) {
    const serverError =
      (data && (data.error || data.message)) || `HTTP ${res.status} ${res.statusText || ''}`.trim();
    throw new Error(serverError);
  }

  return data;
}

function buildPayload(form) {
  const fd = new FormData(form);

  return {
    name: String(fd.get('name') || '').trim(),
    contact: String(fd.get('contact') || '').trim(),
    store: String(fd.get('store') || '').trim(),
    comment: String(fd.get('comment') || '').trim(),
    honeypot: String(fd.get('website') || '').trim(),
    pageUrl: window.location.href,
    userAgent: navigator.userAgent,
  };
}

function validateClient(payload) {
  if (!payload.name) return 'Введите имя.';
  if (!payload.contact) return 'Введите номер телефона.';
  if (!/^(\+\d{11,15}|8\d{10}|7\d{10})$/.test(payload.contact)) {
    return 'Телефон: только цифры и необязательный "+". Примеры: +76176175454 или 89661531212.';
  }
  if (!payload.store) return 'Введите название магазина или ссылку.';
  if (payload.comment && payload.comment.length > 2000) return 'Комментарий слишком длинный.';
  return '';
}

function install() {
  const form = getForm();
  if (!form) return;

  const contactInput = document.getElementById('request-contact');
  if (contactInput) {
    contactInput.addEventListener('input', () => {
      const raw = String(contactInput.value || '');
      // Keep only digits and "+", ensure "+" is only leading.
      let cleaned = raw.replace(/[^\d+]/g, '');
      const plusCount = (cleaned.match(/\+/g) || []).length;
      if (plusCount > 1) cleaned = cleaned.replace(/\+/g, '');
      if (cleaned.includes('+')) {
        cleaned = '+' + cleaned.replace(/\+/g, '');
      }
      contactInput.value = cleaned;
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!isConfigured()) {
      showError({
        title: 'Форма пока не настроена.',
        help: ['Нужно указать APPS_SCRIPT_URL в файле request-form.js и заново задеплоить сайт.'],
        technical: 'APPS_SCRIPT_URL is empty.',
      });
      return;
    }

    const payload = buildPayload(form);

    // Honeypot: если заполнено — молча "успешно" (не даём спамеру сигнал).
    if (payload.honeypot) {
      const successEl = getSuccessEl();
      if (successEl) successEl.hidden = false;
      form.reset();
      return;
    }

    const validationError = validateClient(payload);
    if (validationError) {
      showError({ title: validationError });
      return;
    }

    const successEl = getSuccessEl();
    if (successEl) successEl.hidden = true;
    setFormCompleted(form, false);

    setBusy(form, true);
    try {
      await submitLead(payload);
      if (successEl) successEl.hidden = false;
      setFormCompleted(form, true);
      form.reset();
    } catch (err) {
      const normalized = normalizeNetworkError(err);
      showError(normalized);
    } finally {
      setBusy(form, false);
    }
  });
}

install();

