import { createTryOnState } from './state/tryOnState.js';
import { getAllCategories } from './catalog/categories.js';
import { installGlobalErrorHandlers, showError } from '../ui/messages.js';

installGlobalErrorHandlers();

const elements = {
  uploadZone: document.getElementById('vto-upload-zone'),
  fileInput: document.getElementById('vto-file-input'),

  statusUploading: document.getElementById('vto-status-uploading'),
  statusNotice: document.getElementById('vto-status-notice'),
  statusError: document.getElementById('vto-status-error'),

  categorySelect: document.getElementById('vto-category-select'),
  categoryTrigger: document.getElementById('vto-category-trigger'),
  categoryValue: document.getElementById('vto-category-value'),
  categoryMenu: document.getElementById('vto-category-menu'),
  catalog: document.getElementById('vto-catalog'),
  catalogPagination: document.getElementById('vto-catalog-pagination'),
  catalogHint: document.getElementById('vto-catalog-hint'),

  canvas: document.getElementById('vto-canvas'),
  previewEmpty: document.getElementById('vto-preview-empty'),
  statusRendering: document.getElementById('vto-status-rendering'),
  statusRenderingText: document.getElementById('vto-status-rendering-text'),
  generateButton: document.getElementById('vto-generate-btn'),

  resultActions: document.getElementById('vto-result-actions'),
  saveButton: document.getElementById('vto-save-btn'),
  shareButton: document.getElementById('vto-share-btn'),
  shareMenu: document.getElementById('vto-share-menu'),
  shareTelegram: document.getElementById('vto-share-telegram'),
  shareWhatsapp: document.getElementById('vto-share-whatsapp'),
  shareVk: document.getElementById('vto-share-vk'),

  canvasWrap: document.querySelector('.vto-canvas-wrap'),

  genderSelect: document.getElementById('vto-gender-select'),
  genderTrigger: document.getElementById('vto-gender-trigger'),
  genderValue: document.getElementById('vto-gender-value'),
  genderMenu: document.getElementById('vto-gender-menu'),
};

const canvasSize = {
  width: 0,
  height: 0,
};

function getDefaultApiBase() {
  const explicit = window.VTO_API_BASE;
  if (explicit) return explicit;

  const host = String(window.location.hostname || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (isLocal) return 'http://localhost:8000/api/v1';

  return 'https://d5dnmn8hm7jc5rsrfis2.nkhmighe.apigw.yandexcloud.net/api/v1';
}

const API_BASE = getDefaultApiBase();

const CATALOG_REQUEST_TIMEOUT_MS = 8000;

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 300;

const HIDDEN_CATALOG_ITEM_IDS = new Set([
  'black-jacket-01',
  'green-pullover-01',
  'grey-pullover-01',
  'white-jacket-01',
]);

let sourcePhotoFile = null;
let currentCatalog = [];
let generatedPreviewImage = null;
let lastResultImageUrl = null;
let hasFinalResult = false;

const MOBILE_PAGER_QUERY = '(max-width: 900px)';
const PAGE_SIZE_MOBILE = 4;
const mobilePagerMql = window.matchMedia?.(MOBILE_PAGER_QUERY) || null;
let catalogPage = 1;

let generationTickerId = null;
let generationPhase = 'queued'; // queued | running
let generationStartedAt = 0;

const state = createTryOnState({
  onChange: async () => {
    await renderCurrent();
    updateGenerateButtonState();
  },
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setStatusNotice(message) {
  if (!elements.statusNotice) return;
  if (!message) {
    elements.statusNotice.hidden = true;
    elements.statusNotice.textContent = '';
    return;
  }
  elements.statusNotice.hidden = false;
  elements.statusNotice.textContent = message;
}

function setStatusError(message) {
  if (!elements.statusError) return;
  if (!message) {
    elements.statusError.hidden = true;
    elements.statusError.textContent = '';
    return;
  }
  elements.statusError.hidden = false;
  elements.statusError.textContent = message;
}

function setUserFacingError({ title, help = [], technical = '' }) {
  if (!elements.statusError) return;

  if (!title) {
    elements.statusError.hidden = true;
    elements.statusError.textContent = '';
    return;
  }

  // Also show the error in a global, fixed message area (like other screens),
  // because the inline error block can be hidden when the preview overlay is not visible.
  try {
    showError({ title, help, technical });
  } catch {
    // ignore UI message failures
  }

  const helpItems = Array.isArray(help) ? help.filter(Boolean) : [];
  const helpHtml =
    helpItems.length > 0
      ? `<ul>${helpItems.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
      : '';

  const detailsHtml = technical
    ? `
      <details class="vto-status-details">
        <summary>Технические детали</summary>
        <pre>${escapeHtml(technical)}</pre>
      </details>
    `
    : '';

  elements.statusError.hidden = false;
  elements.statusError.innerHTML = `
    <div class="vto-status-title">${escapeHtml(title)}</div>
    <div class="vto-status-help">
      ${helpHtml}
      ${detailsHtml}
    </div>
  `;
}

function normalizeTryOnError(err, { stage } = {}) {
  const message = err instanceof Error ? err.message : String(err || '');
  const lower = message.toLowerCase();

  // Network / fetch failures often vary by browser.
  const isNetwork =
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('net::err') ||
    lower.includes('fetch');

  if (isNetwork) {
    return {
      title: 'Не удалось связаться с AI‑сервисом.',
      help: [
        'Проверьте подключение к интернету.',
        'Отключите VPN/прокси или попробуйте другой браузер/сеть.',
        'Если используете корпоративную сеть — возможно, домен API заблокирован.',
      ],
      technical: stage ? `${stage}: ${message}` : message,
    };
  }

  if (lower.includes('превышено время ожидания')) {
    return {
      title: 'Сервис генерирует слишком долго.',
      help: [
        'Подождите 1–2 минуты и попробуйте снова.',
        'Иногда при первом запуске сервис может отвечать дольше обычного.',
        'Если ошибка повторяется — попробуйте позже.',
      ],
      technical: stage ? `${stage}: ${message}` : message,
    };
  }

  if (lower.includes('сервер не вернул job id')) {
    return {
      title: 'Сервис ответил некорректно.',
      help: ['Попробуйте ещё раз через несколько секунд.', 'Если повторяется — сервис временно нестабилен.'],
      technical: stage ? `${stage}: ${message}` : message,
    };
  }

  if (lower.includes('не удалось загрузить результат генерации')) {
    return {
      title: 'Результат сгенерирован, но картинка не загрузилась.',
      help: [
        'Попробуйте нажать “Сгенерировать” ещё раз.',
        'Проверьте, не блокирует ли браузер загрузку изображений (adblock/антивирус).',
      ],
      technical: stage ? `${stage}: ${message}` : message,
    };
  }

  // Generic fallback.
  return {
    title: 'Произошла ошибка.',
    help: [
      'Попробуйте повторить действие.',
      'Если не помогает — обновите страницу и попробуйте снова.',
    ],
    technical: stage ? `${stage}: ${message}` : message,
  };
}

function setUploading(isUploading) {
  if (!elements.statusUploading) return;
  elements.statusUploading.hidden = !isUploading;
}

function setRendering(isRendering, text = 'Генерируем результат...') {
  if (!elements.statusRendering) return;
  elements.statusRendering.hidden = !isRendering;
  // Some browsers/CSS setups may still keep the element hidden; force visibility.
  elements.statusRendering.style.display = isRendering ? '' : 'none';
  if (elements.statusRenderingText) {
    elements.statusRenderingText.textContent = text;
  } else {
    elements.statusRendering.textContent = text;
  }

  updateActionsSlotVisibility();
}

function getGenerationMessage(elapsedMs) {
  const seconds = Math.floor(elapsedMs / 1000);
  const bucket = Math.floor(seconds / 20); // change every 20s

  const base =
    generationPhase === 'running'
      ? [
          'Генерируем примерку… Обычно это занимает до минуты.',
          'Генерация всё ещё идёт… Пожалуйста, подождите.',
          'Почти готово… Ещё немного.',
        ]
      : [
          'Подготавливаем генерацию…',
          'Задача в очереди… Пожалуйста, подождите.',
          'Запуск может занять чуть дольше обычного… Это нормально.',
        ];

  const text = base[Math.min(bucket, base.length - 1)];

  if (elapsedMs >= 60_000) {
    return `${text} Извините за долгое ожидание — мы всё ещё работаем над результатом.`;
  }
  return text;
}

function startGenerationTicker() {
  stopGenerationTicker();
  generationStartedAt = Date.now();
  setRendering(true, getGenerationMessage(0));
  generationTickerId = window.setInterval(() => {
    const elapsed = Date.now() - generationStartedAt;
    setRendering(true, getGenerationMessage(elapsed));
  }, 20_000);
}

function stopGenerationTicker() {
  if (!generationTickerId) return;
  window.clearInterval(generationTickerId);
  generationTickerId = null;
}

function updatePreviewOverlayVisibility() {
  if (!elements.previewEmpty) return;
  const shouldShow = !state.getPhoto() && !generatedPreviewImage;
  elements.previewEmpty.hidden = !shouldShow;
  elements.previewEmpty.style.display = shouldShow ? '' : 'none';
}

function updateGenerateButtonState() {
  if (!elements.generateButton) return;
  const hasPhoto = !!state.getPhoto();
  const hasSelectedItem = !!state.getSelectedItem();
  const { status } = state.snapshot();
  const isBusy = status === 'uploading' || status === 'generating';
  elements.generateButton.disabled = !hasPhoto || !hasSelectedItem || isBusy;

  updateActionsSlotVisibility();
}

function updateResultActionsVisibility() {
  if (!elements.resultActions) return;
  const { status } = state.snapshot();
  const isBusy = status === 'uploading' || status === 'generating';
  // Show actions only after generation finished (AI or fallback).
  elements.resultActions.hidden = !hasFinalResult || isBusy;
  if (elements.resultActions.hidden) closeShareMenu();

  updateActionsSlotVisibility();
}

function updateActionsSlotVisibility() {
  if (!elements.generateButton || !elements.statusRendering || !elements.resultActions) return;

  const { status } = state.snapshot();
  const isGenerating = status === 'generating';

  // During generation: show status instead of generate button.
  // After generation finished: show result actions instead of generate button.
  // Otherwise: show generate button.
  if (isGenerating) {
    elements.generateButton.hidden = true;
    elements.resultActions.hidden = true;
    // statusRendering visibility is controlled by setRendering(true/false)
    return;
  }

  const shouldShowResultActions = hasFinalResult;
  elements.statusRendering.hidden = true;
  elements.statusRendering.style.display = 'none';

  if (shouldShowResultActions) {
    elements.generateButton.hidden = true;
    elements.resultActions.hidden = false;
  } else {
    elements.generateButton.hidden = false;
    // keep resultActions hidden until we have final result
    elements.resultActions.hidden = true;
  }
}

function drawImageContain(ctx, w, h, img) {
  const scale = Math.min(w / img.width, h / img.height);
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  const dx = (w - drawWidth) / 2;
  const dy = (h - drawHeight) / 2;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(248,250,252,1)';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, dx, dy, drawWidth, drawHeight);
}

async function renderCurrent() {
  if (!elements.canvas) return;

  const hasPhoto = !!state.getPhoto();
  const hasSelectedItem = !!state.getSelectedItem();

  if (elements.catalogHint) {
    // Появляем подсказку только когда фото есть, но предмет ещё не выбран.
    elements.catalogHint.hidden = !hasPhoto || hasSelectedItem;
  }

  updatePreviewOverlayVisibility();
  if (!hasPhoto) return;

  const photo = state.getPhoto();
  const ctx = elements.canvas.getContext('2d');
  if (!ctx) return;

  const w = elements.canvas.width;
  const h = elements.canvas.height;
  if (!w || !h) return;

  if (generatedPreviewImage) {
    drawImageContain(ctx, w, h, generatedPreviewImage);
    updateResultActionsVisibility();
    return;
  }

  drawImageContain(ctx, w, h, photo);
  updateResultActionsVisibility();
}

function prepareCanvasForRender() {
  if (!elements.canvas) return;
  const rect = elements.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = Math.max(320, Math.floor(rect.width * dpr));
  const nextHeight = Math.max(240, Math.floor(rect.height * dpr));

  if (nextWidth === canvasSize.width && nextHeight === canvasSize.height) return;
  canvasSize.width = nextWidth;
  canvasSize.height = nextHeight;

  elements.canvas.width = canvasSize.width;
  elements.canvas.height = canvasSize.height;
}

function ensureCategories() {
  if (!elements.categorySelect) return;
  // Initial fill with the full list; later we will narrow it down depending on gender filter.
  const categories = getAllCategories(elements.genderSelect?.value || 'all');
  for (const cat of categories) {
    const option = document.createElement('option');
    option.value = cat.value;
    option.textContent = cat.label;
    elements.categorySelect.appendChild(option);
  }
}

function setupSelectDropdown({ selectEl, triggerEl, menuEl, valueEl }) {
  if (!selectEl || !triggerEl || !menuEl || !valueEl) return;

  function syncTriggerFromSelect() {
    const selected = selectEl.selectedOptions?.[0];
    valueEl.textContent = selected?.textContent || '';
  }

  function closeMenu() {
    menuEl.hidden = true;
    triggerEl.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    menuEl.hidden = false;
    triggerEl.setAttribute('aria-expanded', 'true');
  }

  function toggleMenu() {
    const isOpen = !menuEl.hidden;
    if (isOpen) closeMenu();
    else openMenu();
  }

  function rebuildMenuFromSelect() {
    menuEl.innerHTML = '';
    const currentValue = selectEl.value;

    for (const opt of selectEl.options) {
      const el = document.createElement('div');
      el.className = 'vto-select-option';
      el.setAttribute('role', 'option');
      el.dataset.value = opt.value;
      el.textContent = opt.textContent || opt.value;
      el.setAttribute('aria-selected', opt.value === currentValue ? 'true' : 'false');
      el.addEventListener('click', () => {
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        syncTriggerFromSelect();
        rebuildMenuFromSelect();
        closeMenu();
      });
      menuEl.appendChild(el);
    }
  }

  triggerEl.addEventListener('click', toggleMenu);

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (menuEl.contains(t) || triggerEl.contains(t)) return;
    closeMenu();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  selectEl.addEventListener('change', () => {
    syncTriggerFromSelect();
    rebuildMenuFromSelect();
  });

  syncTriggerFromSelect();
  rebuildMenuFromSelect();
  closeMenu();
}

function setupCategoryDropdown() {
  setupSelectDropdown({
    selectEl: elements.categorySelect,
    triggerEl: elements.categoryTrigger,
    menuEl: elements.categoryMenu,
    valueEl: elements.categoryValue,
  });
}

function setupGenderDropdown() {
  setupSelectDropdown({
    selectEl: elements.genderSelect,
    triggerEl: elements.genderTrigger,
    menuEl: elements.genderMenu,
    valueEl: elements.genderValue,
  });
}

function isMobileCatalogPagerEnabled() {
  return !!mobilePagerMql?.matches;
}

function clampPage(value, totalPages) {
  const nextTotal = Math.max(1, Number(totalPages) || 1);
  const v = Number(value) || 1;
  return Math.min(Math.max(1, v), nextTotal);
}

function setCatalogPaginationHidden(isHidden) {
  if (!elements.catalogPagination) return;
  elements.catalogPagination.hidden = !!isHidden;
}

function renderCatalogPagination(totalPages, currentPage, { onSelectPage } = {}) {
  if (!elements.catalogPagination) return;

  const pages = Math.max(1, Number(totalPages) || 1);
  const page = clampPage(currentPage, pages);

  // Hide pager for 0/1 pages (also for desktop).
  if (!isMobileCatalogPagerEnabled() || pages <= 1) {
    elements.catalogPagination.innerHTML = '';
    setCatalogPaginationHidden(true);
    return;
  }

  setCatalogPaginationHidden(false);
  elements.catalogPagination.innerHTML = '';

  for (let p = 1; p <= pages; p += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vto-page-btn';
    btn.textContent = String(p);
    btn.dataset.page = String(p);
    btn.setAttribute('aria-label', `Страница ${p}`);

    const isActive = p === page;
    if (isActive) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'page');
    }

    btn.addEventListener('click', () => {
      if (typeof onSelectPage === 'function') onSelectPage(p);
    });

    elements.catalogPagination.appendChild(btn);
  }
}

function renderCatalog(items) {
  if (!elements.catalog) return;
  elements.catalog.innerHTML = '';
  if (!items.length) return;

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'vto-item-card';
    card.dataset.itemId = item.id;
    const selected = state.getSelectedItem()?.id === item.id;
    if (selected) card.classList.add('vto-item-card--selected');

    const imageWrap = document.createElement('div');
    imageWrap.className = 'vto-item-image-wrap';
    const image = document.createElement('img');
    image.className = 'vto-item-image';
    image.src = item.garmentImageUrl;
    image.alt = item.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      imageWrap.classList.add('vto-item-image-wrap--fallback');
    });
    imageWrap.appendChild(image);

    const name = document.createElement('div');
    name.className = 'vto-item-name';
    name.textContent = item.name;

    card.appendChild(imageWrap);
    card.appendChild(name);

    card.addEventListener('click', () => {
      generatedPreviewImage = null;
      hasFinalResult = false;
      state.setSelectedItem(item);
      // Update selection styling.
      for (const other of elements.catalog.querySelectorAll('.vto-item-card')) {
        const isSelected = other.dataset.itemId === item.id;
        other.classList.toggle('vto-item-card--selected', isSelected);
      }
    });

    elements.catalog.appendChild(card);
  }
}

function filterCatalogByCategory(items, categoryValue) {
  if (categoryValue === 'all') return items;
  return items.filter((it) => it.category === categoryValue);
}

function normalizeGender(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'male') return 'male';
  if (v === 'female') return 'female';
  if (v === 'unisex') return 'unisex';
  return '';
}

function filterCatalogByGender(items, genderValue) {
  if (genderValue === 'all') return items;
  const g = normalizeGender(genderValue);
  if (!g) return items;

  return items.filter((it) => {
    // Missing/unknown gender is treated as unisex by requirement.
    const itemGender = normalizeGender(it?.gender) || 'unisex';
    if (itemGender === 'unisex') return true;
    return itemGender === g;
  });
}

function rebuildCategoryOptionsForGender(items) {
  if (!elements.categorySelect) return;

  const availableItems = filterCatalogByGender(items, elements.genderSelect?.value || 'all');
  const availableCategoryValues = new Set(
    availableItems.map((it) => String(it?.category || '').trim()).filter(Boolean),
  );

  const allCategories = getAllCategories(elements.genderSelect?.value || 'all');
  const nextOptions = [
    { value: 'all', label: 'Все' },
    ...allCategories
      .filter((c) => availableCategoryValues.has(c.value))
      .map((c) => ({ value: c.value, label: c.label })),
  ];

  const prevValue = elements.categorySelect.value || 'all';
  const prevIsStillAvailable = nextOptions.some((o) => o.value === prevValue);

  elements.categorySelect.innerHTML = '';
  for (const opt of nextOptions) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    elements.categorySelect.appendChild(el);
  }

  elements.categorySelect.value = prevIsStillAvailable ? prevValue : 'all';
  // Trigger re-sync of custom dropdown UI.
  elements.categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
}

function getFilteredCatalog(items) {
  const byCategory = filterCatalogByCategory(items, elements.categorySelect?.value || 'all');
  return filterCatalogByGender(byCategory, elements.genderSelect?.value || 'all');
}

function renderCatalogWithMobilePagination(items, { resetPage = false } = {}) {
  const filtered = getFilteredCatalog(items);

  if (!isMobileCatalogPagerEnabled()) {
    renderCatalog(filtered);
    renderCatalogPagination(1, 1);
    return;
  }

  if (resetPage) catalogPage = 1;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE_MOBILE));
  catalogPage = clampPage(catalogPage, totalPages);

  const start = (catalogPage - 1) * PAGE_SIZE_MOBILE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE_MOBILE);

  renderCatalog(pageItems);
  renderCatalogPagination(totalPages, catalogPage, {
    onSelectPage: (p) => {
      catalogPage = clampPage(p, totalPages);
      renderCatalogWithMobilePagination(items, { resetPage: false });
    },
  });
}

function initCatalog(items) {
  currentCatalog = items;
  // Скрываем подсказку, пока нет фото или пока не выбран предмет.
  if (elements.catalogHint) elements.catalogHint.hidden = true;
  rebuildCategoryOptionsForGender(items);
  renderCatalogWithMobilePagination(items, { resetPage: true });

  elements.categorySelect?.addEventListener('change', () => {
    renderCatalogWithMobilePagination(items, { resetPage: true });
  });

  elements.genderSelect?.addEventListener('change', () => {
    rebuildCategoryOptionsForGender(items);
    renderCatalogWithMobilePagination(items, { resetPage: true });
  });
}

function validateImageFile(file) {
  if (!file) return { ok: false, error: 'Файл не выбран.' };
  if (!file.type || !file.type.startsWith('image/')) {
    return { ok: false, error: 'Загрузите изображение (JPG/PNG/WEBP).' };
  }

  // Keep it small-ish for a frontend demo.
  const maxBytes = 10 * 1024 * 1024; // 10MB
  if (file.size > maxBytes) {
    return { ok: false, error: 'Файл слишком большой. Максимум: 10MB.' };
  }
  return { ok: true };
}

async function loadImageFromFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Ошибка чтения файла.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

  const img = new Image();
  // Ensure canvas is not tainted (data URL is same-origin).
  img.decoding = 'async';
  img.src = dataUrl;
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Не удалось загрузить изображение.'));
  });

  return img;
}

async function loadCatalogFromApi() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CATALOG_REQUEST_TIMEOUT_MS);
  try {
    // Do not let a stalled catalog request block the rest of the page startup.
    const response = await fetch(`${API_BASE}/catalog/items`, { signal: controller.signal });
    if (!response.ok) throw new Error('Не удалось получить каталог.');
    const data = await response.json();
    if (!Array.isArray(data.items) || !data.items.length) throw new Error('Каталог пуст.');
    setStatusNotice('');
    const items = data.items.filter((it) => !HIDDEN_CATALOG_ITEM_IDS.has(it?.id));
    return items;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Catalog API unavailable.', err);
    setStatusNotice(
      `Каталог недоступен (${message}). Проверьте, что запущен backend и указан правильный API_BASE.`,
    );
    return [];
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function loadImageFromUrl(url) {
  const img = new Image();
  img.decoding = 'async';
  // Do not set crossOrigin: presigned Object Storage URLs often work without bucket CORS
  // for <img> / drawImage; with crossOrigin='anonymous' the load fails unless the bucket
  // sends Access-Control-Allow-Origin. Canvas may be tainted; «Сохранить» uses result URL
  // (fetch + fallback to a new tab) instead of canvas export when needed.
  img.src = url;
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Не удалось загрузить результат генерации.'));
  });
  return img;
}

async function runTryOnGeneration() {
  const item = state.getSelectedItem();
  const photo = state.getPhoto();
  if (!item || !photo || !sourcePhotoFile) {
    setUserFacingError({
      title: 'Нельзя начать генерацию.',
      help: ['Загрузите фото человека.', 'Выберите предмет одежды из каталога.'],
    });
    return;
  }

  state.setError(null);
  setUserFacingError({ title: '' });
  state.setStatus('generating');
  hasFinalResult = false;
  lastResultImageUrl = null;
  generationPhase = 'queued';
  startGenerationTicker();
  updateGenerateButtonState();
  updateResultActionsVisibility();

  try {
    const jobStartAt = Date.now();
    const formData = new FormData();
    formData.append('garment_item_id', item.id);
    formData.append('person_image', sourcePhotoFile);

    const createResponse = await fetch(`${API_BASE}/tryon/jobs`, {
      method: 'POST',
      body: formData,
    });

    if (!createResponse.ok) {
      const detail = await createResponse.text();
      const hint =
        createResponse.status === 413
          ? 'Фото слишком большое для сервиса. Попробуйте файл меньшего размера.'
          : createResponse.status === 415
            ? 'Формат изображения не поддерживается сервисом. Попробуйте JPG или PNG.'
            : createResponse.status === 401 || createResponse.status === 403
              ? 'Нет доступа к сервису. Проверьте, что используется правильный адрес API.'
              : '';
      throw new Error(
        `Ошибка запуска генерации: ${detail || createResponse.status}${hint ? `\nПодсказка: ${hint}` : ''}`,
      );
    }

    const createData = await createResponse.json();
    const jobId = createData.jobId;
    if (!jobId) throw new Error('Сервер не вернул job id.');

    let lastStatus = 'queued';
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (lastStatus === 'queued') {
        generationPhase = 'queued';
      }
      if (lastStatus === 'running') generationPhase = 'running';

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const statusResponse = await fetch(`${API_BASE}/tryon/jobs/${jobId}`);
      if (!statusResponse.ok) {
        const detail = await statusResponse.text();
        throw new Error(`Ошибка получения статуса: ${detail || statusResponse.status}`);
      }
      const statusData = await statusResponse.json();
      lastStatus = statusData.status;

      if (statusData.status === 'done') {
        const resultImageUrl = statusData.resultImageUrl;
        if (!resultImageUrl) throw new Error('Результат генерации не найден.');
        lastResultImageUrl = resultImageUrl;
        generatedPreviewImage = await loadImageFromUrl(resultImageUrl);
        hasFinalResult = true;
        await renderCurrent();
        stopGenerationTicker();
        setRendering(true, 'Готово: примерка успешно сгенерирована.');
        setTimeout(() => setRendering(false), 1800);
        state.setStatus('ready');
        updateGenerateButtonState();
        updateResultActionsVisibility();
        return;
      }
      if (statusData.status === 'failed') {
        throw new Error(statusData.error || 'Генерация завершилась с ошибкой.');
      }
    }

    throw new Error('Превышено время ожидания результата. Попробуйте снова чуть позже.');
  } catch (err) {
    // If generation failed, show the original image as the final result.
    // This guarantees the user always sees a valid output (no partial overlays).
    generatedPreviewImage = null;
    lastResultImageUrl = null;
    hasFinalResult = true;
    await renderCurrent();

    const userErr = normalizeTryOnError(err, { stage: 'tryon' });
    setUserFacingError(userErr);
    state.setError(userErr.title);
    state.setStatus('ready');
    stopGenerationTicker();
    setRendering(false);
    updateResultActionsVisibility();
  } finally {
    stopGenerationTicker();
    updateGenerateButtonState();
    updateResultActionsVisibility();
  }
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    if (!canvas) return reject(new Error('Canvas not found'));
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Не удалось сохранить изображение.'));
        else resolve(blob);
      },
      type,
      quality,
    );
  });
}

async function downloadCurrentResult() {
  if (!elements.canvas) return;
  try {
    // If we have a direct result URL from the AI service, prefer downloading it
    // instead of exporting from canvas (canvas export can be blocked by CORS).
    if (hasFinalResult && lastResultImageUrl) {
      try {
        const resp = await fetch(lastResultImageUrl, { mode: 'cors' });
        if (!resp.ok) throw new Error(`Не удалось скачать результат: ${resp.status}`);
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'virtual-try-on.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return;
      } catch (directErr) {
        // If CORS blocks fetch, fall back to opening the image URL.
        window.open(lastResultImageUrl, '_blank', 'noopener,noreferrer');
        const message = directErr instanceof Error ? directErr.message : String(directErr || '');
        setUserFacingError({
          title: 'Браузер не дал скачать результат автоматически.',
          help: [
            'Мы открыли результат в новой вкладке — сохраните изображение вручную.',
            'Если нужно автоскачивание — настройте CORS на хостинге картинки (S3/Object Storage) или используйте прокси на своём API.',
          ],
          technical: message,
        });
        return;
      }
    }

    const blob = await canvasToBlob(elements.canvas, 'image/png');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'virtual-try-on.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || '');
    const lower = message.toLowerCase();

    // Some browsers block downloads from file:// pages with "The operation is insecure".
    const likelyFileProtocolIssue =
      window.location.protocol === 'file:' || lower.includes('insecure');

    if (!likelyFileProtocolIssue) throw err;

    // Fallback: open the image in a new tab, user can save it manually.
    const dataUrl = elements.canvas.toDataURL('image/png');
    window.open(dataUrl, '_blank', 'noopener,noreferrer');

    setUserFacingError({
      title: 'Браузер блокирует автосохранение на этой странице.',
      help: [
        'Откройте страницу через локальный сервер (http://), тогда “Сохранить” скачает файл автоматически.',
        'Сейчас изображение открыто в новой вкладке — сохраните его вручную.',
      ],
      technical: message,
    });
  }
}

function buildShareLinks() {
  const url = window.location.href;
  const text = 'Посмотрите мою виртуальную примерку';
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);

  if (elements.shareTelegram) {
    elements.shareTelegram.href = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`;
  }
  if (elements.shareWhatsapp) {
    elements.shareWhatsapp.href = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  }
  if (elements.shareVk) {
    elements.shareVk.href = `https://vk.com/share.php?url=${encodedUrl}`;
  }
}

function closeShareMenu() {
  if (!elements.shareMenu || !elements.shareButton) return;
  elements.shareMenu.hidden = true;
  elements.shareButton.setAttribute('aria-expanded', 'false');
}

function toggleShareMenu() {
  if (!elements.shareMenu || !elements.shareButton) return;
  const isOpen = !elements.shareMenu.hidden;
  if (isOpen) closeShareMenu();
  else {
    elements.shareMenu.hidden = false;
    elements.shareButton.setAttribute('aria-expanded', 'true');
  }
}

async function shareCurrentResult() {
  buildShareLinks();
  // Prefer system share menu when available.
  try {
    if (navigator.share && elements.canvas) {
      const blob = await canvasToBlob(elements.canvas, 'image/png');
      const file = new File([blob], 'virtual-try-on.png', { type: 'image/png' });
      const data = {
        title: 'Виртуальная примерка',
        text: 'Посмотрите мою виртуальную примерку',
        url: window.location.href,
        files: [file],
      };
      // Some browsers support share but not file sharing.
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        throw new Error('File share is not supported');
      }
      await navigator.share(data);
      closeShareMenu();
      return;
    }
  } catch {
    // Fall back to social links menu.
  }
  toggleShareMenu();
}

function setupUploadHandlers() {
  if (!elements.uploadZone || !elements.fileInput) return;

  function openFilePicker() {
    const { status } = state.snapshot();
    const isBusy = status === 'uploading' || status === 'generating';
    if (isBusy) return;

    // Allow selecting the same file again (otherwise 'change' may not fire).
    elements.fileInput.value = '';
    elements.fileInput.click();
  }

  elements.uploadZone.addEventListener('click', (e) => {
    // Avoid double-trigger when the click bubbles to the preview container.
    e.stopPropagation();
    openFilePicker();
  });

  // Allow replacing the photo by clicking the preview area.
  elements.canvasWrap?.addEventListener('click', () => {
    // When overlay is visible (no photo), uploadZone already covers the area.
    // When photo is visible, the overlay is hidden, so clicking the preview should reopen picker.
    if (elements.previewEmpty && !elements.previewEmpty.hidden) return;
    openFilePicker();
  });

  elements.uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') openFilePicker();
  });

  // Drop support.
  ['dragenter', 'dragover'].forEach((evt) => {
    elements.uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      elements.uploadZone.classList.add('vto-upload-zone--active');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    elements.uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      elements.uploadZone.classList.remove('vto-upload-zone--active');
    });
  });
  elements.uploadZone.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    await handleFile(file);
  });

  elements.fileInput.addEventListener('change', async () => {
    const file = elements.fileInput.files?.[0];
    await handleFile(file);
  });

  async function handleFile(file) {
    setUserFacingError({ title: '' });
    setUploading(true);
    state.setStatus('uploading');
    generatedPreviewImage = null;
    hasFinalResult = false;
    updateResultActionsVisibility();

    try {
      const v = validateImageFile(file);
      if (!v.ok) throw new Error(v.error);

      const img = await loadImageFromFile(file);
      sourcePhotoFile = file;
      state.setPhoto(img);

      // Ensure canvas fits container before first render.
      prepareCanvasForRender();
      await renderCurrent();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки изображения.';
      setUserFacingError({
        title: 'Не удалось загрузить фото.',
        help: [
          'Выберите файл JPG или PNG.',
          'Если файл из iPhone (HEIC) — конвертируйте в JPG/PNG.',
          'Если фото очень большое — уменьшите размер (до 10MB).',
        ],
        technical: message,
      });
      state.setError(message);
    } finally {
      setUploading(false);
      state.setStatus('ready');
      updateGenerateButtonState();
      updateResultActionsVisibility();
    }
  }
}

function setupResize() {
  let rafId = null;
  window.addEventListener('resize', () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(async () => {
      prepareCanvasForRender();
      await renderCurrent();
    });
  });

  if (typeof window.ResizeObserver !== 'function') return;
  if (!elements.canvasWrap) return;

  const ro = new ResizeObserver(() => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(async () => {
      prepareCanvasForRender();
      await renderCurrent();
    });
  });
  ro.observe(elements.canvasWrap);
}

function setupCatalogPagerMediaListener() {
  if (!mobilePagerMql) return;

  const handler = () => {
    // When switching between desktop/mobile, rerender catalog and hide/show pager.
    renderCatalogWithMobilePagination(currentCatalog, { resetPage: false });
  };

  if (typeof mobilePagerMql.addEventListener === 'function') {
    mobilePagerMql.addEventListener('change', handler);
  } else if (typeof mobilePagerMql.addListener === 'function') {
    mobilePagerMql.addListener(handler);
  }
}

async function boot() {
  // Helpful hint for local development / demos.
  if (window.location.protocol === 'file:') {
    setStatusNotice('Совет: откройте страницу через локальный сервер (а не file://), иначе браузер может блокировать JS‑модули и запросы.');
  }

  ensureCategories();
  setupCategoryDropdown();
  setupGenderDropdown();
  prepareCanvasForRender();
  setupUploadHandlers();
  setupResize();
  setupCatalogPagerMediaListener();
  elements.generateButton?.addEventListener('click', async () => {
    await runTryOnGeneration();
  });

  elements.saveButton?.addEventListener('click', async () => {
    try {
      await downloadCurrentResult();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить изображение.';
      setUserFacingError({ title: 'Не удалось сохранить результат.', help: ['Попробуйте ещё раз.'], technical: message });
    }
  });

  elements.shareButton?.addEventListener('click', async () => {
    await shareCurrentResult();
  });

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (elements.shareMenu?.contains(t) || elements.shareButton?.contains(t)) return;
    closeShareMenu();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeShareMenu();
  });

  // Default: no photo yet.
  updatePreviewOverlayVisibility();
  updateGenerateButtonState();
  updateResultActionsVisibility();

  const items = await loadCatalogFromApi();
  initCatalog(items);
}

boot();

