function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function ensureHost() {
  let host = document.getElementById('site-messages');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'site-messages';
  host.className = 'site-messages';
  document.body.appendChild(host);
  return host;
}

function removeExistingOfKind(kind) {
  const host = document.getElementById('site-messages');
  if (!host) return;
  host.querySelectorAll(`.site-message--${kind}`).forEach((el) => el.remove());
}

function renderMessage({ kind, title, help, technical, autoHideMs = 0, replace = false }) {
  const host = ensureHost();
  const safeKind = kind || 'notice';

  if (replace) removeExistingOfKind(safeKind);

  const el = document.createElement('div');
  el.className = `site-message site-message--${safeKind}`;

  const helpItems = Array.isArray(help) ? help.filter(Boolean) : [];
  const helpHtml =
    helpItems.length > 0 ? `<ul>${helpItems.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>` : '';

  const detailsHtml = technical
    ? `
      <details class="site-message-details">
        <summary>Технические детали</summary>
        <pre>${escapeHtml(technical)}</pre>
      </details>
    `
    : '';

  el.innerHTML = `
    <div class="site-message-header">
      <div class="site-message-title">${escapeHtml(title || '')}</div>
      <button class="site-message-close" type="button" aria-label="Закрыть">✕</button>
    </div>
    ${helpHtml ? `<div class="site-message-help">${helpHtml}${detailsHtml}</div>` : detailsHtml ? `<div class="site-message-help">${detailsHtml}</div>` : ''}
  `;

  const closeBtn = el.querySelector('.site-message-close');
  closeBtn?.addEventListener('click', () => el.remove());

  host.appendChild(el);

  if (autoHideMs && autoHideMs > 0) {
    window.setTimeout(() => {
      if (el.isConnected) el.remove();
    }, autoHideMs);
  }

  return el;
}

const ERROR_AUTOHIDE_MS = 90_000; // 1.5 minutes

export function showError({ title, help = [], technical = '', autoHideMs = ERROR_AUTOHIDE_MS } = {}) {
  return renderMessage({
    kind: 'error',
    title: title || 'Произошла ошибка.',
    help,
    technical,
    autoHideMs,
    replace: true,
  });
}

export function showNotice({ title, help = [], technical = '', autoHideMs = 6000 } = {}) {
  return renderMessage({ kind: 'notice', title: title || 'Информация', help, technical, autoHideMs });
}

export function showSuccess({ title, help = [], autoHideMs = 4500 } = {}) {
  return renderMessage({ kind: 'success', title: title || 'Готово', help, technical: '', autoHideMs });
}

export function showToast(message, kind = 'notice', autoHideMs = 2500) {
  return renderMessage({
    kind: kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'notice',
    title: message || '',
    help: [],
    technical: '',
    autoHideMs,
    replace: kind === 'error',
  });
}

export function normalizeNetworkError(err) {
  const message = err instanceof Error ? err.message : String(err || '');
  const lower = message.toLowerCase();
  const isNetwork =
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('net::err') ||
    lower.includes('fetch');

  if (isNetwork) {
    return {
      title: 'Не удалось выполнить запрос.',
      help: ['Проверьте интернет.', 'Отключите VPN/прокси и попробуйте снова.', 'Если не помогает — попробуйте другой браузер/сеть.'],
      technical: message,
    };
  }

  return {
    title: 'Произошла ошибка.',
    help: ['Попробуйте повторить действие.', 'Если ошибка повторяется — обновите страницу.'],
    technical: message,
  };
}

export function installGlobalErrorHandlers() {
  // Avoid double-install.
  if (window.__siteMessagesInstalled) return;
  window.__siteMessagesInstalled = true;

  window.addEventListener('error', (e) => {
    const msg = e?.message || 'Неизвестная ошибка.';
    showError({
      title: 'Ошибка на странице.',
      help: ['Попробуйте обновить страницу.', 'Если вы открыли страницу через file:// — запустите сайт через локальный сервер.'],
      technical: msg,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e?.reason instanceof Error ? e.reason.message : String(e?.reason || '');
    showError({
      title: 'Не удалось завершить действие.',
      help: ['Проверьте интернет и повторите.', 'Если не помогает — обновите страницу.'],
      technical: reason,
    });
  });

  if (window.location.protocol === 'file:') {
    showNotice({
      title: 'Страница открыта как файл (file://).',
      help: ['Некоторые функции могут не работать из-за ограничений браузера.', 'Откройте сайт через локальный сервер (например, `python3 -m http.server`).'],
      autoHideMs: 0,
    });
  }
}

