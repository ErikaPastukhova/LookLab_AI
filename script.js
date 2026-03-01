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


/* --- МОДУЛЬ "УМНАЯ ЛИНЕЙКА V3" (IGNORE A4 ZONE) --- */
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
    
    const btnAuto = document.getElementById('btn-auto-detect');
    const btnSkip = document.getElementById('btn-skip-step');
    const btnUndo = document.getElementById('btn-undo');
    const btnConfirm = document.getElementById('btn-confirm-step');

    // Toast уведомления
    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    if(document.querySelector('.modal-content')) document.querySelector('.modal-content').appendChild(toast);

    function showToast(message, type = 'success') {
        const icon = type === 'success' ? '✅' : '⚠️';
        toast.innerHTML = `<span>$${icon}</span> $${message}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
    }

    let img = new Image();
    let imgData = null;
    
    let scaleFactor = 0; 
    let clicks = [];
    let currentStepIndex = 0;
    
    // ХРАНИЛИЩЕ ДЛЯ A4 (Запретная зона)
    let a4Zone = { minX: 0, maxX: 0, minY: 0, maxY: 0, active: false };

    const SCENARIOS = {
        top: [
            { id: 'a4',    name: 'Калибровка (Клик 4 угла A4)', color: '#ff4444', count: 4 }, // Требуем 4 клика
            { id: 'chest', name: 'Ширина ГРУДИ',         color: '#007bff', count: 2 },
            { id: 'waist', name: 'Ширина ТАЛИИ',         color: '#28a745', count: 2 },
            { id: 'hips',  name: 'Ширина НИЗА (Бедра)',  color: '#ffc107', count: 2 }
        ],
        bottom: [
            { id: 'a4',    name: 'Калибровка (Клик 4 угла A4)', color: '#ff4444', count: 4 },
            { id: 'waist', name: 'Ширина ПОЯСА',         color: '#28a745', count: 2 },
            { id: 'hips',  name: 'Ширина БЕДЕР',         color: '#ffc107', count: 2 },
            { id: 'leg',   name: 'Ширина ШТАНИНЫ',       color: '#17a2b8', count: 2 }
        ]
    };
    // Если платье, копируем верх
    SCENARIOS.dress = SCENARIOS.top;

    let activeQueue = [];

    // --- ОТКРЫТИЕ ---
    btnOpen.onclick = () => { 
        modal.display = 'flex'; // Fix: modal is DOM element
        document.getElementById('measure-modal').style.display = 'flex';
        document.getElementById('step-upload').style.display = 'flex';
        document.getElementById('step-canvas').style.display = 'none';
        fileInput.value = "";
    };
    btnClose.onclick = () => { document.getElementById('measure-modal').style.display = 'none'; };

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            img.onload = () => startSession();
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
        a4Zone.active = false; // Сброс зоны A4

        const maxWidth = 800;
        const ratio = maxWidth / img.width;
        canvas.width = maxWidth;
        canvas.height = img.height * ratio;
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
            imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch(e) { console.warn("CORS"); }

        updateUI();
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const step = activeQueue[currentStepIndex];
        const color = step ? step.color : 'white';

        // Если это ШАГ 1 (A4), рисуем полигон
        if (currentStepIndex === 0 && clicks.length > 0) {
            ctx.fillStyle = "rgba(255, 68, 68, 0.3)"; // Полупрозрачный красный
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            ctx.moveTo(clicks[0].x, clicks[0].y);
            for(let i=1; i<clicks.length; i++) ctx.lineTo(clicks[i].x, clicks[i].y);
            if (clicks.length === 4) ctx.closePath(); // Замыкаем, если все точки есть
            ctx.fill();
            ctx.stroke();
        }

        // Если есть сохраненная зона A4 (мы уже прошли 1 шаг), рисуем её серенькой
        if (a4Zone.active && currentStepIndex > 0) {
             ctx.strokeStyle = "rgba(255, 0, 0, 0.3)";
             ctx.lineWidth = 1;
             ctx.strokeRect(a4Zone.minX, a4Zone.minY, a4Zone.maxX - a4Zone.minX, a4Zone.maxY - a4Zone.minY);
             // Штриховка "NO ENTRY"
             ctx.fillStyle = "rgba(0,0,0,0.5)";
             ctx.font = "12px Arial";
             ctx.fillText("IGNORE A4", a4Zone.minX + 5, a4Zone.minY + 15);
        }

        // Рисуем точки текущего шага
        clicks.forEach((p) => {
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = 'white'; ctx.lineWidth=2; ctx.stroke();
        });
        
        // Линия между точками (только для шагов > 0, где 2 точки)
        if (currentStepIndex > 0 && clicks.length === 2) {
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(clicks[0].x, clicks[0].y);
            ctx.lineTo(clicks[1].x, clicks[1].y);
            ctx.stroke();
        }
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
        
        draw();
        checkResult();
    };

    btnUndo.onclick = () => { clicks.pop(); draw(); checkResult(); };
    btnSkip.onclick = () => { nextStep(); };
    btnConfirm.onclick = () => { applyMeasurement(); nextStep(); };

    function checkResult() {
        const step = activeQueue[currentStepIndex];
        if (clicks.length === step.count) {
            
            let valCm = 0;

            if (step.id === 'a4') {
                // КАЛИБРОВКА ПО 4 ТОЧКАМ
                // Ищем самую длинную сторону четырехугольника
                // (Это позволяет класть лист хоть боком, хоть вертикально)
                let maxDist = 0;
                for (let i = 0; i < clicks.length; i++) {
                    const p1 = clicks[i];
                    const p2 = clicks[(i + 1) % clicks.length]; // следующая точка (циклично)
                    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    if (d > maxDist) maxDist = d;
                }
                
                // Считаем масштаб (Длинная сторона A4 = 29.7 см)
                // Мы временно сохраняем его, но примерим только по кнопке "Далее"
                valCm = 29.7; 
                scanVal.innerText = "29.7 (A4)";
            } 
            else {
                // ОБЫЧНЫЙ ЗАМЕР
                const dist = Math.hypot(clicks[1].x - clicks[0].x, clicks[1].y - clicks[0].y);
                if (scaleFactor === 0) return;
                valCm = (dist / scaleFactor) * 2;
                scanVal.innerText = Math.round(valCm);
            }
            
            scanFooter.style.visibility = 'visible';
        } else {
            scanFooter.style.visibility = 'hidden';
        }
    }

    function applyMeasurement() {
        const step = activeQueue[currentStepIndex];
        
        if (step.id === 'a4') {
            // 1. Вычисляем МАСШТАБ
            let maxDist = 0;
            const xs = [], ys = [];
            
            for (let i = 0; i < clicks.length; i++) {
                // Для масштаба
                const p1 = clicks[i];
                const p2 = clicks[(i + 1) % clicks.length];
                const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (d > maxDist) maxDist = d;
                
                // Для Bounding Box
                xs.push(p1.x); ys.push(p1.y);
            }
            scaleFactor = maxDist / 29.7;

            // 2. Создаем ЗАПРЕТНУЮ ЗОНУ (A4 Box)
            a4Zone = {
                minX: Math.min(...xs),
                maxX: Math.max(...xs),
                minY: Math.min(...ys),
                maxY: Math.max(...ys),
                active: true
            };
            console.log("A4 Zone set:", a4Zone);
        } 
        else {
            const val = parseInt(scanVal.innerText);
            // Есть ли такие инпуты? Бедра (hips) есть и в теле и в одежде, нам нужна Oдежда
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
            alert("Готово! Данные перенесены.");
            document.getElementById('measure-modal').style.display = 'none';
            return;
        }
        updateUI();
    }

    function updateUI() {
        clicks = [];
        draw();
        scanFooter.style.visibility = 'hidden';
        
        const step = activeQueue[currentStepIndex];
        
        // Инструкция
        let text = `📌 Шаг $${currentStepIndex + 1}: $${step.name}`;
        if (step.id === 'a4') text += " (Кликните 4 угла листа)";
        instrBadge.innerText = text;
        
        instrBadge.style.borderLeftColor = step.color;
        
        // Кнопка Авто доступна только если это НЕ а4
        btnAuto.disabled = (step.id === 'a4');
        btnAuto.style.opacity = (step.id === 'a4') ? 0.5 : 1;
    }


    // --- УМНЫЙ АВТО-ПОИСК (С ИГНОРОМ ЛИСТА A4) ---
    btnAuto.onclick = () => {
        if (!imgData) return showToast("Нет картинки", "error");

        const btnText = btnAuto.innerText;
        btnAuto.innerText = "Ищу...";
        btnAuto.classList.add("spinning");
        
        setTimeout(() => {
            try {
                runAutoDetect();
            } catch(e) { console.error(e); }
            finally {
                btnAuto.innerText = btnText;
                btnAuto.classList.remove("spinning");
            }
        }, 500);
    };

    // --- АВТО ОПРЕДЕЛЕНИЕ V3 (ПОИСК САМОГО ДЛИННОГО СЕГМЕНТА) ---
    function runAutoDetect() {
        const w = canvas.width;
        const h = canvas.height;
        const step = activeQueue[currentStepIndex];

        // 1. Высота сканирования
        let scanY = Math.floor(h * 0.5); 
        if (step.id === 'chest') scanY = Math.floor(h * 0.35);
        if (step.id === 'waist') scanY = Math.floor(h * 0.6); // Талия пониже
        if (step.id === 'hips')  scanY = Math.floor(h * 0.8);
        if (step.id === 'a4') scanY = Math.floor(h * 0.5);

        // Хелпер: Получить пиксель
        const getPixel = (x, y) => {
            const i = (y * w + x) * 4;
            return { r: imgData.data[i], g: imgData.data[i+1], b: imgData.data[i+2] };
        };
        // Хелпер: Разница цветов
        const getDist = (c1, c2) => Math.sqrt(Math.pow(c1.r-c2.r,2) + Math.pow(c1.g-c2.g,2) + Math.pow(c1.b-c2.b,2));

        // 2. Анализ ФОНА (Среднее по углам и краям)
        // Берем не только углы, но и точки по центрам сторон для надежности
        const probes = [
            getPixel(5, 5), getPixel(w/2, 5), getPixel(w-5, 5),
            getPixel(5, h/2), getPixel(w-5, h/2),
            getPixel(5, h-5), getPixel(w/2, h-5), getPixel(w-5, h-5)
        ];
        
        const bg = { r:0, g:0, b:0 };
        probes.forEach(p => { bg.r+=p.r; bg.g+=p.g; bg.b+=p.b });
        bg.r /= probes.length; bg.g /= probes.length; bg.b /= probes.length;

        // Порог отличия:
        // Если футболка белая, а фон черный - разница огромна (>100).
        // Если футболка серая, а фон белый - разница меньше.
        // 35 - золотая середина.
        const THRESHOLD = 35; 

        // 3. СКАНИРОВАНИЕ ВСЕЙ СТРОКИ
        // Мы строим "карту" строки: false = фон, true = объект
        let lineMap = new Array(w).fill(false);

        for (let x = 0; x < w; x++) {
            // Если попали в зону A4 (И она активна на этом шаге) -- считаем фоном
            if (a4Zone.active && x >= a4Zone.minX && x <= a4Zone.maxX && scanY >= a4Zone.minY && scanY <= a4Zone.maxY) {
                lineMap[x] = false; 
                continue;
            }

            const dist = getDist(getPixel(x, scanY), bg);
            if (dist > THRESHOLD) {
                lineMap[x] = true; // Это объект
            }
        }

        // 4. ПОИСК САМОГО ДЛИННОГО КУСКА (Longest Sequence)
        // Это позволяет игнорировать мусор по краям
        let maxLen = 0;
        let bestStart = 0;
        let bestEnd = 0;

        let currentStart = -1;
        let currentLen = 0;

        // Маленький фильтр "Gap closing" (если 1-2 пикселя пробились как фон внутри футболки - игнорим)
        // Для простоты не будем усложнять, V3 и так мощная.

        for (let x = 0; x < w; x++) {
            if (lineMap[x]) {
                if (currentStart === -1) currentStart = x;
                currentLen++;
            } else {
                if (currentStart !== -1) {
                    // Кусок закончился. Проверяем, самый ли он большой?
                    if (currentLen > maxLen) {
                        maxLen = currentLen;
                        bestStart = currentStart;
                        bestEnd = x - 1;
                    }
                    currentStart = -1;
                    currentLen = 0;
                }
            }
        }
        // Проверка последнего куска (если дошел до края экрана)
        if (currentStart !== -1 && currentLen > maxLen) {
            maxLen = currentLen;
            bestStart = currentStart;
            bestEnd = w - 1;
        }

        // --- ВИЗУАЛИЗАЦИЯ ---
        draw(); 
        
        // Рисуем линию скана
        ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(w, scanY);
        ctx.strokeStyle="rgba(255, 255, 0, 0.4)"; ctx.lineWidth=1; ctx.stroke();

        // 5. РЕЗУЛЬТАТ
        // Считаем валидным, если нашли кусок хотя бы 20 пикселей шириной
        if (maxLen > 20) {
            clicks = [{x: bestStart, y: scanY}, {x: bestEnd, y: scanY}];
            
            // Рисуем жирную зеленую линию поверх найденного куска
            ctx.beginPath(); ctx.moveTo(bestStart, scanY); ctx.lineTo(bestEnd, scanY);
            ctx.strokeStyle="#00ff00"; ctx.lineWidth=3; ctx.stroke();

            // Рисуем точки
            ctx.fillStyle = activeQueue[currentStepIndex].color;
            clicks.forEach(p => {
                ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle="white"; ctx.stroke();
            });

            checkResult();
            const cm = Math.round((maxLen / scaleFactor) * 2);
            showToast(`Найдено! Обхват ~$${cm} см`, "success");
        } else {
            // Если ничего похожего на одежду не нашли
            clicks = [{x: w*0.4, y: scanY}, {x: w*0.6, y: scanY}];
            draw(); checkResult();
            showToast("Объект сливается с фоном", "error");
        }
    }


})();


