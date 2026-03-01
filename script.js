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

