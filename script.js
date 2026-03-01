/* CLEAN & FIXED SCRIPT.JS */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- СЦЕНА ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe0e0e0);
scene.fog = new THREE.Fog(0xe0e0e0, 5, 20);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 100);
camera.position.set(0, 1.1, 3.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
document.getElementById('canvas-container').appendChild(renderer.domElement);

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


// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
let humanMesh = null;
let bonesList = [];
let modelRoot = null;
let currentGender = 'male';

const MEASUREMENTS = {
    male: {
        base: { chest: 96, waist: 82, hips: 100, arm: 32, leg: 55 },
        fat:  { chest: 128, waist: 130, hips: 126, arm: 45, leg: 75 }
    },
    female: {
        base: { chest: 86, waist: 68, hips: 94, arm: 28, leg: 52 },
        fat:  { chest: 115, waist: 100, hips: 120, arm: 40, leg: 72 }
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
    const filename = (gender === 'male') ? './male_advanced.glb' : './female_advanced.glb';

    loader.load(filename, function (gltf) {
        modelRoot = gltf.scene;
        modelRoot.rotation.set(0, 0, 0); 

        scene.add(modelRoot);
        modelRoot.updateMatrixWorld(true);

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

    }, undefined, function(e) { console.error(e); });
}

loadModel('male');


// --- UI МЕНЕДЖЕР ---
const genderSelect = document.getElementById('gender-select');
if(genderSelect) genderSelect.addEventListener('change', (e) => loadModel(e.target.value));

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

    const update = () => {
        if(range.value !== num.value) num.value = range.value;
        updateAll();
    };
    const updateNum = () => {
        if(range.value !== num.value) range.value = num.value;
        updateAll();
    };

    range.addEventListener('input', update);
    num.addEventListener('input', updateNum);
    
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
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', onWindowResize);

// ПРИНУДИТЕЛЬНЫЙ ВЫЗОВ (чтобы убрать белые полосы при старте)
onWindowResize();


/* --- МОДУЛЬ "УМНАЯ ЛИНЕЙКА V2" (AUTO-DETECT) --- */
(function initMeasureTool() {
    const modal = document.getElementById('measure-modal');
    const btnOpen = document.getElementById('btn-measure-tool');
    const btnClose = document.getElementById('close-modal');
    const fileInput = document.getElementById('image-upload');
    const typeSelect = document.getElementById('clothing-type-selector');
    
    // Элементы шага Canvas
    const canvas = document.getElementById('measure-canvas');
    const ctx = canvas.getContext('2d');
    const instrBadge = document.getElementById('instruction-badge');
    const scanFooter = document.getElementById('scan-footer');
    const scanVal = document.getElementById('scan-val');
    
    // Кнопки
    const btnAuto = document.getElementById('btn-auto-detect');
    const btnSkip = document.getElementById('btn-skip-step');
    const btnUndo = document.getElementById('btn-undo');
    const btnConfirm = document.getElementById('btn-confirm-step');

    let img = new Image();
    let imgData = null; // Для анализа пикселей

    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    document.querySelector('.modal-content').appendChild(toast);

    function showToast(message, type = 'success') {
        const icon = type === 'success' ? '✅' : '⚠️';
        toast.innerHTML = `<span>$${icon}</span> $${message}`;
        toast.classList.add('show');
        
        // Скрываем через 2 секунды
        setTimeout(() => {
            toast.classList.remove('show');
        }, 2500);
    }
    
    // Состояние
    let scaleFactor = 0; // px_per_cm
    let clicks = [];
    let currentStepIndex = 0;
    
    // Сценарий замеров (очередь)
    const SCENARIOS = {
        top: [
            { id: 'a4',    name: 'A4 (Длинная сторона)', color: '#ff4444' }, // Красный
            { id: 'chest', name: 'Ширина ГРУДИ',         color: '#007bff' }, // Синий
            { id: 'waist', name: 'Ширина ТАЛИИ',         color: '#28a745' }, // Зеленый
            { id: 'hips',  name: 'Ширина БЕДЕР (Низ)',   color: '#ffc107' }  // Желтый
        ],
        bottom: [
            { id: 'a4',    name: 'A4 (Масштаб)',         color: '#ff4444' },
            { id: 'waist', name: 'Ширина ПОЯСА',         color: '#28a745' },
            { id: 'hips',  name: 'Ширина БЕДЕР',         color: '#ffc107' },
            { id: 'leg',   name: 'Ширина ШТАНИНЫ',       color: '#17a2b8' }
        ],
        dress: [/* ... аналогично ... */]
    };
    if(!SCENARIOS.dress) SCENARIOS.dress = SCENARIOS.top; // Копия

    let activeQueue = [];

    // --- ОТКРЫТИЕ ---
    btnOpen.onclick = () => { 
        modal.style.display = 'flex'; 
        document.getElementById('step-upload').style.display = 'flex';
        document.getElementById('step-canvas').style.display = 'none';
        fileInput.value = "";
    };
    btnClose.onclick = () => { modal.style.display = 'none'; };

    // --- ЗАГРУЗКА ---
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            img.onload = () => {
                startSession();
            };
            img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    };

    function startSession() {
        document.getElementById('step-upload').style.display = 'none';
        document.getElementById('step-canvas').style.display = 'block';
        
        // Определяем очередь шагов
        const type = typeSelect.value;
        activeQueue = [...SCENARIOS[type]]; 
        currentStepIndex = 0;
        scaleFactor = 0;

        // Подгонка канваса
        const maxWidth = 800;
        const ratio = maxWidth / img.width;
        canvas.width = maxWidth;
        canvas.height = img.height * ratio;
        
        // Рисуем в буфер для анализа
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
            imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch(e) { console.warn("CORS issue with image analysis"); }

        updateUI();
    }

    // --- РИСОВАНИЕ ---
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const step = activeQueue[currentStepIndex];
        const color = step ? step.color : 'white';

        // Рисуем точки
        ctx.lineWidth = 3;
        
        clicks.forEach((p, i) => {
            // Точка
            ctx.fillStyle = color;
            ctx.beginPath(); 
            ctx.arc(p.x, p.y, 6, 0, Math.PI*2); 
            ctx.fill();
            // Обводка для контраста
            ctx.strokeStyle = 'white';
            ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.stroke();

            // Линия между точками
            if (i > 0) {
                ctx.strokeStyle = color;
                ctx.beginPath();
                ctx.moveTo(clicks[i-1].x, clicks[i-1].y);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
        });
    }

    // --- КЛИКИ ---
    canvas.onclick = (e) => {
        if (clicks.length >= 2) return; // Больше 2 точек не надо

        const rect = canvas.getBoundingClientRect();
        // Учет масштабирования CSS
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        clicks.push({
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        });
        
        draw();
        checkResult();
    };

    btnUndo.onclick = () => { clicks.pop(); draw(); checkResult(); };
    
    btnSkip.onclick = () => { nextStep(); };

    btnConfirm.onclick = () => {
        applyMeasurement();
        nextStep();
    };

    btnAuto.onclick = () => {
        if (!imgData) return showToast("Картинка не проанализирована", "error");

        // 1. Визуальный эффект "Думаю..."
        const btnText = btnAuto.innerText;
        btnAuto.innerText = "Ищу края...";
        btnAuto.classList.add("spinning"); // Добавляем CSS спиннер
        btnAuto.disabled = true;

        // Делаем задержку 600мс, чтобы пользователь увидел процесс
        setTimeout(() => {
            try {
                runAutoDetect();
            } catch (e) {
                console.error(e);
                showToast("Ошибка алгоритма", "error");
            } finally {
                // Возвращаем кнопку в исходное состояние
                btnAuto.innerText = btnText;
                btnAuto.classList.remove("spinning");
                btnAuto.disabled = false;
            }
        }, 600); // 600мс задержки
    };

    // Сама математика вынесена в отдельную функцию
    function runAutoDetect() {
        const w = canvas.width;
        const h = canvas.height;
        const step = activeQueue[currentStepIndex];

        // Координата Y
        let scanY = Math.floor(h * 0.5); 
        if (step.id === 'chest') scanY = Math.floor(h * 0.35);
        else if (step.id === 'waist') scanY = Math.floor(h * 0.55);
        else if (step.id === 'hips')  scanY = Math.floor(h * 0.75);
        else if (step.id === 'a4') scanY = Math.floor(h * 0.5);

        const getBrightness = (x, y) => {
            const i = (y * w + x) * 4;
            return (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
        };

        const bgLeft = getBrightness(5, scanY);
        const bgRight = getBrightness(w - 5, scanY);
        const threshold = 20; // Чувствительность

        let leftX = 20;
        let rightX = w - 20;
        let foundLeft = false;
        let foundRight = false;

        // Поиск слева
        for (let x = 10; x < w / 2; x++) {
            if (Math.abs(getBrightness(x, scanY) - bgLeft) > threshold) {
                leftX = x;
                foundLeft = true;
                break;
            }
        }
        // Поиск справа
        for (let x = w - 10; x > w / 2; x--) {
            if (Math.abs(getBrightness(x, scanY) - bgRight) > threshold) {
                rightX = x;
                foundRight = true;
                break;
            }
        }

        // --- ДИАГНОСТИКА И РЕЗУЛЬТАТ ---
        if (foundLeft && foundRight) {
            // Успех!
            clicks = [ { x: leftX, y: scanY }, { x: rightX, y: scanY } ];
            draw();
            checkResult();
            
            // Считаем разницу, чтобы показать в уведомлении
            const distPx = rightX - leftX;
            showToast(`Края найдены! Ширина: $${distPx}px`, "success");
        } 
        else {
            // Неудача
            showToast("Контраст не найден. Укажите вручную.", "error");
            
            // На всякий случай ставим дефолт
            clicks = [ { x: w*0.3, y: scanY }, { x: w*0.7, y: scanY } ];
            draw();
            checkResult();
        }
    }



    function checkResult() {
        if (clicks.length === 2) {
            const dist = Math.hypot(clicks[1].x - clicks[0].x, clicks[1].y - clicks[0].y);
            let valCm = 0;

            if (currentStepIndex === 0) {
                // Это калибровка (A4 = 29.7 см)
                valCm = 29.7;
            } else {
                // Измерение
                if (scaleFactor === 0) return; // Ошибка
                valCm = (dist / scaleFactor) * 2; // *2 для обхвата
            }

            scanVal.innerText = Math.round(valCm);
            scanFooter.style.visibility = 'visible';
        } else {
            scanFooter.style.visibility = 'hidden';
        }
    }

    function applyMeasurement() {
        const step = activeQueue[currentStepIndex];
        const val = parseInt(scanVal.innerText);

        if (step.id === 'a4') {
            // Сохраняем масштаб
            const distPx = Math.hypot(clicks[1].x - clicks[0].x, clicks[1].y - clicks[0].y);
            scaleFactor = distPx / 29.7;
            console.log("Масштаб установлен:", scaleFactor);
        } 
        else {
            // Применяем к ползунку
            const input = inputs.cloth[step.id]; // Получаем пару {range, num}
            if (input && input.num) {
                input.num.value = val;
                // Триггерим событие, чтобы обновилось 3D
                input.num.dispatchEvent(new Event('input'));
            }
        }
    }

    function nextStep() {
        currentStepIndex++;
        if (currentStepIndex >= activeQueue.length) {
            alert("Замеры завершены!");
            modal.style.display = 'none';
            return;
        }
        updateUI();
    }

    function updateUI() {
        clicks = [];
        draw();
        scanFooter.style.visibility = 'hidden';
        
        const step = activeQueue[currentStepIndex];
        instrBadge.innerText = `📌 Шаг $${currentStepIndex + 1}: $${step.name}`;
        instrBadge.style.borderLeftColor = step.color;
        instrBadge.style.color = step.color === '#ffffff' ? '#333' : '#333';
        
        // Auto кнопка доступна только для одежды, не для A4
        btnAuto.disabled = (step.id === 'a4');
        btnAuto.style.opacity = (step.id === 'a4') ? 0.5 : 1;
    }

})();


/* --- МОДУЛЬ "СКАН ТЕЛА" (MediaPipe Pose) --- */
(function initBodyScan() {
    const btnOpen = document.getElementById('btn-body-scan');
    const modal = document.getElementById('body-scan-modal');
    const btnClose = document.getElementById('close-body-scan');
    const fileInput = document.getElementById('body-image-upload');
    const fileInputSide = document.getElementById('body-image-side-upload');
    const fileInputSideCanvas = document.getElementById('body-image-side-upload-canvas');
    const canvas = document.getElementById('body-scan-canvas');
    const canvasSide = document.getElementById('body-scan-canvas-side');
    const sidePreview = document.getElementById('body-scan-side-preview');
    const sideUpload = document.getElementById('body-scan-side-upload');
    const ctx = canvas ? canvas.getContext('2d') : null;
    const ctxSide = canvasSide ? canvasSide.getContext('2d') : null;
    const summaryEl = document.getElementById('body-scan-summary');
    const btnCompute = document.getElementById('btn-body-compute');
    const btnRescan = document.getElementById('btn-body-rescan');
    const btnDone = document.getElementById('btn-body-scan-done');
    const heightInput = document.getElementById('body-scan-height');
    const paramsContainer = document.getElementById('body-scan-params');
    const paramInputs = {
        chest: document.getElementById('body-scan-chest'),
        waist: document.getElementById('body-scan-waist'),
        hips: document.getElementById('body-scan-hips'),
        arm: document.getElementById('body-scan-arm'),
        leg: document.getElementById('body-scan-leg')
    };
    const calibContainer = document.getElementById('body-scan-calib');
    const calibWhich = document.getElementById('body-scan-calib-which');
    const calibValue = document.getElementById('body-scan-calib-value');
    const btnCalib = document.getElementById('btn-body-scan-calib');

    if (!btnOpen || !modal || !fileInput || !canvas || !ctx) return;

    let img = new Image();
    let imgSide = new Image();
    let poseLandmarker = null;
    let isProcessing = false;
    let lastLandmarks = null;
    let lastLandmarksSide = null;
    let lastRawValues = {};

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
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
                },
                runningMode: "IMAGE",
                numPoses: 1
            });
            return poseLandmarker;
        } catch (err) {
            console.error("MediaPipe Pose load error:", err);
            return null;
        }
    }

    btnOpen.onclick = () => {
        modal.style.display = 'flex';
        document.getElementById('body-scan-upload').style.display = 'flex';
        document.getElementById('body-scan-canvas-step').style.display = 'none';
        fileInput.value = "";
        if (fileInputSide) fileInputSide.value = "";
        if (fileInputSideCanvas) fileInputSideCanvas.value = "";
        summaryEl.textContent = "";
        if (btnDone) btnDone.style.display = 'none';
        if (paramsContainer) paramsContainer.style.display = 'none';
        if (calibContainer) calibContainer.style.display = 'none';
        if (sidePreview) sidePreview.style.display = 'none';
        if (sideUpload) sideUpload.style.display = 'flex';
        if (calibValue) calibValue.value = '';
        lastLandmarks = null;
        lastLandmarksSide = null;
        lastRawValues = {};
        img.src = '';
        imgSide.src = '';
        if (heightInput) heightInput.value = inputs.body.height.num.value || "175";
    };

    if (heightInput) {
        heightInput.addEventListener('input', () => {
            if (lastLandmarks) applyBodyMeasurementsFromPose(lastLandmarks, lastLandmarksSide);
        });
    }

    if (btnCalib) {
        btnCalib.onclick = applyCalibration;
    }
    if (calibValue) {
        calibValue.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') applyCalibration();
        });
    }

    function applyCalibration() {
        const key = calibWhich ? calibWhich.value : 'chest';
        const known = calibValue && calibValue.value ? parseFloat(calibValue.value) : null;
        if (known == null || isNaN(known) || known <= 0) return;
        const estimated = lastRawValues[key];
        if (estimated == null || estimated <= 0) return;
        const factor = known / estimated;
        const keys = ['chest', 'waist', 'hips', 'arm', 'leg'];
        keys.forEach(k => {
            const el = paramInputs[k];
            const raw = lastRawValues[k];
            if (el && raw != null && raw > 0) {
                const val = k === key ? known : Math.round(raw * factor);
                el.value = Math.max(0, val);
            }
        });
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
    if (fileInputSide) fileInputSide.onchange = onSidePhotoSelected;
    if (fileInputSideCanvas) fileInputSideCanvas.onchange = onSidePhotoSelected;

    if (btnCompute) {
        btnCompute.onclick = async () => {
            if (!img.src) return;
            drawBodyImage();
            await runPose();
        };
    }
    if (btnRescan) {
        btnRescan.onclick = async () => {
            if (!img.src) return;
            drawBodyImage();
            await runPose();
        };
    }

    function drawBodyImage() {
        const maxWidth = 400;
        const ratio = img.width > 0 ? Math.min(1, maxWidth / img.width) : 1;
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (imgSide && imgSide.src && imgSide.complete && imgSide.naturalWidth > 0 && canvasSide && ctxSide) {
            const ratioSide = Math.min(1, maxWidth / imgSide.width);
            canvasSide.width = imgSide.width * ratioSide;
            canvasSide.height = imgSide.height * ratioSide;
            ctxSide.clearRect(0, 0, canvasSide.width, canvasSide.height);
            ctxSide.drawImage(imgSide, 0, 0, canvasSide.width, canvasSide.height);
            if (sidePreview) sidePreview.style.display = 'block';
            if (sideUpload) sideUpload.style.display = 'none';
        } else {
            if (sidePreview) sidePreview.style.display = 'none';
            if (sideUpload) sideUpload.style.display = 'flex';
        }
        document.getElementById('body-scan-upload').style.display = 'none';
        document.getElementById('body-scan-canvas-step').style.display = 'block';
    }

    async function runPose() {
        if (isProcessing) return;
        isProcessing = true;
        if (btnDone) btnDone.style.display = 'none';
        const instr = document.getElementById('body-scan-instruction');
        if (instr) instr.innerText = '⏳ Вычисляем...';
        summaryEl.textContent = "Загружаем MediaPipe…";
        try {
            const detector = await ensurePoseLandmarker();
            if (!detector) {
                if (instr) instr.innerText = '📌 Загрузите фото и нажмите кнопку';
                summaryEl.textContent = "Не удалось загрузить MediaPipe Pose. Проверьте интернет и консоль (F12).";
                isProcessing = false;
                return;
            }
            summaryEl.textContent = "Распознаём позу спереди...";
            const imageBitmap = await createImageBitmap(canvas);
            const result = await Promise.resolve(detector.detect(imageBitmap));
            imageBitmap.close();
            const pose = result.landmarks && result.landmarks[0];
            if (!pose || pose.length === 0) {
                if (instr) instr.innerText = '📌 Загрузите фото и нажмите кнопку';
                summaryEl.textContent = "Поза не найдена. Попробуйте другое фото (человек в полный рост, фронтально).";
                isProcessing = false;
                return;
            }
            lastLandmarks = pose;
            lastLandmarksSide = null;
            if (imgSide && imgSide.src && imgSide.complete && imgSide.naturalWidth > 0 && canvasSide && canvasSide.width > 0) {
                summaryEl.textContent = "Распознаём позу сбоку...";
                const imageBitmapSide = await createImageBitmap(canvasSide);
                const resultSide = await Promise.resolve(detector.detect(imageBitmapSide));
                imageBitmapSide.close();
                const poseSide = resultSide.landmarks && resultSide.landmarks[0];
                if (poseSide && poseSide.length > 0) lastLandmarksSide = poseSide;
            }
            if (document.getElementById('body-scan-instruction')) {
                document.getElementById('body-scan-instruction').innerText = '✅ Параметры вычислены';
            }
            drawLandmarks(pose);
            applyBodyMeasurementsFromPose(lastLandmarks, lastLandmarksSide);
        } catch (err) {
            console.error("Body scan error:", err);
            if (document.getElementById('body-scan-instruction')) {
                document.getElementById('body-scan-instruction').innerText = '📌 Загрузите фото и нажмите кнопку';
            }
            summaryEl.textContent = "Ошибка анализа: " + (err.message || "неизвестная ошибка");
        } finally {
            isProcessing = false;
        }
    }

    function drawLandmarks(landmarks) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.fillStyle = '#ff4444';
        landmarks.forEach((lm) => {
            const x = (lm.x !== undefined ? lm.x : lm[0]) * canvas.width;
            const y = (lm.y !== undefined ? lm.y : lm[1]) * canvas.height;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }

    function ellipseCircumference(a, b) {
        if (a <= 0 || b <= 0) return 2 * Math.PI * Math.max(a, b);
        const h = ((a - b) / (a + b)) * ((a - b) / (a + b));
        return Math.PI * (a + b) * (1 + h / 4);
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
        const getPointSide = (i) => getPoint(landmarksSide, i);
        const distPx = (a, b, cw, ch) => Math.hypot((a.x - b.x) * (cw || canvas.width), (a.y - b.y) * (ch || canvas.height));
        const spanX = (a, b, w) => Math.abs((a.x - b.x) * (w || canvas.width));

        const nose = getPointFront(0);
        const leftAnkle = getPointFront(27);
        const rightAnkle = getPointFront(28);

        if (!nose || !leftAnkle || !rightAnkle) {
            summaryEl.textContent = "Недостаточно точек для оценки роста.";
            return;
        }

        const feetY = Math.max(leftAnkle.y, rightAnkle.y);
        const heightNorm = Math.abs(feetY - nose.y);
        const heightPx = heightNorm * canvas.height;

        const realHeightCm = parseFloat(heightInput ? heightInput.value : inputs.body.height.num.value) || 175;
        if (!realHeightCm || realHeightCm <= 0) {
            summaryEl.textContent = "Укажите рост (см) в поле выше.";
            return;
        }

        const pxPerCm = heightPx / realHeightCm;
        if (pxPerCm <= 0) {
            summaryEl.textContent = "Ошибка масштаба. Проверьте фото и рост.";
            return;
        }

        let pxPerCmSide = pxPerCm;
        if (landmarksSide && canvasSide && canvasSide.width > 0) {
            const noseS = getPointSide(0);
            const ankleS = getPointSide(27);
            const ankleS2 = getPointSide(28);
            if (noseS && (ankleS || ankleS2)) {
                const feetYS = Math.max((ankleS || ankleS2).y, (ankleS2 || ankleS).y);
                const heightPxSide = Math.abs(feetYS - noseS.y) * canvasSide.height;
                if (heightPxSide > 0) pxPerCmSide = heightPxSide / realHeightCm;
            }
        }

        const leftShoulder = getPointFront(11);
        const rightShoulder = getPointFront(12);
        const leftHip = getPointFront(23);
        const rightHip = getPointFront(24);
        const leftElbow = getPointFront(13);
        const rightElbow = getPointFront(14);
        const leftKnee = getPointFront(25);
        const rightKnee = getPointFront(26);

        const lsSide = getPointSide(11);
        const rsSide = getPointSide(12);
        const lhSide = getPointSide(23);
        const rhSide = getPointSide(24);
        const leSide = getPointSide(13);
        const reSide = getPointSide(14);
        const lkSide = getPointSide(25);
        const rkSide = getPointSide(26);

        const K_BODY = 1.1;
        const useEllipse = !!(landmarksSide && canvasSide);
        let chest = null, waist = null, hips = null, arm = null, leg = null;

        if (leftShoulder && rightShoulder) {
            const chestWidthCm = distPx(leftShoulder, rightShoulder) / pxPerCm;
            if (useEllipse && lsSide && rsSide) {
                const chestDepthCm = spanX(lsSide, rsSide, canvasSide.width) / pxPerCmSide;
                chest = ellipseCircumference(chestWidthCm / 2, chestDepthCm / 2);
            } else {
                chest = chestWidthCm * Math.PI * K_BODY;
            }
        }

        if (leftHip && rightHip) {
            const hipsWidthCm = distPx(leftHip, rightHip) / pxPerCm;
            if (useEllipse && lhSide && rhSide) {
                const hipsDepthCm = spanX(lhSide, rhSide, canvasSide.width) / pxPerCmSide;
                hips = ellipseCircumference(hipsWidthCm / 2, hipsDepthCm / 2);
            } else {
                hips = hipsWidthCm * Math.PI * K_BODY;
            }
        }

        const waistShoulder = leftShoulder && rightShoulder ? (leftShoulder.y + rightShoulder.y) / 2 : null;
        const waistHip = leftHip && rightHip ? (leftHip.y + rightHip.y) / 2 : null;
        if (waistShoulder !== null && waistHip !== null && leftShoulder && rightShoulder && leftHip && rightHip) {
            const leftWaist = (leftShoulder.x + leftHip.x) / 2;
            const rightWaist = (rightShoulder.x + rightHip.x) / 2;
            const waistWidthCm = Math.abs(rightWaist - leftWaist) * canvas.width / pxPerCm;
            if (useEllipse && lsSide && rsSide && lhSide && rhSide) {
                const lwSide = (lsSide.x + lhSide.x) / 2;
                const rwSide = (rsSide.x + rhSide.x) / 2;
                const waistDepthCm = Math.abs(rwSide - lwSide) * canvasSide.width / pxPerCmSide;
                waist = ellipseCircumference(waistWidthCm / 2, waistDepthCm / 2);
            } else {
                waist = waistWidthCm * Math.PI * K_BODY;
            }
        }

        if (leftShoulder && leftElbow) {
            const upperArmPx = distPx(leftShoulder, leftElbow);
            const armWidthCm = (upperArmPx / pxPerCm) * 0.35;
            if (useEllipse && lsSide && leSide) {
                const armDepthCm = spanX(lsSide, leSide, canvasSide.width) / pxPerCmSide * 0.35;
                arm = ellipseCircumference(armWidthCm / 2, Math.max(armDepthCm / 2, armWidthCm * 0.3));
            } else {
                arm = armWidthCm * Math.PI;
            }
        } else if (rightShoulder && rightElbow) {
            const upperArmPx = distPx(rightShoulder, rightElbow);
            const armWidthCm = (upperArmPx / pxPerCm) * 0.35;
            if (useEllipse && rsSide && reSide) {
                const armDepthCm = spanX(rsSide, reSide, canvasSide.width) / pxPerCmSide * 0.35;
                arm = ellipseCircumference(armWidthCm / 2, Math.max(armDepthCm / 2, armWidthCm * 0.3));
            } else {
                arm = armWidthCm * Math.PI;
            }
        }

        if (leftHip && leftKnee) {
            const thighPx = distPx(leftHip, leftKnee);
            const legWidthCm = (thighPx / pxPerCm) * 0.32;
            if (useEllipse && lhSide && lkSide) {
                const legDepthCm = spanX(lhSide, lkSide, canvasSide.width) / pxPerCmSide * 0.32;
                leg = ellipseCircumference(legWidthCm / 2, Math.max(legDepthCm / 2, legWidthCm * 0.3));
            } else {
                leg = legWidthCm * Math.PI;
            }
        } else if (rightHip && rightKnee) {
            const thighPx = distPx(rightHip, rightKnee);
            const legWidthCm = (thighPx / pxPerCm) * 0.32;
            if (useEllipse && rhSide && rkSide) {
                const legDepthCm = spanX(rhSide, rkSide, canvasSide.width) / pxPerCmSide * 0.32;
                leg = ellipseCircumference(legWidthCm / 2, Math.max(legDepthCm / 2, legWidthCm * 0.3));
            } else {
                leg = legWidthCm * Math.PI;
            }
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
        if (calibContainer) calibContainer.style.display = parts.length > 0 ? 'flex' : 'none';
        if (calibValue) calibValue.value = '';
        summaryEl.textContent = parts.length > 0
            ? (useEllipse ? "Расчёт с учётом фото сбоку (эллипс). " : "") + "Проверьте и при необходимости скорректируйте значения ниже."
            : "Не удалось надёжно оценить параметры тела.";
        if (btnDone) btnDone.style.display = parts.length > 0 ? 'block' : 'none';
    }

    function applyParamsToBody() {
        const h = parseFloat(heightInput ? heightInput.value : 0) || parseFloat(inputs.body.height.num.value) || 175;
        inputs.body.height.num.value = Math.round(h);
        inputs.body.height.range.value = Math.round(h);
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

