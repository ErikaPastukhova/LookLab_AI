import { createTryOnState } from './state/tryOnState.js';
import { getMockCatalog, getAllCategories } from './catalog/mockCatalog.js';
import { applyClothingToPhoto } from './renderer/applyClothingToPhoto.js';

const elements = {
  uploadZone: document.getElementById('vto-upload-zone'),
  fileInput: document.getElementById('vto-file-input'),

  statusUploading: document.getElementById('vto-status-uploading'),
  statusError: document.getElementById('vto-status-error'),

  categorySelect: document.getElementById('vto-category-select'),
  catalog: document.getElementById('vto-catalog'),
  catalogHint: document.getElementById('vto-catalog-hint'),

  canvas: document.getElementById('vto-canvas'),
  previewEmpty: document.getElementById('vto-preview-empty'),
  statusRendering: document.getElementById('vto-status-rendering'),
  generateButton: document.getElementById('vto-generate-btn'),
};

const canvasSize = {
  width: 0,
  height: 0,
};

const API_BASE =
  window.VTO_API_BASE ||
  'http://111.88.244.171:8000/api/v1';

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 180;

let sourcePhotoFile = null;
let currentCatalog = [];
let generatedPreviewImage = null;

const state = createTryOnState({
  onChange: async () => {
    await renderCurrent();
    updateGenerateButtonState();
  },
});

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

function setUploading(isUploading) {
  if (!elements.statusUploading) return;
  elements.statusUploading.hidden = !isUploading;
}

function setRendering(isRendering, text = 'Генерируем результат...') {
  if (!elements.statusRendering) return;
  elements.statusRendering.hidden = !isRendering;
  elements.statusRendering.textContent = text;
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

function drawImageCover(ctx, w, h, img) {
  const imgRatio = img.width / img.height;
  const canvasRatio = w / h;

  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;

  if (imgRatio > canvasRatio) {
    sh = img.height;
    sw = sh * canvasRatio;
    sx = (img.width - sw) / 2;
  } else {
    sw = img.width;
    sh = sw / canvasRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(248,250,252,1)';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
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
    drawImageCover(ctx, w, h, generatedPreviewImage);
    return;
  }

  drawImageCover(ctx, w, h, photo);
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
  try {
    const response = await fetch(`${API_BASE}/catalog/items`);
    if (!response.ok) throw new Error('Не удалось получить каталог.');
    const data = await response.json();
    if (!Array.isArray(data.items) || !data.items.length) throw new Error('Каталог пуст.');
    return data.items;
  } catch (err) {
    console.warn('Catalog API unavailable, fallback to mock catalog.', err);
    return getMockCatalog();
  }
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
    setStatusError('Загрузите фото и выберите предмет одежды.');
    return;
  }

  state.setError(null);
  setStatusError('');
  state.setStatus('generating');
  setRendering(true, 'Отправляем задачу генерации...');
  updateGenerateButtonState();

  try {
    const formData = new FormData();
    formData.append('garment_item_id', item.id);
    formData.append('person_image', sourcePhotoFile);

    const createResponse = await fetch(`${API_BASE}/tryon/jobs`, {
      method: 'POST',
      body: formData,
    });

    if (!createResponse.ok) {
      const detail = await createResponse.text();
      throw new Error(`Ошибка запуска генерации: ${detail || createResponse.status}`);
    }

    const createData = await createResponse.json();
    const jobId = createData.jobId;
    if (!jobId) throw new Error('Сервер не вернул job id.');

    let lastStatus = 'queued';
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (lastStatus === 'queued') setRendering(true, 'Задача в очереди...');
      if (lastStatus === 'running') setRendering(true, 'AI генерирует примерку...');

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
        setRendering(true, 'Готово: примерка успешно сгенерирована.');
        setTimeout(() => setRendering(false), 1800);
        state.setStatus('ready');
        updateGenerateButtonState();
        return;
      }
      if (statusData.status === 'failed') {
        throw new Error(statusData.error || 'Генерация завершилась с ошибкой.');
      }
    }

    throw new Error('Превышено время ожидания результата. Попробуйте снова.');
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

    const message = err instanceof Error ? err.message : 'Ошибка генерации.';
    setStatusError(message);
    state.setError(message);
    state.setStatus('ready');
    setRendering(false);
  } finally {
    updateGenerateButtonState();
  }
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
    setStatusError('');
    setUploading(true);
    state.setStatus('uploading');
    generatedPreviewImage = null;

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
      setStatusError(err instanceof Error ? err.message : 'Ошибка загрузки изображения.');
      state.setError(err instanceof Error ? err.message : 'Ошибка загрузки изображения.');
    } finally {
      setUploading(false);
      state.setStatus('ready');
      updateGenerateButtonState();
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
  const items = await loadCatalogFromApi();
  ensureCategories();
  initCatalog(items);

  // Default: no photo yet.
  updatePreviewOverlayVisibility();

  prepareCanvasForRender();
  setupUploadHandlers();
  setupResize();
  elements.generateButton?.addEventListener('click', async () => {
    await runTryOnGeneration();
  });
  updateGenerateButtonState();
}

boot();

