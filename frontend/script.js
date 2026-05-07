/* CLEAN & FIXED SCRIPT.JS */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installGlobalErrorHandlers, showError, showNotice, showSuccess, normalizeNetworkError } from './ui/messages.js';

installGlobalErrorHandlers();

// --- СЦЕНА ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe0e0e0);
scene.fog = new THREE.Fog(0xe0e0e0, 5, 20);

const canvasContainer = document.getElementById('canvas-container');
const getRenderRect = () => (canvasContainer ? canvasContainer.getBoundingClientRect() : null);
const getRenderSize = () => {
    const rect = getRenderRect();
    const w = rect ? Math.max(1, Math.floor(rect.width)) : window.innerWidth;
    const h = rect ? Math.max(1, Math.floor(rect.height)) : window.innerHeight;
    return { w, h };
};

const initialSize = getRenderSize();
const camera = new THREE.PerspectiveCamera(50, initialSize.w / initialSize.h, 0.1, 100);
camera.position.set(0, 1.1, 3.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(initialSize.w, initialSize.h);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
if (canvasContainer) canvasContainer.appendChild(renderer.domElement);

// СВЕТ
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(1, 3, 2);
dirLight.castShadow = true;
scene.add(dirLight);

// ПОЛ
const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20), 
    new THREE.MeshStandardMaterial({ color: 0xdcdcdc, roughness: 1, metalness: 0 })
);
plane.rotation.x = -Math.PI / 2;
plane.receiveShadow = true;
scene.add(plane);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.0, 0); 

// --- CAMERA FRAMING (keep mannequin centered) ---
let modelBounds = null; // { center: THREE.Vector3, size: THREE.Vector3 }
function getScaledBounds() {
    if (!modelRoot || !modelBounds) return null;
    const s = modelRoot.scale;
    const center = modelBounds.center.clone().multiply(s).add(modelRoot.position);
    const size = modelBounds.size.clone().multiply(s);
    return { center, size };
}

function frameModelFront() {
    const b = getScaledBounds();
    if (!b) return;

    // Center orbit around the model.
    controls.target.copy(b.center);

    // Fit distance based on model size and camera fov.
    const maxDim = Math.max(b.size.x, b.size.y, b.size.z);
    const fov = (camera.fov * Math.PI) / 180;
    const fitDist = (maxDim * 0.55) / Math.tan(fov / 2);
    const dist = Math.max(2.2, fitDist) * 1.18;

    // Slightly above center feels more natural for full-body framing.
    camera.position.set(b.center.x, b.center.y + b.size.y * 0.08, b.center.z + dist);

    camera.near = Math.max(0.05, dist / 60);
    camera.far = Math.max(50, dist * 6);
    camera.updateProjectionMatrix();
    controls.update();
}


// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
let humanMesh = null;
let bonesList = [];
let modelRoot = null;
let currentGender = 'female';

const MEASUREMENTS = {
    male: {
        base: { chest: 96, waist: 82, hips: 100, arm: 32, leg: 55 },
        fat:  { chest: 148, waist: 150, hips: 146, arm: 85, leg: 95 }
    },
    female: {
        base: { chest: 86, waist: 68, hips: 94, arm: 28, leg: 52 },
        fat:  { chest: 145, waist: 160, hips: 160, arm: 80, leg: 92 }
    }
};

// --- ЗАГРУЗКА ---
const loader = new GLTFLoader();

function loadModel(gender) {
    if (modelRoot) {
        scene.remove(modelRoot);
        humanMesh = null; bonesList = [];
    }
    currentGender = gender;
    
    // ВАЖНО: Проверь, что имя файла верное
    const filename = (gender === 'male')
        ? './assets/models/male_advanced.glb'
        : './assets/models/female_advanced.glb';

    loader.load(filename, function (gltf) {
        modelRoot = gltf.scene;
        modelRoot.rotation.set(0, 0, 0); 

        scene.add(modelRoot);
        modelRoot.updateMatrixWorld(true);

        // Cache base bounds for framing (no expensive bbox during slider moves).
        try {
            const box = new THREE.Box3().setFromObject(modelRoot);
            const center = new THREE.Vector3();
            const size = new THREE.Vector3();
            box.getCenter(center);
            box.getSize(size);
            modelBounds = { center, size };
        } catch (e) {
            modelBounds = null;
        }

        // Ищем главный меш
        let meshFound = false;

        modelRoot.traverse((child) => {
            if (meshFound) return; // Уже нашли, выходим

            if (child.isMesh && child.morphTargetDictionary) {
                // Фильтр от мелких деталей
                if (child.geometry.attributes.position.count < 1000) return;

                humanMesh = child;
                meshFound = true;
                
                // Материал
                child.material = new THREE.MeshStandardMaterial({
                    vertexColors: true, 
                    color: 0xffffff,
                    roughness: 0.5,
                    metalness: 0.1,
                    skinning: true
                });
                
                // Заливка белым цветом
                const count = child.geometry.attributes.position.count;
                if (!child.geometry.attributes.color) {
                    const colors = new Float32Array(count * 3);
                    for(let i=0; i<count*3; i++) colors[i] = 0.95;
                    child.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                }

                // Скелет
                if (child.skeleton && child.skeleton.bones) {
                    bonesList = child.skeleton.bones;
                }
            }
        });

        if (humanMesh) updateAll();
        frameModelFront();

        // Hide init loader once the first model is loaded and framed.
        document.documentElement.classList.remove('ui-pending');
        document.documentElement.classList.add('ui-ready');

    }, undefined, function(e) {
        showError({
            title: 'Не удалось загрузить 3D‑модель.',
            help: [
                'Проверьте подключение к интернету (модель может загружаться как файл).',
                'Если вы открыли страницу через file:// — запустите через локальный сервер.',
                'Попробуйте обновить страницу.',
            ],
            technical: e && e.message ? e.message : String(e || ''),
        });

        // Even on error, stop blocking the UI behind the loader.
        document.documentElement.classList.remove('ui-pending');
        document.documentElement.classList.add('ui-ready');
    });
}

loadModel('female');


// --- UI МЕНЕДЖЕР ---
const mainGenderInputs = Array.from(document.querySelectorAll('input[name="gender-select"]'));
function getMainGenderValue() {
    const checkedInput = mainGenderInputs.find((input) => input.checked);
    return checkedInput && checkedInput.value === 'female' ? 'female' : 'male';
}
function setMainGenderValue(gender) {
    mainGenderInputs.forEach((input) => {
        input.checked = input.value === gender;
    });
}
mainGenderInputs.forEach((input) => {
    input.addEventListener('change', () => loadModel(getMainGenderValue()));
});

const inputs = {
    body: {
        height: getPair('body-height'),
        chest:  getPair('body-chest'),
        waist:  getPair('body-waist'),
        hips:   getPair('body-hips'),
        arm:    getPair('body-arm'),
        leg:    getPair('body-leg'),
    },
    cloth: {
        chest:  getPair('cloth-chest'),
        waist:  getPair('cloth-waist'),
        hips:   getPair('cloth-hips'),
        arm:    getPair('cloth-arm'),
        leg:    getPair('cloth-leg'),
    }
};

function getPair(id) {
    const range = document.getElementById(id);
    const num = document.getElementById('num-' + id);
    if (!range || !num) return { range:{value:0}, num:{value:0} };

    const updateRangeProgress = () => {
        const min = parseFloat(range.min || 0);
        const max = parseFloat(range.max || 100);
        const value = parseFloat(range.value || min);
        const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
        range.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, percent))}%`);
    };

    const update = () => {
        if(range.value !== num.value) num.value = range.value;
        updateRangeProgress();
        updateAll();
    };
    const updateNum = () => {
        if(range.value !== num.value) range.value = num.value;
        updateRangeProgress();
        updateAll();
    };

    range.addEventListener('input', update);
    num.addEventListener('input', updateNum);
    updateRangeProgress();
    
    return { range, num };
}


// --- ГЛАВНАЯ ЛОГИКА ---
function updateAll() {
    if (!humanMesh || !modelRoot) return;

    // 1. Сбор данных
    const body = {
        height: parseInt(inputs.body.height.num.value),
        chest:  parseInt(inputs.body.chest.num.value),
        waist:  parseInt(inputs.body.waist.num.value),
        hips:   parseInt(inputs.body.hips.num.value),
        arm:    parseInt(inputs.body.arm.num.value),
        leg:    parseInt(inputs.body.leg.num.value)
    };

    // 2. Рост
    const hScale = body.height / 175.0; 
    const wScale = 1.0 + ((hScale - 1.0) * 0.15); 
    modelRoot.scale.set(wScale, hScale, wScale);

    // 3. Морфинг
    const data = MEASUREMENTS[currentGender];
    const dict = humanMesh.morphTargetDictionary;
    const targets = humanMesh.morphTargetInfluences;

    humanMesh.morphTargetInfluences.fill(0);

    const setMorph = (morphName, val, base, fat) => {
        if (dict[morphName] === undefined) return;
        
        let influence = (val - base) / (fat - base);
        if (influence < 0) influence = 0; 
        
        targets[dict[morphName]] = influence;
    };

    // Привязываем к именам из Blender (advanced model)
    setMorph('chest', body.chest, data.base.chest, data.fat.chest);
    setMorph('belly', body.waist, data.base.waist, data.fat.waist);
    setMorph('hips',  body.hips,  data.base.hips,  data.fat.hips);
    setMorph('arms',  body.arm,   data.base.arm,   data.fat.arm);
    setMorph('legs',  body.leg,   data.base.leg,   data.fat.leg);

    // 4. Раскраска
    updateColors(body);
}

// Re-frame when height changes (scale affects visual centering).
if (inputs?.body?.height?.range) {
    inputs.body.height.range.addEventListener('input', () => frameModelFront());
}
if (inputs?.body?.height?.num) {
    inputs.body.height.num.addEventListener('input', () => frameModelFront());
}


// --- РАСКРАСКА (С ГЕОМЕТРИЧЕСКИМ РАЗДЕЛЕНИЕМ БЕДЕР) ---
function updateColors(body) {
    if (!humanMesh || bonesList.length === 0) return;

    const cloth = {
        chest: parseInt(inputs.cloth.chest.num.value),
        waist: parseInt(inputs.cloth.waist.num.value),
        hips:  parseInt(inputs.cloth.hips.num.value),
        arm:   parseInt(inputs.cloth.arm.num.value),
        leg:   parseInt(inputs.cloth.leg.num.value)
    };

    const d = {
        chest: cloth.chest - body.chest,
        waist: cloth.waist - body.waist,
        hips:  cloth.hips  - body.hips,
        arm:   cloth.arm   - body.arm,
        leg:   cloth.leg   - body.leg
    };

    const getColor = (diff) => {
        const c = new THREE.Color(0.95, 0.95, 0.95);
        if (diff < -2) { 
            const k = Math.min(Math.abs(diff) / 10, 1); 
            c.setHSL(0.0, 1.0, 0.8 - (k * 0.4)); // RED
        } else if (diff > 4) { 
            const k = Math.min(diff / 15, 1);
            c.setHSL(0.6, 1.0, 0.8 - (k * 0.4)); // BLUE
        }
        return c;
    };

    const pal = {
        chest: getColor(d.chest),
        waist: getColor(d.waist),
        hips:  getColor(d.hips),
        arm:   getColor(d.arm),
        leg:   getColor(d.leg),
        base:  new THREE.Color(0.95, 0.95, 0.95)
    };

    const skinIndices = humanMesh.geometry.attributes.skinIndex;
    const colors = humanMesh.geometry.attributes.color;
    
    // ДОБАВЛЕНО: Нам нужны позиции вершин, чтобы узнать высоту
    const positions = humanMesh.geometry.attributes.position;
    
    // Вычисляем границы модели, чтобы знать проценты высоты
    if (!humanMesh.geometry.boundingBox) humanMesh.geometry.computeBoundingBox();
    const minY = humanMesh.geometry.boundingBox.min.y;
    const maxY = humanMesh.geometry.boundingBox.max.y;
    const height = maxY - minY;

    const count = colors.count;

    for (let i = 0; i < count; i++) {
        const boneIndex = skinIndices.getX(i);
        if (boneIndex >= bonesList.length) continue;
        
        const b = bonesList[boneIndex].name.toLowerCase();
        let c = pal.base;
        
        // Получаем высоту этой точки (0.0 = пятки, 1.0 = макушка)
        // (y в локальных координатах MakeHuman обычно смотрит вверх)
        const localY = positions.getY(i);
        const h = (localY - minY) / height;

        // --- ЛОГИКА РАСКРАСКИ ---

        // 1. ГРУДЬ
        if (b.includes('spine_03') || b.includes('clavicle') || b.includes('neck') || b.includes('chest')) {
            c = pal.chest;
        } 
        // 2. ТАЛИЯ
        else if (b.includes('spine_01') || b.includes('spine_02')) {
            c = pal.waist;
        } 
        // 3. БЕДРА (Пояс + Таз)
        else if (b.includes('pelvis') || b.includes('root') || b.includes('hip')) {
            c = pal.hips;
        }
        
        // 4. НОГИ (ХИТРОСТЬ!)
        else if (b.includes('thigh')) { 
            // Это верхняя часть ноги.
            // Если точка ВЫШЕ 44% роста (примерный уровень паха), красим цветом "Бедер"
            // Если НИЖЕ - красим цветом "Ширина штанины"
            if (h > 0.44) {
                c = pal.hips; // Верх ляжек -> Бедра
            } else {
                c = pal.leg;  // Низ ляжек -> Ноги
            }
        }
        else if (b.includes('calf') || b.includes('leg') || b.includes('foot')) {
            c = pal.leg;
        }

        // 5. РУКИ
        else if (b.includes('upperarm') || b.includes('lowerarm') || b.includes('hand')) {
            c = pal.arm;
        }

        colors.setXYZ(i, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;
}


// Камера
window.setCamera = function(view) {
    if (!controls) return;
    const y = controls.target.y;
    if (view === 'front') camera.position.set(0, y, 3.2);
    if (view === 'side')  camera.position.set(2.5, y, 0);
    if (view === 'back')  camera.position.set(0, y, -3.2);
    controls.update();
};

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

function onWindowResize() {
    const { w, h } = getRenderSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

window.addEventListener('resize', onWindowResize);

// ПРИНУДИТЕЛЬНЫЙ ВЫЗОВ (чтобы убрать белые полосы при старте)
onWindowResize();

// --- ACCORDION ---
document.querySelectorAll('.accordion-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
        const section = toggle.closest('.accordion-section');
        if (section) section.classList.toggle('expanded');
    });
});

// --- MOBILE: bottom-sheet with tabs (demo.html) ---
function initMobileBottomSheet() {
    const mq = window.matchMedia && window.matchMedia('(max-width: 1024px)');
    if (!mq || !mq.matches) return false;

    const sheet = document.getElementById('mobile-sheet');
    const handle = document.getElementById('mobile-sheet-handle');
    const tabCloth = document.getElementById('mobile-tab-cloth');
    const tabBody = document.getElementById('mobile-tab-body');
    const panelCloth = document.getElementById('mobile-tabpanel-cloth');
    const panelBody = document.getElementById('mobile-tabpanel-body');
    const leftPanel = document.getElementById('left-panel');
    const uiPanel = document.getElementById('ui-panel');

    if (!sheet || !handle || !tabCloth || !tabBody || !panelCloth || !panelBody || !leftPanel || !uiPanel) return false;

    sheet.hidden = false;

    // Prevent duplicate listener wiring if init runs multiple times.
    if (sheet.dataset.mobileInit === '1') {
        return true;
    }
    sheet.dataset.mobileInit = '1';

    // Move existing DOM blocks so all listeners keep working.
    if (!panelCloth.contains(leftPanel)) panelCloth.appendChild(leftPanel);
    if (!panelBody.contains(uiPanel)) panelBody.appendChild(uiPanel);

    const setExpanded = (expanded) => {
        sheet.classList.toggle('is-expanded', !!expanded);
        document.body.classList.toggle('mobile-sheet-expanded', !!expanded);
    };

    const isExpanded = () => sheet.classList.contains('is-expanded');

    const setTab = (tab) => {
        const isCloth = tab === 'cloth';
        tabCloth.classList.toggle('is-active', isCloth);
        tabBody.classList.toggle('is-active', !isCloth);
        tabCloth.setAttribute('aria-selected', isCloth ? 'true' : 'false');
        tabBody.setAttribute('aria-selected', !isCloth ? 'true' : 'false');
        panelCloth.hidden = !isCloth;
        panelBody.hidden = isCloth;
    };

    // Defaults.
    setExpanded(false);
    setTab('cloth');

    // Mark mobile UI as ready to avoid “desktop panels” flash.
    document.documentElement.classList.remove('mobile-ui-pending');
    document.documentElement.classList.add('mobile-ui-ready');
    document.body.classList.add('mobile-ui-ready');

    handle.addEventListener('click', () => setExpanded(!isExpanded()));
    tabCloth.addEventListener('click', () => { setTab('cloth'); setExpanded(true); });
    tabBody.addEventListener('click', () => { setTab('body'); setExpanded(true); });

    // Drag (pull) to expand/collapse.
    let drag = null;
    const getPeekPx = () => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--mobile-sheet-peek').trim();
        const n = parseFloat(raw);
        return isFinite(n) ? n : 124;
    };
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    const getCollapsedTranslateY = () => {
        const peek = getPeekPx();
        return Math.max(0, sheet.offsetHeight - peek);
    };

    const setTranslateY = (y) => {
        sheet.style.transition = 'none';
        sheet.style.transform = `translateY(${Math.round(y)}px)`;
    };

    const clearInlineTransform = () => {
        sheet.style.transition = '';
        sheet.style.transform = '';
    };

    const shouldStartSheetDrag = (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return true;
        const bodyEl = document.getElementById('mobile-sheet-body');
        if (!bodyEl) return true;

        // If user interacts inside scrollable body and it can scroll, prefer scrolling over dragging.
        const insideBody = bodyEl.contains(t);
        if (!insideBody) return true;

        const canScroll = bodyEl.scrollHeight > bodyEl.clientHeight + 2;
        if (!canScroll) return true;

        // Allow drag from body only when already at top (so downward pull can close),
        // otherwise keep normal scroll behavior.
        return bodyEl.scrollTop <= 0;
    };

    const startDrag = (e, captureEl) => {
        // Only primary touch/mouse.
        if (e.button != null && e.button !== 0) return;
        drag = {
            pointerId: e.pointerId,
            startY: e.clientY,
            startTime: performance.now(),
            baseY: isExpanded() ? 0 : getCollapsedTranslateY(),
            lastY: e.clientY,
            lastTime: performance.now(),
            moved: false
        };
        try { captureEl.setPointerCapture(e.pointerId); } catch (_) {}
    };

    const onPointerMove = (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dy) > 3) drag.moved = true;

        const collapsed = getCollapsedTranslateY();
        const nextY = clamp(drag.baseY + dy, 0, collapsed);
        setTranslateY(nextY);

        drag.lastY = e.clientY;
        drag.lastTime = performance.now();
        e.preventDefault();
    };

    const finishDrag = (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const collapsed = getCollapsedTranslateY();
        const elapsed = Math.max(1, performance.now() - drag.lastTime);
        const velocity = (e.clientY - drag.lastY) / elapsed; // px/ms

        // Decide target state.
        const currentDy = e.clientY - drag.startY;
        const currentY = clamp(drag.baseY + currentDy, 0, collapsed);
        const shouldExpand =
            velocity < -0.25 || currentY < collapsed * 0.5;

        drag = null;
        clearInlineTransform();
        setExpanded(shouldExpand);
    };

    handle.addEventListener('pointerdown', (e) => startDrag(e, handle));
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);

    // Allow dragging by pulling the sheet itself (not only the handle).
    sheet.addEventListener('pointerdown', (e) => {
        if (!shouldStartSheetDrag(e)) return;
        startDrag(e, sheet);
    });
    sheet.addEventListener('pointermove', onPointerMove);
    sheet.addEventListener('pointerup', finishDrag);
    sheet.addEventListener('pointercancel', finishDrag);

    // Keep sheet usable after orientation changes, etc.
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) return;
        sheet.hidden = false;
    });

    return true;
}

function setupMobileBottomSheetAutoInit() {
    const mq = window.matchMedia && window.matchMedia('(max-width: 1024px)');
    if (!mq) return;

    let timer = null;
    let attempts = 0;
    const maxAttempts = 30; // ~3s with 100ms interval

    const tryInit = () => initMobileBottomSheet();

    const stopPolling = () => {
        if (timer) window.clearInterval(timer);
        timer = null;
    };

    const startPolling = () => {
        if (timer) return;
        timer = window.setInterval(() => {
            attempts += 1;
            const ok = tryInit();
            if (ok || attempts >= maxAttempts) stopPolling();
        }, 100);
    };

    // Try immediately and after paint.
    tryInit();
    requestAnimationFrame(tryInit);
    setTimeout(tryInit, 0);
    setTimeout(tryInit, 250);
    startPolling();

    // React to viewport/orientation changes.
    window.addEventListener('pageshow', () => { attempts = 0; tryInit(); startPolling(); });
    window.addEventListener('orientationchange', () => { attempts = 0; tryInit(); startPolling(); });
    window.addEventListener('resize', () => { attempts = 0; tryInit(); startPolling(); });

    // React to media query changes.
    const onMqChange = () => { attempts = 0; tryInit(); startPolling(); };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onMqChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onMqChange);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMobileBottomSheetAutoInit);
} else {
    setupMobileBottomSheetAutoInit();
}

// --- ESCAPE ДЛЯ ЗАКРЫТИЯ МОДАЛОК ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const measureModal = document.getElementById('measure-modal');
        const bodyModal = document.getElementById('body-scan-modal');
        if (measureModal && measureModal.style.display === 'flex') measureModal.style.display = 'none';
        if (bodyModal && bodyModal.style.display === 'flex') bodyModal.style.display = 'none';
    }
});


/* --- МОДУЛЬ "УМНАЯ ЛИНЕЙКА" (РУЧНОЙ РЕЖИМ) --- */
(function initMeasureTool() {
    const modal = document.getElementById('measure-modal');
    const btnOpen = document.getElementById('btn-measure-tool');
    const btnClose = document.getElementById('close-modal');
    const fileInput = document.getElementById('image-upload');
    const typeSelect = document.getElementById('clothing-type-selector');
    
    const canvas = document.getElementById('measure-canvas');
    const ctx = canvas.getContext('2d');
    const instrBadge = document.getElementById('instruction-badge');
    const scanFooter = document.getElementById('scan-footer');
    const scanVal = document.getElementById('scan-val');
    
    // Кнопки управления
    const btnSkip = document.getElementById('btn-skip-step');
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const btnPrevStep = document.getElementById('btn-prev-step');
    const btnResetStep = document.getElementById('btn-reset-step');
    const btnConfirm = document.getElementById('btn-confirm-step');
    const typeCards = document.querySelectorAll('.type-card-btn');

    // Логика кастомного выпадающего списка
    (function initMeasureClothingTypeDropdown() {
        if (!typeSelect) return;
        const trigger = document.getElementById('measure-clothing-trigger');
        const valueEl = document.getElementById('measure-clothing-value');
        const menu = document.getElementById('measure-clothing-menu');
        if (!trigger || !valueEl || !menu) return;

        function syncTriggerFromSelect() {
            const selected = typeSelect.selectedOptions?.[0];
            valueEl.textContent = selected?.textContent || '';
        }

        function closeMenu() { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
        function openMenu() { menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); }
        function toggleMenu() { !menu.hidden ? closeMenu() : openMenu(); }

        function rebuildMenuFromSelect() {
            menu.innerHTML = '';
            const currentValue = typeSelect.value;
            for (const opt of typeSelect.options) {
                const el = document.createElement('div');
                el.className = 'body-scan-select-option';
                el.setAttribute('role', 'option');
                el.dataset.value = opt.value;
                el.textContent = opt.textContent || opt.value;
                el.setAttribute('aria-selected', opt.value === currentValue ? 'true' : 'false');
                el.addEventListener('click', () => {
                    typeSelect.value = opt.value;
                    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    syncTriggerFromSelect();
                    rebuildMenuFromSelect();
                    closeMenu();
                });
                menu.appendChild(el);
            }
        }
        trigger.addEventListener('click', toggleMenu);
        document.addEventListener('click', (e) => {
            if (e.target instanceof Node && !menu.contains(e.target) && !trigger.contains(e.target)) closeMenu();
        });
        typeSelect.addEventListener('change', () => { syncTriggerFromSelect(); rebuildMenuFromSelect(); });
        syncTriggerFromSelect(); rebuildMenuFromSelect(); closeMenu();
    })();

    function measureToast(message, type = 'success') {
        const kind = type === 'success' ? 'success' : 'error';
        showToast(message, kind, 2600);
    }

    let img = new Image();
    let scaleFactor = 0; 
    let clicks = [];
    let redoStack = []; 
    let currentStepIndex = 0;
    let a4Zone = { minX: 0, maxX: 0, minY: 0, maxY: 0, active: false };

    // СЦЕНАРИИ
    const SCENARIOS = {
        top: [
            { id: 'a4',    name: 'листа А4', color: '#ff4444', count: 4 },
            { id: 'chest', name: 'ширину груди', color: '#007bff', count: 2 },
            { id: 'waist', name: 'ширину талии', color: '#28a745', count: 2 },
            { id: 'hips',  name: 'ширину бедер', color: '#ffc107', count: 2 },
            { id: 'arm',   name: 'ширину рукава', color: '#17a2b8', count: 2 }
        ],
        bottom: [
            { id: 'a4',    name: 'листа А4', color: '#ff4444', count: 4 },
            { id: 'waist', name: 'ширину пояса', color: '#28a745', count: 2 },
            { id: 'hips',  name: 'ширину бедер', color: '#ffc107', count: 2 },
            { id: 'leg',   name: 'ширину штанины', color: '#17a2b8', count: 2 }
        ],
        dress: [
            { id: 'a4',    name: 'листа А4', color: '#ff4444', count: 4 },
            { id: 'chest', name: 'ширину груди', color: '#007bff', count: 2 },
            { id: 'waist', name: 'ширину талии', color: '#28a745', count: 2 },
            { id: 'hips',  name: 'ширину бедер', color: '#ffc107', count: 2 },
            { id: 'arm',   name: 'ширину рукава', color: '#17a2b8', count: 2 }
        ]
    };

    let activeQueue = [];

    // ОТКРЫТИЕ МОДАЛКИ (ШАГ ВЫБОРА)
    btnOpen.onclick = () => { 
        document.getElementById('measure-modal').style.display = 'flex';
        document.getElementById('step-select-type').style.display = 'block';
        document.getElementById('step-upload').style.display = 'none';
        document.getElementById('step-canvas').style.display = 'none';
        document.querySelector('.measure-header-row .body-scan-select-wrap').style.display = 'none';
        
        // ПРИНУДИТЕЛЬНЫЙ СБРОС ВСЕГО СОСТОЯНИЯ
        fileInput.value = "";
        currentStepIndex = 0;
        clicks = [];
        redoStack = [];
        scaleFactor = 0;
        a4Zone.active = false;
        
        // Прячем и подвал, и сам текст результата
        if (scanFooter) scanFooter.style.visibility = 'hidden';
        if (scanVal && scanVal.parentNode) scanVal.parentNode.style.visibility = 'hidden';
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    
    btnClose.onclick = () => { document.getElementById('measure-modal').style.display = 'none'; };

    typeCards.forEach(card => {
        card.onclick = () => {
            const type = card.getAttribute('data-type');
            typeSelect.value = type;
            typeSelect.dispatchEvent(new Event('change'));
            document.getElementById('step-select-type').style.display = 'none';
            document.getElementById('step-upload').style.display = 'block';
            document.querySelector('.measure-header-row .body-scan-select-wrap').style.display = 'block';
        };
    });

    fileInput.onclick = function() {
        this.value = null;
    };

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            img.onload = () => startSession();
            img.src = ''; // Принудительно очищаем src, чтобы onload сработал 100%
            img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    };

    function startSession() {
        document.getElementById('step-upload').style.display = 'none';
        document.getElementById('step-canvas').style.display = 'block';
        
        const type = typeSelect.value;
        activeQueue = [...SCENARIOS[type]]; 
        currentStepIndex = 0;
        scaleFactor = 0;
        a4Zone.active = false; 

        const maxWidth = 800;
        const ratio = maxWidth / img.width;
        canvas.width = maxWidth;
        canvas.height = img.height * ratio;
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Блок try-catch с getImageData удален, так как он мог прерывать скрипт

        updateUI();
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const step = activeQueue[currentStepIndex];
        const color = step ? step.color : 'white';

        if (currentStepIndex === 0 && clicks.length > 0) {
            ctx.fillStyle = "rgba(255, 68, 68, 0.3)"; 
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(clicks[0].x, clicks[0].y);
            for(let i=1; i<clicks.length; i++) ctx.lineTo(clicks[i].x, clicks[i].y);
            if (clicks.length === 4) ctx.closePath(); 
            ctx.fill();
            ctx.stroke();
        }

        if (a4Zone.active && currentStepIndex > 0) {
             ctx.strokeStyle = "rgba(255, 0, 0, 0.3)";
             ctx.lineWidth = 1;
             ctx.strokeRect(a4Zone.minX, a4Zone.minY, a4Zone.maxX - a4Zone.minX, a4Zone.maxY - a4Zone.minY);
        }

        clicks.forEach((p) => {
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = 'white'; ctx.lineWidth=2; ctx.stroke();
        });
        
        if (currentStepIndex > 0 && clicks.length === 2) {
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(clicks[0].x, clicks[0].y);
            ctx.lineTo(clicks[1].x, clicks[1].y);
            ctx.stroke();
        }
    }

    // НОВАЯ ФУНКЦИЯ: Обновление состояния кнопок
    function updateButtonsState() {
        if (!btnUndo || !btnRedo) return;
        
        // Кнопка "<-" активна только если есть хотя бы 1 поставленная точка
        btnUndo.disabled = (clicks.length === 0);
        
        // Кнопка "->" активна только если в памяти есть отмененные точки
        btnRedo.disabled = (redoStack.length === 0);
    }

    canvas.onclick = (e) => {
        const step = activeQueue[currentStepIndex];
        const maxClicks = step.count;

        if (clicks.length >= maxClicks) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        clicks.push({
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        });
        
        redoStack = []; 
        draw();
        checkResult();
        updateButtonsState(); // Обновляем кнопки после клика
    };

    // Управление кнопками истории (добавлено обновление состояний)
    btnUndo.onclick = () => { 
        if(clicks.length > 0) { redoStack.push(clicks.pop()); draw(); checkResult(); updateButtonsState(); } 
    };
    btnRedo.onclick = () => { 
        if(redoStack.length > 0) { clicks.push(redoStack.pop()); draw(); checkResult(); updateButtonsState(); } 
    };
    btnResetStep.onclick = () => { 
        clicks = []; redoStack = []; draw(); checkResult(); updateButtonsState(); 
    };

    btnPrevStep.onclick = () => {
        if (currentStepIndex > 0) {
            currentStepIndex--;
            if (activeQueue[currentStepIndex].id === 'a4') {
                a4Zone.active = false;
                scaleFactor = 0;
            }
            updateUI();
        } else {
            document.getElementById('step-canvas').style.display = 'none';
            document.getElementById('step-upload').style.display = 'block';
            
            fileInput.value = "";
        }
    };

    btnSkip.onclick = () => { nextStep(); };
    btnConfirm.onclick = () => { applyMeasurement(); nextStep(); };

    function checkResult() {
        const step = activeQueue[currentStepIndex];
        
        // Если поставлены ВСЕ нужные точки
        if (clicks.length === step.count) {
            
            // 1. Показываем подвал с кнопками "Заново" и "Далее"
            if (scanFooter) scanFooter.style.visibility = 'visible';
            
            if (step.id === 'a4') {
                // Для А4 текст не нужен
                if (scanVal && scanVal.parentNode) {
                    scanVal.parentNode.style.visibility = 'hidden';
                }
            } else {
                // Считаем размер
                const dist = Math.hypot(clicks[1].x - clicks[0].x, clicks[1].y - clicks[0].y);
                const safeScale = (scaleFactor && scaleFactor > 0) ? scaleFactor : 1;
                const valCm = (dist / safeScale) * 2;
                
                // Выводим размер и ПОКАЗЫВАЕМ текст
                if (scanVal) {
                    scanVal.innerText = Math.round(valCm);
                    if (scanVal.parentNode) {
                        scanVal.parentNode.style.visibility = 'visible';
                    }
                }
            }
            
        } else {
            // Если точек МЕНЬШЕ нужного (в начале шага или если нажали "отмена")
            // 1. Прячем кнопки
            if (scanFooter) scanFooter.style.visibility = 'hidden';
            
            // 2. Прячем сам текст результата
            if (scanVal && scanVal.parentNode) {
                scanVal.parentNode.style.visibility = 'hidden';
            }
        }
    }

    function applyMeasurement() {
        const step = activeQueue[currentStepIndex];
        if (step.id === 'a4') {
            let maxDist = 0;
            const xs = [], ys = [];
            for (let i = 0; i < clicks.length; i++) {
                const p1 = clicks[i];
                const p2 = clicks[(i + 1) % clicks.length];
                const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (d > maxDist) maxDist = d;
                xs.push(p1.x); ys.push(p1.y);
            }
            scaleFactor = maxDist / 29.7;
            a4Zone = {
                minX: Math.min(...xs), maxX: Math.max(...xs),
                minY: Math.min(...ys), maxY: Math.max(...ys),
                active: true
            };
        } 
        else {
            const val = parseInt(scanVal.innerText);
            if (inputs.cloth && inputs.cloth[step.id]) {
                const input = inputs.cloth[step.id].num;
                input.value = val;
                input.dispatchEvent(new Event('input'));
            }
        }
    }

    function nextStep() {
        currentStepIndex++;
        if (currentStepIndex >= activeQueue.length) {
            showSuccess({ title: 'Готово! Данные перенесены.' });
            document.getElementById('measure-modal').style.display = 'none';
            return;
        }
        updateUI();
    }

    function updateUI() {
        clicks = [];
        redoStack = []; 
        draw();
        
        // Прячем и кнопки, и текст в начале каждого шага
        if (scanFooter) scanFooter.style.visibility = 'hidden';
        if (scanVal && scanVal.parentNode) scanVal.parentNode.style.visibility = 'hidden';
        
        updateButtonsState(); // Обнуляем кнопки
        
        const step = activeQueue[currentStepIndex];
        
        if (step.id === 'a4') {
            instrBadge.innerText = "📌 Нажмите на 4 угла листа А4 на фото";
            btnSkip.style.display = 'none';
            btnPrevStep.innerText = "К загрузке"; 
        } else {
            instrBadge.innerText = `📌 Двумя нажатиями определите ${step.name}`;
            btnSkip.style.display = 'inline-flex';
            btnPrevStep.innerText = "Назад";
        }
        
        instrBadge.style.borderLeftColor = step.color;
    }
})();



/* --- МОДУЛЬ "СКАН ТЕЛА" (MediaPipe Pose) --- */
(function initBodyScan() {
    const btnOpen = document.getElementById('btn-body-scan');
    const modal = document.getElementById('body-scan-modal');
    const btnClose = document.getElementById('close-body-scan');
    const fileInput = document.getElementById('body-image-upload');
    const fileInputSideCanvas = document.getElementById('body-image-side-upload-canvas');
    const canvas = document.getElementById('body-scan-canvas');
    const canvasSide = document.getElementById('body-scan-canvas-side');
    const ctx = canvas ? canvas.getContext('2d') : null;
    const ctxSide = canvasSide ? canvasSide.getContext('2d') : null;
    const summaryEl = document.getElementById('body-scan-summary');
    const adjustHintEl = document.getElementById('body-scan-adjust-hint');
    const btnCompute = document.getElementById('btn-body-compute');
    const btnDone = document.getElementById('btn-body-scan-done');
    const heightInput = document.getElementById('body-scan-height');
    const weightInput = document.getElementById('body-scan-weight');
    const paramsContainer = document.getElementById('body-scan-params');
    const paramInputs = {
        chest: document.getElementById('body-scan-chest'),
        waist: document.getElementById('body-scan-waist'),
        hips: document.getElementById('body-scan-hips'),
        arm: document.getElementById('body-scan-arm'),
        leg: document.getElementById('body-scan-leg')
    };

    if (!btnOpen || !modal || !fileInput || !canvas || !ctx) return;

    let img = new Image();
    let imgSide = new Image();
    let poseLandmarker = null;
    let isProcessing = false;
    let lastLandmarks = null;
    let lastLandmarksSide = null;
    let lastRawValues = {};
    let lastHipsEstimate = null;

    async function ensurePoseLandmarker() {
        if (poseLandmarker) return poseLandmarker;
        try {
            const { FilesetResolver, PoseLandmarker: PoseLandmarkerClass } = await import(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.10/vision_bundle.mjs"
            );
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.10/wasm"
            );
            poseLandmarker = await PoseLandmarkerClass.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task"
                },
                runningMode: "IMAGE",
                numPoses: 1,
                minPoseDetectionConfidence: 0.4,
                minPosePresenceConfidence: 0.4
            });
            return poseLandmarker;
        } catch (err) {
            const n = normalizeNetworkError(err);
            showError({
                title: 'Не удалось загрузить модуль распознавания позы (MediaPipe).',
                help: [
                    ...n.help,
                    'Если у вас блокировщик (AdBlock) — попробуйте отключить его для этой страницы.',
                ],
                technical: n.technical,
            });
            return null;
        }
    }

    const frontPlaceholder = document.getElementById('body-scan-front-placeholder');
    const frontPreview = document.getElementById('body-scan-front-preview');
    const sidePlaceholder = document.getElementById('body-scan-side-placeholder');
    const sidePreviewEl = document.getElementById('body-scan-side-preview');
    const toolbar = document.getElementById('body-scan-toolbar');
    const getDefaultWeightByGender = (gender) => gender === 'female' ? 60 : 70;
    const syncDefaultWeight = (gender, force = false) => {
        if (!weightInput) return;
        const current = String(weightInput.value || '').trim();
        const canReplace = force || current === '' || current === '60' || current === '70';
        if (canReplace) weightInput.value = String(getDefaultWeightByGender(gender));
    };

    btnOpen.onclick = () => {
        modal.style.display = 'flex';
        // demo.html renders modal markup after the script tag, so init dropdown on open.
        ensureBodyScanGenderDropdown();
        ensurePoseLandmarker(); // Предзагрузка модели в фоне
        fileInput.value = "";
        if (fileInputSideCanvas) fileInputSideCanvas.value = "";
        summaryEl.textContent = "";
        if (adjustHintEl) adjustHintEl.style.display = 'none';
        if (btnCompute) btnCompute.style.display = '';
        if (btnDone) btnDone.style.display = 'none';
        if (paramsContainer) paramsContainer.style.display = 'none';
        if (frontPlaceholder) frontPlaceholder.style.display = 'flex';
        if (frontPreview) frontPreview.style.display = 'none';
        if (sidePlaceholder) sidePlaceholder.style.display = 'flex';
        if (sidePreviewEl) sidePreviewEl.style.display = 'none';
        if (toolbar) toolbar.style.display = 'none';
        lastLandmarks = null;
        lastLandmarksSide = null;
        lastRawValues = {};
        lastHipsEstimate = null;
        img.src = '';
        imgSide.src = '';
        if (heightInput) heightInput.value = inputs.body.height.num.value || "175";
        const bodyScanGender = document.getElementById('body-scan-gender');
        const mainGender = getMainGenderValue();
        if (bodyScanGender && mainGenderInputs.length) {
            bodyScanGender.value = mainGender;
            // Important: sync custom dropdown UI + dependent recalculations.
            bodyScanGender.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncDefaultWeight(mainGender, true);
    };

    [heightInput, weightInput].filter(Boolean).forEach((el) => {
        el.addEventListener('input', () => {
            if (lastLandmarks) applyBodyMeasurementsFromPose(lastLandmarks, lastLandmarksSide);
        });
    });
    const bodyScanGender = document.getElementById('body-scan-gender');
    [...mainGenderInputs, bodyScanGender].filter(Boolean).forEach((el) => {
        el.addEventListener('change', () => {
            if (bodyScanGender && mainGenderInputs.includes(el)) {
                bodyScanGender.value = getMainGenderValue();
                // Keep body scan UI in sync when main gender changes.
                bodyScanGender.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const activeGender = bodyScanGender ? bodyScanGender.value : getMainGenderValue();
            syncDefaultWeight(activeGender, false);
            if (lastLandmarks) applyBodyMeasurementsFromPose(lastLandmarks, lastLandmarksSide);
        });
    });

    // Custom dropdown for gender (like VirtualTryOn).
    let bodyScanGenderDropdownInited = false;
    function ensureBodyScanGenderDropdown() {
        if (bodyScanGenderDropdownInited) return;
        const selectEl = document.getElementById('body-scan-gender');
        const trigger = document.getElementById('body-scan-gender-trigger');
        const valueEl = document.getElementById('body-scan-gender-value');
        const menu = document.getElementById('body-scan-gender-menu');
        if (!selectEl || !trigger || !valueEl || !menu) return;

        function syncTriggerFromSelect() {
            const selected = selectEl.selectedOptions?.[0];
            valueEl.textContent = selected?.textContent || '';
        }

        function closeMenu() {
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        }

        function openMenu() {
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
        }

        function toggleMenu() {
            const isOpen = !menu.hidden;
            if (isOpen) closeMenu();
            else openMenu();
        }

        function rebuildMenuFromSelect() {
            menu.innerHTML = '';
            const currentValue = selectEl.value;

            for (const opt of selectEl.options) {
                const el = document.createElement('div');
                el.className = 'body-scan-select-option';
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
                menu.appendChild(el);
            }
        }

        trigger.addEventListener('click', toggleMenu);
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!(t instanceof Node)) return;
            if (menu.contains(t) || trigger.contains(t)) return;
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
        bodyScanGenderDropdownInited = true;
    }

    btnClose.onclick = () => { modal.style.display = 'none'; };
    if (btnDone) btnDone.onclick = () => {
        applyParamsToBody();
        modal.style.display = 'none';
    };

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            img.onload = () => {
                drawBodyImage();
            };
            img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    };

    function onSidePhotoSelected(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            imgSide.onload = () => drawBodyImage();
            imgSide.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    }
    if (fileInputSideCanvas) fileInputSideCanvas.onchange = onSidePhotoSelected;

    if (btnCompute) {
        btnCompute.onclick = async () => {
            if (!img.src) return;
            drawBodyImage();
            await runPose();
        };
    }

    function drawBodyImage() {
        const maxWidth = 280;
        const hasFront = img.src && img.complete && img.naturalWidth > 0;

        if (hasFront) {
            const ratio = Math.min(1, maxWidth / img.width);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            if (frontPlaceholder) frontPlaceholder.style.display = 'none';
            if (frontPreview) frontPreview.style.display = 'flex';
            if (toolbar) toolbar.style.display = 'flex';
        } else {
            if (frontPlaceholder) frontPlaceholder.style.display = 'flex';
            if (frontPreview) frontPreview.style.display = 'none';
            if (toolbar) toolbar.style.display = 'none';
        }

        if (imgSide && imgSide.src && imgSide.complete && imgSide.naturalWidth > 0 && canvasSide && ctxSide) {
            const ratioSide = Math.min(1, maxWidth / imgSide.width);
            canvasSide.width = imgSide.width * ratioSide;
            canvasSide.height = imgSide.height * ratioSide;
            ctxSide.clearRect(0, 0, canvasSide.width, canvasSide.height);
            ctxSide.drawImage(imgSide, 0, 0, canvasSide.width, canvasSide.height);
            if (sidePlaceholder) sidePlaceholder.style.display = 'none';
            if (sidePreviewEl) sidePreviewEl.style.display = 'flex';
        } else {
            if (sidePlaceholder) sidePlaceholder.style.display = 'flex';
            if (sidePreviewEl) sidePreviewEl.style.display = 'none';
        }
    }

    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    const MIN_WIDTH = 150;
    const ANALYZE_MAX_DIM = 512; // Разрешение для MediaPipe (отдельно от превью 280px)

    function createAnalyzeBitmap(imageElement) {
        const w = imageElement.naturalWidth;
        const h = imageElement.naturalHeight;
        const scale = Math.min(1, ANALYZE_MAX_DIM / Math.max(w, h));
        const analyzeW = Math.round(w * scale);
        const analyzeH = Math.round(h * scale);
        const off = document.createElement('canvas');
        off.width = analyzeW;
        off.height = analyzeH;
        off.getContext('2d').drawImage(imageElement, 0, 0, analyzeW, analyzeH);
        return createImageBitmap(off);
    }
    const MIN_HEIGHT = 280;

    function validatePhoto(img) {
        if (!img || !img.naturalWidth || !img.naturalHeight) {
            return { ok: false, error: "Изображение не загружено" };
        }
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w < MIN_WIDTH || h < MIN_HEIGHT) {
            return { ok: false, error: `Фото слишком маленькое. Минимум ${MIN_WIDTH}×${MIN_HEIGHT} px. Сейчас: ${w}×${h}` };
        }
        const minDim = Math.min(w, h);
        const maxDim = Math.max(w, h);
        if (maxDim > minDim * 4) {
            return { ok: false, error: "Фото слишком вытянутое. Используйте кадр с человеком в полный рост." };
        }
        return { ok: true };
    }

    function validateSidePhoto(img) {
        if (!img || !img.src || !img.complete || !img.naturalWidth || !img.naturalHeight) return { ok: true };
        return validatePhoto(img);
    }

    async function runPose() {
        if (isProcessing) return;
        const instr = document.getElementById('body-scan-instruction');
        const realHeightCm = parseFloat(heightInput ? heightInput.value : inputs.body.height.num.value);
        const realWeightKg = parseFloat(weightInput ? weightInput.value : '');
        if (!realHeightCm || realHeightCm <= 0) {
            if (instr) instr.innerText = '⚠️ Укажите рост';
            summaryEl.textContent = "Для скана нужен рост (см).";
            return;
        }
        if (!realWeightKg || realWeightKg <= 0) {
            if (instr) instr.innerText = '⚠️ Укажите вес';
            summaryEl.textContent = "Для скана нужен вес (кг).";
            return;
        }

        const validFront = validatePhoto(img);
        if (!validFront.ok) {
            if (instr) instr.innerText = '⚠️ Проверьте фото';
            summaryEl.textContent = validFront.error;
            return;
        }
        if (imgSide && imgSide.src && imgSide.complete && imgSide.naturalWidth > 0) {
            const validSide = validateSidePhoto(imgSide);
            if (!validSide.ok) {
                if (instr) instr.innerText = '⚠️ Проверьте фото сбоку';
                summaryEl.textContent = validSide.error;
                return;
            }
        }

        isProcessing = true;
        if (btnDone) btnDone.style.display = 'none';
        if (instr) instr.innerText = '⏳ Вычисляем...';
        summaryEl.textContent = "Загружаем MediaPipe…";
        if (loadingOverlay) {
            loadingOverlay.classList.add('active');
            if (loadingText) loadingText.textContent = 'Загружаем MediaPipe…';
        }
        try {
            const detector = await ensurePoseLandmarker();
            if (loadingText) loadingText.textContent = 'Распознаём позу спереди...';
            if (!detector) {
                if (instr) instr.innerText = '📌 Загрузите фото и нажмите кнопку';
                summaryEl.textContent = "Не удалось загрузить MediaPipe Pose. Проверьте интернет и консоль (F12).";
                isProcessing = false;
                if (loadingOverlay) loadingOverlay.classList.remove('active');
                return;
            }
            summaryEl.textContent = `Распознаём позу спереди (${DETECT_PASSES} прохода)...`;
            const pose = await detectPoseMedian(detector, img, DETECT_PASSES);
            if (!pose || pose.length === 0) {
                if (instr) instr.innerText = '📌 Загрузите фото и нажмите кнопку';
                summaryEl.textContent = "Поза не найдена. Попробуйте другое фото (человек в полный рост, фронтально).";
                isProcessing = false;
                if (loadingOverlay) loadingOverlay.classList.remove('active');
                return;
            }
            lastLandmarks = pose;
            lastLandmarksSide = null;
            if (imgSide && imgSide.src && imgSide.complete && imgSide.naturalWidth > 0 && canvasSide && canvasSide.width > 0) {
                if (loadingText) loadingText.textContent = 'Распознаём позу сбоку...';
                summaryEl.textContent = "Распознаём позу сбоку...";
                const poseSide = await detectPoseMedian(detector, imgSide, DETECT_PASSES);
                if (poseSide && poseSide.length > 0) lastLandmarksSide = poseSide;
            }
            if (document.getElementById('body-scan-instruction')) {
                document.getElementById('body-scan-instruction').innerText = '✅ Параметры вычислены';
            }
            applyBodyMeasurementsFromPose(lastLandmarks, lastLandmarksSide);
        } catch (err) {
            showError({
                title: 'Ошибка анализа тела.',
                help: [
                    'Проверьте, что фото в полный рост и человек хорошо виден.',
                    'Попробуйте другое фото (ровный фон, без сильных теней).',
                    'Если ошибка повторяется — обновите страницу.',
                ],
                technical: err && err.message ? err.message : String(err || ''),
            });
            if (document.getElementById('body-scan-instruction')) {
                document.getElementById('body-scan-instruction').innerText = '📌 Загрузите фото и нажмите кнопку';
            }
            summaryEl.textContent = "Ошибка анализа: " + (err.message || "неизвестная ошибка");
        } finally {
            isProcessing = false;
            if (loadingOverlay) loadingOverlay.classList.remove('active');
        }
    }

    function ellipseCircumference(a, b) {
        if (a <= 0 || b <= 0) return 2 * Math.PI * Math.max(a, b);
        return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    }

    /** Коэффициенты по полу (антропометрия): мужчины — более плоский торс, крупнее руки; женщины — округлее, крупнее бёдра */
    function getGenderCoefficients() {
        const bodyScanGender = document.getElementById('body-scan-gender');
        const g = bodyScanGender ? bodyScanGender.value : getMainGenderValue();
        return {
            kBody: g === 'female' ? 1.14 : 1.08,           // торс: женщина круглее
            armLengthToWidth: g === 'female' ? 0.32 : 0.37, // бицепс: мужчина крупнее
            legLengthToWidth: g === 'female' ? 0.34 : 0.30, // бедро: женщина крупнее
            chestDepthFactor: g === 'female' ? 1.06 : 1.0,  // глубина груди (эллипс)
            waistDepthFactor: g === 'female' ? 1.04 : 1.0,
            hipsDepthFactor: g === 'female' ? 1.05 : 1.0
        };
    }

    function clampValue(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function getScanProfile() {
        const bodyScanGender = document.getElementById('body-scan-gender');
        const gender = bodyScanGender ? bodyScanGender.value : getMainGenderValue();
        const heightCm = parseFloat(heightInput ? heightInput.value : inputs.body.height.num.value) || 175;
        const weightKg = parseFloat(weightInput ? weightInput.value : '') || 70;
        const hM = Math.max(1.0, heightCm / 100);
        const bmi = weightKg / (hM * hM);
        const bmiShift = clampValue((bmi - 22) * 0.01, -0.08, 0.14);
        const baseK = gender === 'female'
            ? { chest: 0.8, waist: 0.7, hips: 0.9 }
            : { chest: 0.7, waist: 0.6, hips: 0.75 };
        const k = {
            chest: clampValue(baseK.chest + bmiShift, 0.55, 1.05),
            waist: clampValue(baseK.waist + bmiShift, 0.5, 1.0),
            hips: clampValue(baseK.hips + bmiShift, 0.6, 1.1)
        };
        const stats = gender === 'female'
            ? { chest: 0.56, waist: 0.44, hips: 0.58 }
            : { chest: 0.58, waist: 0.47, hips: 0.55 };
        return { gender, heightCm, weightKg, bmi, k, stats };
    }

    const DETECT_PASSES = 3;

    function aggregateLandmarksMedian(poses) {
        if (!poses || poses.length === 0) return null;
        const targetLen = Math.max(...poses.map((p) => p.length || 0));
        if (!targetLen) return null;
        const out = [];
        for (let i = 0; i < targetLen; i++) {
            const xs = [];
            const ys = [];
            const zs = [];
            const vis = [];
            const prs = [];
            poses.forEach((pose) => {
                const pt = pose[i];
                if (!pt) return;
                if (isFinite(pt.x)) xs.push(pt.x);
                if (isFinite(pt.y)) ys.push(pt.y);
                if (isFinite(pt.z)) zs.push(pt.z);
                if (isFinite(pt.visibility)) vis.push(pt.visibility);
                if (isFinite(pt.presence)) prs.push(pt.presence);
            });
            if (!xs.length || !ys.length) {
                out[i] = null;
                continue;
            }
            out[i] = {
                x: median(xs),
                y: median(ys),
                z: zs.length ? median(zs) : 0
            };
            if (vis.length) out[i].visibility = median(vis);
            if (prs.length) out[i].presence = median(prs);
        }
        return out;
    }

    async function detectPoseMedian(detector, imageElement, passes) {
        const imageBitmap = await createAnalyzeBitmap(imageElement);
        try {
            const candidates = [];
            for (let i = 0; i < passes; i++) {
                const result = await Promise.resolve(detector.detect(imageBitmap));
                const pose = result.landmarks && result.landmarks[0];
                if (pose && pose.length > 0) candidates.push(pose);
            }
            return aggregateLandmarksMedian(candidates);
        } finally {
            imageBitmap.close();
        }
    }

    function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
        const dr = r1 - r2;
        const dg = g1 - g2;
        const db = b1 - b2;
        return dr * dr + dg * dg + db * db;
    }

    function buildForegroundMask(sourceCanvas, sourceCtx, anchor) {
        if (!sourceCanvas || !sourceCtx || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) return null;
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;
        let imageData;
        try {
            imageData = sourceCtx.getImageData(0, 0, w, h);
        } catch (e) {
            return null;
        }
        const data = imageData.data;
        const borderStep = Math.max(2, Math.floor(Math.min(w, h) / 80));
        let sumR = 0, sumG = 0, sumB = 0, n = 0;

        const sample = (x, y) => {
            const i = (y * w + x) * 4;
            sumR += data[i];
            sumG += data[i + 1];
            sumB += data[i + 2];
            n++;
        };

        for (let x = 0; x < w; x += borderStep) {
            sample(x, 0);
            sample(x, h - 1);
        }
        for (let y = borderStep; y < h - borderStep; y += borderStep) {
            sample(0, y);
            sample(w - 1, y);
        }
        if (n === 0) return null;

        const bgR = sumR / n;
        const bgG = sumG / n;
        const bgB = sumB / n;
        const thresholdSq = 45 * 45;

        const rawMask = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const isFg = colorDistanceSq(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB) > thresholdSq;
                if (isFg) rawMask[y * w + x] = 1;
            }
        }

        // Простая морфология для подавления точечного шума/дыр в силуэте.
        const morphPass = (src, minNeighbors) => {
            const out = new Uint8Array(w * h);
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    let count = 0;
                    for (let yy = -1; yy <= 1; yy++) {
                        for (let xx = -1; xx <= 1; xx++) {
                            count += src[(y + yy) * w + (x + xx)];
                        }
                    }
                    out[y * w + x] = count >= minNeighbors ? 1 : 0;
                }
            }
            return out;
        };

        const smoothed = morphPass(morphPass(rawMask, 3), 4);
        const visited = new Uint8Array(w * h);
        const labels = new Int32Array(w * h);
        const components = [];

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                if (smoothed[idx] !== 1 || visited[idx] === 1) continue;
                const queue = [idx];
                visited[idx] = 1;
                let qPos = 0;
                let area = 0;
                let sumX = 0;
                let sumY = 0;
                while (qPos < queue.length) {
                    const cur = queue[qPos++];
                    const cx = cur % w;
                    const cy = Math.floor(cur / w);
                    labels[cur] = components.length + 1;
                    area++;
                    sumX += cx;
                    sumY += cy;
                    const neighbors = [cur - 1, cur + 1, cur - w, cur + w];
                    for (const nb of neighbors) {
                        if (nb < 0 || nb >= w * h) continue;
                        const nx = nb % w;
                        const ny = Math.floor(nb / w);
                        if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
                        if (smoothed[nb] !== 1 || visited[nb] === 1) continue;
                        visited[nb] = 1;
                        queue.push(nb);
                    }
                }
                components.push({
                    label: components.length + 1,
                    area,
                    cx: sumX / Math.max(1, area),
                    cy: sumY / Math.max(1, area)
                });
            }
        }
        if (components.length === 0) return null;

        let best = null;
        for (const comp of components) {
            let score = comp.area;
            if (anchor && isFinite(anchor.x) && isFinite(anchor.y)) {
                const dx = comp.cx - anchor.x;
                const dy = comp.cy - anchor.y;
                const dist = Math.hypot(dx, dy);
                score -= dist * dist * 0.015;
            }
            if (!best || score > best.score) best = { ...comp, score };
        }

        const mask = new Uint8Array(w * h);
        let keptArea = 0;
        for (let i = 0; i < labels.length; i++) {
            if (labels[i] === best.label) {
                mask[i] = 1;
                keptArea++;
            }
        }
        return { mask, width: w, height: h, areaRatio: keptArea / Math.max(1, w * h) };
    }

    function getSpanByCenterCrossing(maskObj, y, expectedCenterX, searchRadius = 0, allowLongestFallback = false) {
        if (!maskObj || !maskObj.mask) return null;
        const w = maskObj.width;
        const h = maskObj.height;
        const yMin = Math.max(0, Math.floor(y - searchRadius));
        const yMax = Math.min(h - 1, Math.ceil(y + searchRadius));
        let best = null;

        for (let yy = yMin; yy <= yMax; yy++) {
            const center = clampValue(Math.round(expectedCenterX), 0, w - 1);
            let pivot = -1;
            for (let dx = 0; dx <= 12; dx++) {
                const xl = center - dx;
                const xr = center + dx;
                if (xl >= 0 && maskObj.mask[yy * w + xl] === 1) { pivot = xl; break; }
                if (xr < w && maskObj.mask[yy * w + xr] === 1) { pivot = xr; break; }
            }
            if (pivot === -1) {
                if (allowLongestFallback) {
                    const longest = getLongestSpanAtY(maskObj, yy, 0);
                    if (longest && longest.len >= 6) {
                        const dev = Math.abs(((longest.x1 + longest.x2) / 2) - expectedCenterX);
                        const candidate = { ...longest, y: yy, centerDeviation: dev };
                        if (!best || candidate.len > best.len || (candidate.len === best.len && candidate.centerDeviation < best.centerDeviation)) {
                            best = candidate;
                        }
                    }
                }
                continue;
            }

            let x1 = pivot;
            let x2 = pivot;
            let gap = 0;
            for (let x = pivot - 1; x >= 0; x--) {
                if (maskObj.mask[yy * w + x] === 1) { x1 = x; gap = 0; } else { gap++; }
                if (gap > 2) break;
            }
            gap = 0;
            for (let x = pivot + 1; x < w; x++) {
                if (maskObj.mask[yy * w + x] === 1) { x2 = x; gap = 0; } else { gap++; }
                if (gap > 2) break;
            }
            const len = x2 - x1 + 1;
            if (len < 6) continue;
            const centerDeviation = Math.abs(((x1 + x2) / 2) - expectedCenterX);
            const candidate = { y: yy, x1, x2, len, centerDeviation };
            if (!best || candidate.len > best.len || (candidate.len === best.len && candidate.centerDeviation < best.centerDeviation)) {
                best = candidate;
            }
        }
        return best;
    }

    function getLongestSpanAtY(maskObj, y, searchRadius = 0) {
        if (!maskObj || !maskObj.mask) return null;
        const w = maskObj.width;
        const h = maskObj.height;
        const yMin = Math.max(0, Math.floor(y - searchRadius));
        const yMax = Math.min(h - 1, Math.ceil(y + searchRadius));
        let best = null;

        for (let yy = yMin; yy <= yMax; yy++) {
            let bestStart = -1;
            let bestEnd = -1;
            let runStart = -1;
            for (let x = 0; x < w; x++) {
                const isFg = maskObj.mask[yy * w + x] === 1;
                if (isFg) {
                    if (runStart === -1) runStart = x;
                } else if (runStart !== -1) {
                    if (bestStart === -1 || (x - runStart) > (bestEnd - bestStart + 1)) {
                        bestStart = runStart;
                        bestEnd = x - 1;
                    }
                    runStart = -1;
                }
            }
            if (runStart !== -1 && (bestStart === -1 || (w - runStart) > (bestEnd - bestStart + 1))) {
                bestStart = runStart;
                bestEnd = w - 1;
            }
            if (bestStart !== -1) {
                const len = bestEnd - bestStart + 1;
                if (!best || len > best.len) {
                    best = { y: yy, x1: bestStart, x2: bestEnd, len };
                }
            }
        }
        return best;
    }

    function isValidDepth(widthCm, depthCm) {
        if (!widthCm || !depthCm || widthCm <= 0 || depthCm <= 0) return false;
        const ratio = depthCm / widthCm;
        return ratio >= 0.45 && ratio <= 1.6;
    }

    function median(values) {
        if (!values || values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
        return sorted[mid];
    }

    function findWaistSpanByTorsoMask(frontMask, leftShoulder, rightShoulder, leftHip, rightHip, minY, maxY) {
        if (!frontMask || !leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
        const h = frontMask.height;
        const w = frontMask.width;

        const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * h;
        const hipY = ((leftHip.y + rightHip.y) / 2) * h;
        if (!isFinite(shoulderY) || !isFinite(hipY) || hipY <= shoulderY + 10) return null;

        // Талия анатомически чаще в средней/нижней части торса, а не сразу под грудью.
        const defaultStart = shoulderY + (hipY - shoulderY) * 0.35;
        const defaultEnd = shoulderY + (hipY - shoulderY) * 0.88;
        const scanStart = Math.max(0, Math.floor(minY != null ? minY : defaultStart));
        const scanEnd = Math.min(h - 1, Math.ceil(maxY != null ? maxY : defaultEnd));
        if (scanEnd <= scanStart) return null;

        const shoulderWidthPx = Math.abs((rightShoulder.x - leftShoulder.x) * w);
        const hipsWidthPx = Math.abs((rightHip.x - leftHip.x) * w);
        const minAllowed = Math.max(10, Math.floor(Math.min(shoulderWidthPx, hipsWidthPx) * 0.38));
        const maxAllowed = Math.max(minAllowed + 1, Math.ceil(Math.max(shoulderWidthPx, hipsWidthPx) * 1.15));

        const shoulderCenterX = ((leftShoulder.x + rightShoulder.x) / 2) * w;
        const hipCenterX = ((leftHip.x + rightHip.x) / 2) * w;
        const leftShoulderX = leftShoulder.x * w;
        const rightShoulderX = rightShoulder.x * w;
        const leftHipX = leftHip.x * w;
        const rightHipX = rightHip.x * w;
        const samples = [];
        for (let y = scanStart; y <= scanEnd; y += 2) {
            const span = getSpanByCenterCrossing(frontMask, y, shoulderCenterX + (hipCenterX - shoulderCenterX) * ((y - shoulderY) / Math.max(1, (hipY - shoulderY))), 1);
            if (!span) continue;
            const t = (y - shoulderY) / Math.max(1, (hipY - shoulderY));
            const expectedCenterX = shoulderCenterX + (hipCenterX - shoulderCenterX) * t;
            const leftTorsoX = leftShoulderX + (leftHipX - leftShoulderX) * t;
            const rightTorsoX = rightShoulderX + (rightHipX - rightShoulderX) * t;
            const expectedWidth = Math.abs(rightTorsoX - leftTorsoX);
            const dynamicMinAllowed = Math.max(minAllowed, Math.floor(expectedWidth * 0.42));
            const dynamicMaxAllowed = Math.min(maxAllowed, Math.ceil(expectedWidth * 1.10));

            if (span.len < dynamicMinAllowed || span.len > dynamicMaxAllowed) continue;
            const spanCenter = (span.x1 + span.x2) / 2;
            const maxCenterDeviation = Math.max(8, expectedWidth * 0.22);
            if (Math.abs(spanCenter - expectedCenterX) > maxCenterDeviation) continue;
            // Кандидат должен лежать в "коридоре" торса, иначе это часто фон/рука.
            if (span.x2 < leftTorsoX - 6 || span.x1 > rightTorsoX + 6) continue;
            const centerScore = clampValue(1 - (Math.abs(spanCenter - expectedCenterX) / Math.max(1, maxCenterDeviation)), 0, 1);
            const widthScore = clampValue(1 - (Math.abs(span.len - expectedWidth) / Math.max(1, expectedWidth * 0.7)), 0, 1);
            span.confidence = 0.45 * centerScore + 0.55 * widthScore;
            samples.push(span);
        }
        if (samples.length < 3) return null;

        // 1) Медианный фильтр по 3 соседним строкам (устранение одиночных выбросов)
        const medianSmoothed = samples.map((sample, idx) => {
            const lengths = [samples[idx].len];
            if (idx > 0) lengths.push(samples[idx - 1].len);
            if (idx < samples.length - 1) lengths.push(samples[idx + 1].len);
            return { sample, len: median(lengths) };
        });

        // 2) Скользящее среднее по 5 строкам (стабилизация минимума талии)
        const halfWindow = 2;
        const averaged = medianSmoothed.map((entry, idx) => {
            let sum = 0;
            let cnt = 0;
            for (let j = idx - halfWindow; j <= idx + halfWindow; j++) {
                if (j < 0 || j >= medianSmoothed.length) continue;
                sum += medianSmoothed[j].len;
                cnt++;
            }
            return { sample: entry.sample, smoothedLen: cnt > 0 ? sum / cnt : entry.len };
        });

        const localMinima = [];
        for (let i = 1; i < averaged.length - 1; i++) {
            if (averaged[i].smoothedLen <= averaged[i - 1].smoothedLen && averaged[i].smoothedLen <= averaged[i + 1].smoothedLen) {
                localMinima.push({ ...averaged[i], idx: i });
            }
        }
        let best = null;
        const candidates = localMinima.length ? localMinima : averaged;
        for (const item of candidates) {
            const around = averaged.filter((_, i) => Math.abs(i - (item.idx != null ? item.idx : averaged.indexOf(item))) <= 2);
            const valleyBand = around.filter(v => v.smoothedLen <= item.smoothedLen * 1.06).length;
            const valleyScore = clampValue(valleyBand / 5, 0, 1);
            const lowerBias = clampValue((item.sample.y - scanStart) / Math.max(1, (scanEnd - scanStart)), 0, 1);
            const score = item.smoothedLen - valleyScore * 8 - lowerBias * 6;
            if (!best || score < best.score) {
                best = { ...item, score, valleyScore };
            }
        }
        if (!best) return null;

        const finalY = best.sample.y;
        const neighborhood = samples.filter((s) => Math.abs(s.y - finalY) <= 2);
        const x1 = median(neighborhood.map((s) => s.x1));
        const x2 = median(neighborhood.map((s) => s.x2));
        const len = Math.max(1, x2 - x1 + 1);

        return {
            y: finalY,
            x1,
            x2,
            len,
            relativeY: finalY / Math.max(1, h - 1),
            confidence: clampValue((best.valleyScore || 0.5) * (best.sample.confidence || 0.7), 0, 1)
        };
    }

    function getMaskVerticalBounds(maskObj) {
        if (!maskObj || !maskObj.mask) return null;
        const { mask, width, height } = maskObj;
        let top = -1;
        let bottom = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (mask[y * width + x] === 1) {
                    top = y;
                    break;
                }
            }
            if (top !== -1) break;
        }
        for (let y = height - 1; y >= 0; y--) {
            for (let x = 0; x < width; x++) {
                if (mask[y * width + x] === 1) {
                    bottom = y;
                    break;
                }
            }
            if (bottom !== -1) break;
        }
        if (top === -1 || bottom === -1 || bottom <= top) return null;
        return { top, bottom, height: bottom - top + 1 };
    }

    function confidenceToColor(confidence) {
        if (!isFinite(confidence)) return '#9e9e9e';
        if (confidence >= 0.75) return '#2e7d32';
        if (confidence >= 0.5) return '#f9a825';
        return '#c62828';
    }

    function drawScanLine(context, y, x1, x2, confidence, label) {
        if (!context || !isFinite(y)) return;
        const hasSpan = isFinite(x1) && isFinite(x2) && x2 > x1;
        const color = confidenceToColor(confidence);
        context.save();
        context.strokeStyle = color;
        context.lineWidth = hasSpan ? 3 : 1.5;
        context.setLineDash(hasSpan ? [] : [5, 4]);
        context.beginPath();
        if (hasSpan) {
            context.moveTo(x1, y);
            context.lineTo(x2, y);
        } else {
            context.moveTo(0, y);
            context.lineTo(context.canvas.width, y);
        }
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = color;
        context.font = '12px sans-serif';
        const pct = isFinite(confidence) ? ` ${Math.round(confidence * 100)}%` : '';
        context.fillText(`${label}${pct}`, hasSpan ? Math.max(4, x1 + 4) : 6, Math.max(14, y - 4));
        context.restore();
    }

    function renderMeasurementOverlay(overlay) {
        if (!overlay || !ctx || !canvas) return;
        drawBodyImage();
        const conf = overlay.confidence || {};
        drawScanLine(ctx, overlay.chestY, overlay.chestSpan ? overlay.chestSpan.x1 : null, overlay.chestSpan ? overlay.chestSpan.x2 : null, conf.chest, 'Грудь');
        drawScanLine(ctx, overlay.waistY, overlay.waistSpan ? overlay.waistSpan.x1 : null, overlay.waistSpan ? overlay.waistSpan.x2 : null, conf.waist, 'Талия');
        drawScanLine(ctx, overlay.hipsY, overlay.hipsSpan ? overlay.hipsSpan.x1 : null, overlay.hipsSpan ? overlay.hipsSpan.x2 : null, conf.hips, 'Бёдра');
    }

    function buildTorsoProfile(frontMask, leftShoulder, rightShoulder, leftHip, rightHip, yStart, yEnd, section = 'torso') {
        const profile = [];
        for (let y = Math.floor(yStart); y <= Math.ceil(yEnd); y += 2) {
            const span = getFrontTorsoSpanAtY(frontMask, y, leftShoulder, rightShoulder, leftHip, rightHip, section);
            if (span) profile.push({ y, span, len: span.len, confidence: span.confidence || 0.6 });
        }
        if (profile.length === 0) return profile;
        for (let i = 0; i < profile.length; i++) {
            let sum = 0;
            let cnt = 0;
            for (let j = i - 2; j <= i + 2; j++) {
                if (j < 0 || j >= profile.length) continue;
                sum += profile[j].len;
                cnt++;
            }
            profile[i].smoothedLen = sum / Math.max(1, cnt);
        }
        return profile;
    }

    function selectSpanFromProfile(profile, minY, maxY, mode) {
        const scoped = profile.filter((p) => p.y >= minY && p.y <= maxY);
        if (scoped.length === 0) return null;
        let best = scoped[0];
        for (const item of scoped) {
            if (mode === 'max') {
                if (item.smoothedLen > best.smoothedLen) best = item;
            } else if (item.smoothedLen < best.smoothedLen) {
                best = item;
            }
        }
        const around = scoped.filter((p) => Math.abs(p.y - best.y) <= 4);
        const stableBand = around.filter((p) => p.smoothedLen >= best.smoothedLen * 0.95).length;
        const peakStable = stableBand >= 2;
        return {
            ...best.span,
            y: best.y,
            relativeY: best.span.relativeY,
            confidence: best.confidence,
            peakStable
        };
    }

    function getFrontTorsoSpanAtY(frontMask, y, leftShoulder, rightShoulder, leftHip, rightHip, section = 'torso') {
        if (!frontMask) return null;
        const h = frontMask.height;
        const w = frontMask.width;
        const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * h;
        const hipY = ((leftHip.y + rightHip.y) / 2) * h;
        const t = clampValue((y - shoulderY) / Math.max(1, (hipY - shoulderY)), 0, 1);
        const shoulderCenterX = ((leftShoulder.x + rightShoulder.x) / 2) * w;
        const hipCenterX = ((leftHip.x + rightHip.x) / 2) * w;
        const leftTorsoX = (leftShoulder.x * w) + ((leftHip.x - leftShoulder.x) * w * t);
        const rightTorsoX = (rightShoulder.x * w) + ((rightHip.x - rightShoulder.x) * w * t);
        const expectedCenterX = shoulderCenterX + (hipCenterX - shoulderCenterX) * t;
        const expectedWidth = Math.max(8, Math.abs(rightTorsoX - leftTorsoX));
        const isHips = section === 'hips';
        const spanCenter = getSpanByCenterCrossing(frontMask, y, expectedCenterX, 2, isHips);
        const spanLongest = getLongestSpanAtY(frontMask, y, 2);
        let span = spanCenter;
        let source = spanCenter ? 'centerCrossing' : 'none';
        let agreementPenalty = 1.0;
        const centerTol = isHips ? 0.2 : 0.15;
        const lenTol = isHips ? 0.28 : 0.22;
        if (spanCenter && spanLongest) {
            const centerA = (spanCenter.x1 + spanCenter.x2) / 2;
            const centerB = (spanLongest.x1 + spanLongest.x2) / 2;
            const lenDelta = Math.abs(spanCenter.len - spanLongest.len) / Math.max(1, Math.max(spanCenter.len, spanLongest.len));
            const centerDelta = Math.abs(centerA - centerB);
            const agree = centerDelta <= Math.max(8, expectedWidth * centerTol) && lenDelta <= lenTol;
            if (agree) {
                span = {
                    ...spanCenter,
                    x1: Math.round((spanCenter.x1 + spanLongest.x1) / 2),
                    x2: Math.round((spanCenter.x2 + spanLongest.x2) / 2),
                    len: Math.round(((spanCenter.x2 + spanLongest.x2) / 2) - ((spanCenter.x1 + spanLongest.x1) / 2) + 1)
                };
                source = 'consensus';
            } else {
                // Консервативно берём более центрированный кандидат и понижаем confidence.
                const devA = Math.abs(centerA - expectedCenterX);
                const devB = Math.abs(centerB - expectedCenterX);
                span = devA <= devB ? spanCenter : spanLongest;
                source = 'disagreeFallback';
                agreementPenalty = isHips ? 0.82 : 0.9;
            }
        } else if (!spanCenter && spanLongest) {
            span = spanLongest;
            source = 'longestFallback';
            agreementPenalty = isHips ? 0.75 : 0.86;
        }

        if (!span) return null;
        const spanCenterX = (span.x1 + span.x2) / 2;
        const centerDeviation = Math.abs(spanCenterX - expectedCenterX);
        const maxCenterDeviation = Math.max(8, expectedWidth * (isHips ? 0.30 : 0.22));
        if (centerDeviation > maxCenterDeviation) return null;
        const minWidthFactor = isHips ? 0.36 : 0.4;
        const maxWidthFactor = isHips ? 1.26 : 1.12;
        if (span.len < expectedWidth * minWidthFactor || span.len > expectedWidth * maxWidthFactor) return null;
        const corridorPad = isHips ? 14 : 6;
        if (span.x2 < leftTorsoX - corridorPad || span.x1 > rightTorsoX + corridorPad) return null;
        const centerScore = clampValue(1 - (centerDeviation / Math.max(1, maxCenterDeviation)), 0, 1);
        const widthScore = clampValue(1 - (Math.abs(span.len - expectedWidth) / Math.max(1, expectedWidth * (isHips ? 0.9 : 0.7))), 0, 1);
        return {
            ...span,
            relativeY: y / Math.max(1, h - 1),
            confidence: (0.45 * centerScore + 0.55 * widthScore) * agreementPenalty,
            source
        };
    }

    function estimateSideDepthCm(sideMask, relY, scaleCmPerPx) {
        if (!sideMask || !scaleCmPerPx) return null;
        const h = sideMask.height;
        const offsets = [0, -0.02, 0.02, -0.04, 0.04];
        const candidates = [];
        for (const off of offsets) {
            const y = clampValue((relY + off) * h, 0, h - 1);
            const span = getSpanByCenterCrossing(sideMask, y, sideMask.width * 0.5, 4, true);
            if (!span || span.len < 6) continue;
            candidates.push({
                depthCm: span.len * scaleCmPerPx,
                absOffset: Math.abs(off),
                offset: off
            });
        }
        if (candidates.length === 0) return null;
        const exact = candidates.find((c) => c.absOffset === 0);
        const medianDepth = median(candidates.map((c) => c.depthCm));
        if (!exact) {
            return { depthCm: medianDepth, source: 'sideNeighborMedian', consistent: false };
        }
        const mismatch = Math.abs(exact.depthCm - medianDepth) / Math.max(1, medianDepth);
        if (mismatch <= 0.18) {
            return { depthCm: exact.depthCm, source: 'sideExact', consistent: true };
        }
        return { depthCm: medianDepth, source: 'sideNeighborMedian', consistent: false };
    }

    function applyBodyMeasurementsFromPose(landmarks, landmarksSide) {
        const toPoint = (lm) => {
            if (!lm) return null;
            const x = lm.x !== undefined ? lm.x : (Array.isArray(lm) ? lm[0] : null);
            const y = lm.y !== undefined ? lm.y : (Array.isArray(lm) ? lm[1] : null);
            return (x != null && y != null) ? { x, y } : null;
        };
        const getPoint = (arr, i) => arr ? toPoint(arr[i]) : null;
        const getPointFront = (i) => getPoint(landmarks, i);
        const distPx = (a, b, cw, ch) => Math.hypot((a.x - b.x) * (cw || canvas.width), (a.y - b.y) * (ch || canvas.height));
        const profile = getScanProfile();
        if (!profile.heightCm || profile.heightCm <= 0 || !profile.weightKg || profile.weightKg <= 0) {
            summaryEl.textContent = "Для расчёта нужны рост, вес и пол.";
            return;
        }

        const leftShoulder = getPointFront(11);
        const rightShoulder = getPointFront(12);
        const leftHip = getPointFront(23);
        const rightHip = getPointFront(24);
        const leftElbow = getPointFront(13);
        const rightElbow = getPointFront(14);
        const leftKnee = getPointFront(25);
        const rightKnee = getPointFront(26);
        if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
            summaryEl.textContent = "Недостаточно ключевых точек торса для поиска сечений.";
            return;
        }

        const torsoAnchor = {
            x: (((leftShoulder.x + rightShoulder.x + leftHip.x + rightHip.x) / 4) * canvas.width),
            y: (((leftShoulder.y + rightShoulder.y + leftHip.y + rightHip.y) / 4) * canvas.height)
        };
        const frontMask = buildForegroundMask(canvas, ctx, torsoAnchor);
        if (!frontMask) {
            summaryEl.textContent = "Не удалось выделить силуэт на фронтальном фото.";
            return;
        }
        const frontBounds = getMaskVerticalBounds(frontMask);
        if (!frontBounds || frontBounds.height < 40) {
            summaryEl.textContent = "Силуэт определён ненадёжно. Проверьте фон и освещение.";
            return;
        }
        const scaleCmPerPx = profile.heightCm / frontBounds.height;
        if (!isFinite(scaleCmPerPx) || scaleCmPerPx <= 0) {
            summaryEl.textContent = "Ошибка масштабирования по росту.";
            return;
        }

        const sideReady = !!(landmarksSide && canvasSide && canvasSide.width > 0 && canvasSide.height > 0);
        const sideMask = sideReady ? buildForegroundMask(canvasSide, ctxSide, { x: canvasSide.width * 0.5, y: canvasSide.height * 0.5 }) : null;
        const sideBounds = sideMask ? getMaskVerticalBounds(sideMask) : null;
        const scaleCmPerPxSide = sideBounds && sideBounds.height > 0 ? profile.heightCm / sideBounds.height : null;

        const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * frontMask.height;
        const hipY = ((leftHip.y + rightHip.y) / 2) * frontMask.height;
        const torsoDelta = Math.max(10, hipY - shoulderY);
        const profileStartY = shoulderY + torsoDelta * 0.08;
        const profileEndY = hipY + torsoDelta * 0.20;
        const torsoProfile = buildTorsoProfile(frontMask, leftShoulder, rightShoulder, leftHip, rightHip, profileStartY, profileEndY, 'torso');
        const hipsProfile = buildTorsoProfile(frontMask, leftShoulder, rightShoulder, leftHip, rightHip, hipY - torsoDelta * 0.08, hipY + torsoDelta * 0.32, 'hips');
        const chestMinY = shoulderY + torsoDelta * 0.10;
        const chestMaxY = shoulderY + torsoDelta * 0.24;
        const hipsMinY = hipY - torsoDelta * 0.06;
        const hipsMaxY = hipY + torsoDelta * 0.26;
        const chestSpan = selectSpanFromProfile(torsoProfile, chestMinY, chestMaxY, 'max');
        let hipSearchSource = 'none';
        let hipSpan = selectSpanFromProfile(hipsProfile, hipsMinY, hipsMaxY, 'max');
        if (!hipSpan) {
            hipSearchSource = 'expandedFallback';
            hipSpan = selectSpanFromProfile(hipsProfile, hipY - torsoDelta * 0.10, hipY + torsoDelta * 0.34, 'max');
        } else {
            hipSearchSource = 'narrowWindow';
        }
        if (hipSpan && !hipSpan.peakStable) hipSearchSource = hipSearchSource + ':unstablePeak';
        const waistStartByChest = chestSpan ? (chestSpan.y + torsoDelta * 0.12) : (shoulderY + torsoDelta * 0.38);
        const waistStartByAnatomy = shoulderY + torsoDelta * 0.36;
        const waistStartY = Math.max(waistStartByChest, waistStartByAnatomy);
        const waistEndByHip = hipSpan ? (hipSpan.y + torsoDelta * 0.04) : (hipY + torsoDelta * 0.14);
        const waistEndY = Math.min(hipY + torsoDelta * 0.20, waistEndByHip);
        const waistSpan = findWaistSpanByTorsoMask(frontMask, leftShoulder, rightShoulder, leftHip, rightHip, waistStartY, waistEndY);

        // Если бедра найдены ненадежно, но талия надежная — оцениваем уровень бедер от талии.
        const waistConf = waistSpan ? (waistSpan.confidence || 0) : 0;
        const hipsConfRaw = hipSpan ? (hipSpan.confidence || 0) : 0;
        const hipsWeak = !hipSpan || hipsConfRaw < 0.45 || (hipSpan.peakStable === false);
        if (waistConf >= 0.72 && hipsWeak) {
            const estHipFromWaistY = clampValue(waistSpan.y + torsoDelta * 0.23, hipY - torsoDelta * 0.05, hipY + torsoDelta * 0.34);
            const hipFromWaistSpan =
                selectSpanFromProfile(hipsProfile, estHipFromWaistY - torsoDelta * 0.09, estHipFromWaistY + torsoDelta * 0.09, 'max') ||
                getFrontTorsoSpanAtY(frontMask, estHipFromWaistY, leftShoulder, rightShoulder, leftHip, rightHip, 'hips');
            if (hipFromWaistSpan) {
                hipSpan = {
                    ...hipFromWaistSpan,
                    confidence: Math.max(hipFromWaistSpan.confidence || 0.4, 0.42),
                    source: 'fromWaistFallback'
                };
                hipSearchSource = 'fromWaistFallback';
            }
        }
        renderMeasurementOverlay({
            chestY: chestSpan ? chestSpan.y : chestMinY,
            waistY: waistSpan ? waistSpan.y : ((waistStartY + waistEndY) / 2),
            hipsY: hipSpan ? hipSpan.y : hipsMaxY,
            chestSpan,
            waistSpan,
            hipsSpan: hipSpan,
            confidence: {
                chest: chestSpan ? chestSpan.confidence : 0,
                waist: waistSpan ? waistSpan.confidence : 0,
                hips: hipSpan ? hipSpan.confidence : 0
            }
        });

        const circFromFront = (span, partKey, relY) => {
            if (!span) return { value: null, method: null, depthSource: 'noSpan', depthConsistent: false };
            const widthCm = span.len * scaleCmPerPx;
            const a = widthCm / 2;
            let b = null;
            let depthSource = 'frontOnlyApprox';
            let depthConsistent = false;
            if (sideMask && scaleCmPerPxSide) {
                const depthInfo = estimateSideDepthCm(sideMask, relY, scaleCmPerPxSide);
                if (depthInfo && isValidDepth(widthCm, depthInfo.depthCm)) {
                    b = depthInfo.depthCm / 2;
                    depthSource = depthInfo.source;
                    depthConsistent = !!depthInfo.consistent;
                } else if (depthInfo) {
                    depthSource = 'sideDepthInvalid';
                }
            }
            if (b == null) {
                b = profile.k[partKey] * a;
                return { value: ellipseCircumference(a, b), method: 'approx', depthSource, depthConsistent };
            }
            return { value: ellipseCircumference(a, b), method: 'ellipse', depthSource, depthConsistent };
        };

        const blendWithStats = (geomValue, partKey, method) => {
            if (geomValue == null) return null;
            const statValue = profile.stats[partKey] * profile.heightCm;
            const alpha = method === 'ellipse' ? 0.78 : 0.64;
            return alpha * geomValue + (1 - alpha) * statValue;
        };

        const applySanity = (value, partKey) => {
            if (value == null) return { value: null, lowConfidence: true };
            const ranges = {
                chest: [0.35 * profile.heightCm, 0.78 * profile.heightCm],
                waist: [0.30 * profile.heightCm, 0.70 * profile.heightCm],
                hips: [0.35 * profile.heightCm, 0.80 * profile.heightCm]
            };
            const [min, max] = ranges[partKey] || [0, 999];
            const clamped = clampValue(value, min, max);
            return { value: clamped, lowConfidence: clamped !== value };
        };

        const c = getGenderCoefficients();
        let chest = null, waist = null, hips = null, arm = null, leg = null;
        const methods = { chest: null, waist: null, hips: null, arm: null, leg: null };
        const lowConfidence = { chest: false, waist: false, hips: false };
        const sectionConfidence = { chest: 0, waist: 0, hips: 0 };
        const qualityReasons = { chest: [], waist: [], hips: [] };

        const chestGeom = circFromFront(chestSpan, 'chest', chestSpan ? chestSpan.relativeY : 0.3);
        const waistGeom = circFromFront(waistSpan, 'waist', waistSpan ? waistSpan.relativeY : 0.5);
        const hipsGeom = circFromFront(hipSpan, 'hips', hipSpan ? hipSpan.relativeY : 0.7);
        methods.chest = chestGeom.method;
        methods.waist = waistGeom.method;
        methods.hips = hipsGeom.method;
        let chestBlended = blendWithStats(chestGeom.value, 'chest', methods.chest);
        let waistBlended = blendWithStats(waistGeom.value, 'waist', methods.waist);
        let hipsBlended = blendWithStats(hipsGeom.value, 'hips', methods.hips);
        let chestFallbackUsed = false;
        let waistFallbackUsed = false;
        let hipsFallbackUsed = false;

        // Fallback: если бедра не определились, но грудь и талия надежные — оцениваем hips от waist+chest.
        const chestBaseConf = chestSpan ? (chestSpan.confidence || 0) : 0;
        const waistBaseConf = waistSpan ? (waistSpan.confidence || 0) : 0;
        if ((hipsBlended == null || !isFinite(hipsBlended)) &&
            chestBlended != null &&
            waistBlended != null &&
            chestBaseConf >= 0.72 &&
            waistBaseConf >= 0.72) {
            const bmiAdj = clampValue((profile.bmi - 22) * 0.004, -0.03, 0.06);
            const waistRatioBase = profile.gender === 'female' ? 1.10 : 1.04;
            const chestRatioBase = profile.gender === 'female' ? 1.00 : 0.95;
            const hipsFromWaist = waistBlended * (waistRatioBase + bmiAdj);
            const hipsFromChest = chestBlended * (chestRatioBase + bmiAdj * 0.5);
            hipsBlended = 0.72 * hipsFromWaist + 0.28 * hipsFromChest;
            hipsFallbackUsed = true;
            methods.hips = 'statFallback';
            hipSearchSource = hipSearchSource === 'none'
                ? 'waistChestStatFallback'
                : `${hipSearchSource}+waistChestStatFallback`;
        }

        // Аналогичный fallback для груди: если грудь не определилась, оцениваем из талии и бедер.
        if ((chestBlended == null || !isFinite(chestBlended)) &&
            waistBlended != null &&
            hipsBlended != null &&
            waistBaseConf >= 0.68) {
            const bmiAdj = clampValue((profile.bmi - 22) * 0.0035, -0.02, 0.05);
            const chestFromWaist = waistBlended * (profile.gender === 'female' ? 1.12 : 1.16) + bmiAdj * 40;
            const chestFromHips = hipsBlended * (profile.gender === 'female' ? 0.96 : 1.00);
            chestBlended = 0.62 * chestFromWaist + 0.38 * chestFromHips;
            chestFallbackUsed = true;
            methods.chest = 'statFallback';
        }

        // Аналогичный fallback для талии: если талия не определилась, оцениваем из груди и бедер.
        if ((waistBlended == null || !isFinite(waistBlended)) &&
            chestBlended != null &&
            hipsBlended != null &&
            chestBaseConf >= 0.68) {
            const bmiAdj = clampValue((profile.bmi - 22) * 0.003, -0.02, 0.05);
            const waistFromChest = chestBlended * (profile.gender === 'female' ? 0.80 : 0.88);
            const waistFromHips = hipsBlended * (profile.gender === 'female' ? 0.72 : 0.80);
            waistBlended = 0.56 * waistFromChest + 0.44 * waistFromHips + bmiAdj * 30;
            waistFallbackUsed = true;
            methods.waist = 'statFallback';
        }
        const chestChecked = applySanity(chestBlended, 'chest');
        const waistChecked = applySanity(waistBlended, 'waist');
        const hipsChecked = applySanity(hipsBlended, 'hips');
        chest = chestChecked.value;
        waist = waistChecked.value;
        hips = hipsChecked.value;
        lowConfidence.chest = chestChecked.lowConfidence || !methods.chest;
        lowConfidence.waist = waistChecked.lowConfidence || !methods.waist;
        lowConfidence.hips = hipsChecked.lowConfidence || !methods.hips;
        sectionConfidence.chest = clampValue((chestSpan ? chestSpan.confidence || 0.6 : 0.25) * (methods.chest === 'ellipse' ? 1 : 0.82), 0, 1);
        sectionConfidence.waist = clampValue((waistSpan ? waistSpan.confidence || 0.55 : 0.2) * (methods.waist === 'ellipse' ? 1 : 0.8), 0, 1);
        sectionConfidence.hips = clampValue((hipSpan ? hipSpan.confidence || 0.6 : 0.25) * (methods.hips === 'ellipse' ? 1 : 0.82), 0, 1);
        if (chestFallbackUsed) {
            sectionConfidence.chest = clampValue((sectionConfidence.waist * 0.55 + sectionConfidence.hips * 0.45) * 0.74, 0, 1);
            lowConfidence.chest = true;
        }
        if (waistFallbackUsed) {
            sectionConfidence.waist = clampValue((sectionConfidence.chest * 0.58 + sectionConfidence.hips * 0.42) * 0.74, 0, 1);
            lowConfidence.waist = true;
        }
        if (hipsFallbackUsed) {
            sectionConfidence.hips = clampValue((sectionConfidence.chest * 0.55 + sectionConfidence.waist * 0.45) * 0.76, 0, 1);
            lowConfidence.hips = true;
        }
        if (methods.hips === 'ellipse' && !hipsGeom.depthConsistent) {
            sectionConfidence.hips = sectionConfidence.hips * 0.86;
        }

        // Sanity-check: бедра обычно не меньше талии (с небольшим допуском) и не должны резко прыгать между пересчётами.
        if (hips != null && waist != null && hips < (waist - 2)) {
            hips = waist - 2;
            lowConfidence.hips = true;
            qualityReasons.hips.push('hips<waist, применен sanity clamp');
        }
        if (hips != null && lastHipsEstimate != null) {
            const maxJump = Math.max(6, lastHipsEstimate * 0.12);
            const delta = hips - lastHipsEstimate;
            if (Math.abs(delta) > maxJump) {
                hips = lastHipsEstimate + Math.sign(delta) * maxJump;
                lowConfidence.hips = true;
                qualityReasons.hips.push('резкий скачок, применено ограничение delta');
            }
        }
        if (hips != null) lastHipsEstimate = hips;
        if (!chestSpan) qualityReasons.chest.push('сечение не найдено');
        if (!waistSpan) qualityReasons.waist.push('сечение не найдено');
        if (!hipSpan) qualityReasons.hips.push('сечение не найдено');
        if (methods.chest === 'approx') qualityReasons.chest.push('нет валидной глубины профиля');
        if (methods.waist === 'approx') qualityReasons.waist.push('нет валидной глубины профиля');
        if (methods.hips === 'approx') qualityReasons.hips.push('нет валидной глубины профиля');
        if (methods.chest === 'statFallback') qualityReasons.chest.push('грудь оценена по waist+hips fallback');
        if (methods.waist === 'statFallback') qualityReasons.waist.push('талия оценена по chest+hips fallback');
        if (methods.hips === 'statFallback') qualityReasons.hips.push('hips оценены по waist+chest fallback');
        if (hipSpan && !hipSpan.peakStable) qualityReasons.hips.push('нет стабильного пика по y');
        if (hipSpan && hipSpan.source === 'disagreeFallback') qualityReasons.hips.push('center/longest расходятся');
        if (hipSpan && hipSpan.source === 'fromWaistFallback') qualityReasons.hips.push('уровень бедер оценен от талии');
        if (hipsGeom.depthSource === 'sideNeighborMedian') qualityReasons.hips.push('глубина взята по медиане соседних уровней');
        if (hipsGeom.depthSource === 'sideDepthInvalid') qualityReasons.hips.push('профильная глубина невалидна');
        if (chestChecked.lowConfidence) qualityReasons.chest.push('значение вне диапазона, применен clamp');
        if (waistChecked.lowConfidence) qualityReasons.waist.push('значение вне диапазона, применен clamp');
        if (hipsChecked.lowConfidence) qualityReasons.hips.push('значение вне диапазона, применен clamp');
        if (sectionConfidence.chest < 0.55) qualityReasons.chest.push('нестабильная геометрия');
        if (sectionConfidence.waist < 0.55) qualityReasons.waist.push('нестабильная геометрия');
        if (sectionConfidence.hips < 0.55) qualityReasons.hips.push('нестабильная геометрия');

        renderMeasurementOverlay({
            chestY: chestSpan ? chestSpan.y : chestMinY,
            waistY: waistSpan ? waistSpan.y : ((waistStartY + waistEndY) / 2),
            hipsY: hipSpan ? hipSpan.y : hipsMaxY,
            chestSpan,
            waistSpan,
            hipsSpan: hipSpan,
            confidence: sectionConfidence
        });

        const pxPerCm = 1 / scaleCmPerPx;
        const pxPerCmSide = scaleCmPerPxSide ? (1 / scaleCmPerPxSide) : pxPerCm;

        if (leftShoulder && leftElbow) {
            const upperArmPx = distPx(leftShoulder, leftElbow);
            const armWidthCm = (upperArmPx / pxPerCm) * c.armLengthToWidth;
            if (sideMask && scaleCmPerPxSide) {
                const armDepthCm = armWidthCm * 0.7;
                arm = ellipseCircumference(armWidthCm / 2, Math.max(armDepthCm / 2, armWidthCm * 0.3));
                methods.arm = 'ellipse';
            } else {
                arm = armWidthCm * Math.PI;
                methods.arm = 'approx';
            }
        } else if (rightShoulder && rightElbow) {
            const upperArmPx = distPx(rightShoulder, rightElbow);
            const armWidthCm = (upperArmPx / pxPerCm) * c.armLengthToWidth;
            if (sideMask && scaleCmPerPxSide) {
                const armDepthCm = armWidthCm * 0.7;
                arm = ellipseCircumference(armWidthCm / 2, Math.max(armDepthCm / 2, armWidthCm * 0.3));
                methods.arm = 'ellipse';
            } else {
                arm = armWidthCm * Math.PI;
                methods.arm = 'approx';
            }
        }
        if (arm == null || !isFinite(arm)) {
            const armBase = (profile.gender === 'female' ? 0.16 : 0.17) * profile.heightCm;
            const armAdj = ((chest || 92) - 92) * 0.08 + ((waist || 80) - 80) * 0.05 + (profile.bmi - 22) * 0.35;
            arm = clampValue(armBase + armAdj, 20, 60);
            methods.arm = 'statFallback';
        }

        if (leftHip && leftKnee) {
            const thighPx = distPx(leftHip, leftKnee);
            const legWidthCm = (thighPx / pxPerCm) * c.legLengthToWidth;
            if (sideMask && scaleCmPerPxSide) {
                const legDepthCm = legWidthCm * 0.8;
                leg = ellipseCircumference(legWidthCm / 2, Math.max(legDepthCm / 2, legWidthCm * 0.3));
                methods.leg = 'ellipse';
            } else {
                leg = legWidthCm * Math.PI;
                methods.leg = 'approx';
            }
        } else if (rightHip && rightKnee) {
            const thighPx = distPx(rightHip, rightKnee);
            const legWidthCm = (thighPx / pxPerCm) * c.legLengthToWidth;
            if (sideMask && scaleCmPerPxSide) {
                const legDepthCm = legWidthCm * 0.8;
                leg = ellipseCircumference(legWidthCm / 2, Math.max(legDepthCm / 2, legWidthCm * 0.3));
                methods.leg = 'ellipse';
            } else {
                leg = legWidthCm * Math.PI;
                methods.leg = 'approx';
            }
        }
        if (leg == null || !isFinite(leg)) {
            const legBase = (profile.gender === 'female' ? 0.30 : 0.285) * profile.heightCm;
            const legAdj = ((hips || 98) - 98) * 0.10 + (profile.bmi - 22) * 0.5;
            leg = clampValue(legBase + legAdj, 40, 90);
            methods.leg = 'statFallback';
        }

        lastRawValues = {};
        if (chest != null) lastRawValues.chest = chest;
        if (waist != null) lastRawValues.waist = waist;
        if (hips != null) lastRawValues.hips = hips;
        if (arm != null) lastRawValues.arm = arm;
        if (leg != null) lastRawValues.leg = leg;

        const parts = [];
        if (paramInputs.chest) { paramInputs.chest.value = chest != null ? Math.round(chest) : ''; if (chest) parts.push('chest'); }
        if (paramInputs.waist) { paramInputs.waist.value = waist != null ? Math.round(waist) : ''; if (waist) parts.push('waist'); }
        if (paramInputs.hips)  { paramInputs.hips.value  = hips  != null ? Math.round(hips)  : ''; if (hips)  parts.push('hips');  }
        if (paramInputs.arm)  { paramInputs.arm.value   = arm   != null ? Math.round(arm)   : ''; if (arm)   parts.push('arm');   }
        if (paramInputs.leg)  { paramInputs.leg.value   = leg   != null ? Math.round(leg)   : ''; if (leg)   parts.push('leg');   }

        if (paramsContainer) paramsContainer.style.display = parts.length > 0 ? 'flex' : 'none';
        const labels = {
            chest: 'грудь',
            waist: 'талия',
            hips: 'бёдра',
            arm: 'бицепс',
            leg: 'ногу'
        };
        const missingParts = Object.keys(labels).filter((key) => !parts.includes(key));
        if (missingParts.length > 0) {
            summaryEl.textContent = `Не удалось определить обхваты: ${missingParts.map((k) => labels[k]).join(', ')}.\nСовет: сфотографируйтесь в полный рост, встаньте прямо, сделайте более ровное освещение и выберите нейтральный фон без лишних объектов.`;
        } else {
            summaryEl.textContent = "";
        }
        if (adjustHintEl) adjustHintEl.style.display = parts.length > 0 ? 'inline' : 'none';
        if (btnCompute) btnCompute.style.display = parts.length > 0 ? 'none' : '';
        if (btnDone) btnDone.style.display = parts.length > 0 ? 'block' : 'none';
    }

    function applyParamsToBody() {
        const h = parseFloat(heightInput ? heightInput.value : 0) || parseFloat(inputs.body.height.num.value) || 175;
        inputs.body.height.num.value = Math.round(h);
        inputs.body.height.range.value = Math.round(h);
        const bodyScanGenderEl = document.getElementById('body-scan-gender');
        if (bodyScanGenderEl && mainGenderInputs.length && bodyScanGenderEl.value !== getMainGenderValue()) {
            setMainGenderValue(bodyScanGenderEl.value);
            if (typeof loadModel === 'function') loadModel(bodyScanGenderEl.value);
        }
        const set = (key, el) => {
            const v = el && el.value ? parseInt(el.value, 10) : null;
            if (v != null && !isNaN(v) && inputs.body[key]) {
                inputs.body[key].num.value = v;
                inputs.body[key].range.value = v;
            }
        };
        set('chest', paramInputs.chest);
        set('waist', paramInputs.waist);
        set('hips', paramInputs.hips);
        set('arm', paramInputs.arm);
        set('leg', paramInputs.leg);
        Object.values(inputs.body).forEach(pair => {
            if (pair && pair.num) pair.num.dispatchEvent(new Event('input'));
        });
    }
})();

