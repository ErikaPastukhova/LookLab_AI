import { createTryOnState } from './state/tryOnState.js';
import { getMockCatalog, getAllCategories } from './catalog/mockCatalog.js';
import { applyClothingToPhoto } from './renderer/applyClothingToPhoto.js';
import { installGlobalErrorHandlers } from '../ui/messages.js';

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
};

const canvasSize = {
  width: 0,
  height: 0,
};

const API_BASE =
  window.VTO_API_BASE ||
  'https://d5dnmn8hm7jc5rsrfis2.nkhmighe.apigw.yandexcloud.net/api/v1';

const CATALOG_REQUEST_TIMEOUT_MS = 8000;

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 300;

const HIDDEN_CATALOG_ITEM_IDS = new Set([
  'black-jacket-01',
  'green-pullover-01',
  'grey-pullover-01',
  'white-jacket-01',
]);

const REQUIRED_CATALOG_ITEM_IDS = new Set(['polka-tank-01', 'grey-sweater-01']);

let sourcePhotoFile = null;
let currentCatalog = [];
let generatedPreviewImage = null;

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
}

function updateResultActionsVisibility() {
  if (!elements.resultActions) return;
  // Show actions only when we have a final rendered result (AI or fallback).
  const hasAnyResult = !!generatedPreviewImage || (!!state.getPhoto() && !!state.getSelectedItem());
  const { status } = state.snapshot();
  const isBusy = status === 'uploading' || status === 'generating';
  elements.resultActions.hidden = !hasAnyResult || isBusy;
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
  const categories = getAllCategories();
  for (const cat of categories) {
    const option = document.createElement('option');
    option.value = cat.value;
    option.textContent = cat.label;
    elements.categorySelect.appendChild(option);
  }
}

function setupCategoryDropdown() {
  if (!elements.categorySelect || !elements.categoryTrigger || !elements.categoryMenu || !elements.categoryValue) return;

  function syncTriggerFromSelect() {
    const selected = elements.categorySelect.selectedOptions?.[0];
    elements.categoryValue.textContent = selected?.textContent || 'Все';
  }

  function closeMenu() {
    elements.categoryMenu.hidden = true;
    elements.categoryTrigger.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    elements.categoryMenu.hidden = false;
    elements.categoryTrigger.setAttribute('aria-expanded', 'true');
  }

  function toggleMenu() {
    const isOpen = !elements.categoryMenu.hidden;
    if (isOpen) closeMenu();
    else openMenu();
  }

  function rebuildMenuFromSelect() {
    elements.categoryMenu.innerHTML = '';
    const currentValue = elements.categorySelect.value;

    for (const opt of elements.categorySelect.options) {
      const el = document.createElement('div');
      el.className = 'vto-select-option';
      el.setAttribute('role', 'option');
      el.dataset.value = opt.value;
      el.textContent = opt.textContent || opt.value;
      el.setAttribute('aria-selected', opt.value === currentValue ? 'true' : 'false');
      el.addEventListener('click', () => {
        elements.categorySelect.value = opt.value;
        elements.categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
        syncTriggerFromSelect();
        rebuildMenuFromSelect();
        closeMenu();
      });
      elements.categoryMenu.appendChild(el);
    }
  }

  elements.categoryTrigger.addEventListener('click', toggleMenu);

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (elements.categoryMenu.contains(t) || elements.categoryTrigger.contains(t)) return;
    closeMenu();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  elements.categorySelect.addEventListener('change', () => {
    syncTriggerFromSelect();
    rebuildMenuFromSelect();
  });

  syncTriggerFromSelect();
  rebuildMenuFromSelect();
  closeMenu();
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

function initCatalog(items) {
  currentCatalog = items;
  // Скрываем подсказку, пока нет фото или пока не выбран предмет.
  if (elements.catalogHint) elements.catalogHint.hidden = true;
  renderCatalog(filterCatalogByCategory(items, elements.categorySelect?.value || 'all'));

  elements.categorySelect?.addEventListener('change', () => {
    renderCatalog(filterCatalogByCategory(items, elements.categorySelect.value));
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
    return ensureRequiredCatalogItems(items);
  } catch (err) {
    console.warn('Catalog API unavailable, fallback to mock catalog.', err);
    setStatusNotice('Каталог из API недоступен — показан демо‑каталог. Это не влияет на загрузку фото, но AI‑примерка может работать нестабильно.');
    const items = getMockCatalog().filter((it) => !HIDDEN_CATALOG_ITEM_IDS.has(it?.id));
    return ensureRequiredCatalogItems(items);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function ensureRequiredCatalogItems(items) {
  const next = Array.isArray(items) ? [...items] : [];
  const existingIds = new Set(next.map((it) => it?.id).filter(Boolean));
  const mockById = new Map(getMockCatalog().map((it) => [it.id, it]));

  for (const requiredId of REQUIRED_CATALOG_ITEM_IDS) {
    if (existingIds.has(requiredId)) continue;
    const fallback = mockById.get(requiredId);
    if (fallback) next.push(fallback);
  }
  return next;
}

async function loadImageFromUrl(url) {
  const img = new Image();
  img.decoding = 'async';
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
        generatedPreviewImage = await loadImageFromUrl(resultImageUrl);
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
    // Optional visual fallback so user always sees a result in local demo.
    try {
      const fallbackItem = state.getSelectedItem();
      if (fallbackItem) {
        await applyClothingToPhoto({
          canvas: elements.canvas,
          photo: state.getPhoto(),
          clothingItem: fallbackItem,
          placement: fallbackItem.overlayPlacement,
        });
      }
    } catch (fallbackErr) {
      console.error('Fallback renderer failed:', fallbackErr);
    }

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
  const blob = await canvasToBlob(elements.canvas, 'image/png');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'virtual-try-on.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
    elements.fileInput.click();
  }

  elements.uploadZone.addEventListener('click', openFilePicker);

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
}

async function boot() {
  // Helpful hint for local development / demos.
  if (window.location.protocol === 'file:') {
    setStatusNotice('Совет: откройте страницу через локальный сервер (а не file://), иначе браузер может блокировать JS‑модули и запросы.');
  }

  ensureCategories();
  setupCategoryDropdown();
  prepareCanvasForRender();
  setupUploadHandlers();
  setupResize();
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

