export function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function median(values) {
    if (!values || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function ellipseCircumference(a, b) {
    if (a <= 0 || b <= 0) return 2 * Math.PI * Math.max(a, b);
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

export function getScanProfile({ gender = 'male', heightCm = 175, weightKg = 70 } = {}) {
    const h = Number(heightCm) || 175;
    const w = Number(weightKg) || (gender === 'female' ? 60 : 70);
    const hM = Math.max(1.0, h / 100);
    const bmi = w / (hM * hM);
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
    return { gender, heightCm: h, weightKg: w, bmi, k, stats };
}

export function getGenderCoefficients(gender = 'male') {
    return {
        armLengthToWidth: gender === 'female' ? 0.32 : 0.37,
        legLengthToWidth: gender === 'female' ? 0.34 : 0.30,
    };
}

function normalizePoint(lm) {
    if (!lm) return null;
    const x = lm.x !== undefined ? lm.x : (Array.isArray(lm) ? lm[0] : null);
    const y = lm.y !== undefined ? lm.y : (Array.isArray(lm) ? lm[1] : null);
    if (x == null || y == null || !isFinite(x) || !isFinite(y)) return null;
    return {
        x,
        y,
        z: isFinite(lm.z) ? lm.z : 0,
        visibility: isFinite(lm.visibility) ? lm.visibility : null,
        presence: isFinite(lm.presence) ? lm.presence : null,
    };
}

function getPoint(landmarks, index) {
    return landmarks ? normalizePoint(landmarks[index]) : null;
}

function pointConfidence(point) {
    if (!point) return 0;
    const scores = [];
    if (point.visibility != null) scores.push(point.visibility);
    if (point.presence != null) scores.push(point.presence);
    if (!scores.length) return 0.7;
    return Math.min(...scores);
}

export function validatePoseLandmarks(landmarks, { minCoreConfidence = 0.28 } = {}) {
    const required = [
        ['leftShoulder', 11],
        ['rightShoulder', 12],
        ['leftHip', 23],
        ['rightHip', 24],
    ];
    const points = {};
    const warnings = [];
    const errors = [];

    for (const [name, index] of required) {
        const point = getPoint(landmarks, index);
        points[name] = point;
        if (!point) {
            errors.push(`Не найдена ключевая точка: ${name}.`);
            continue;
        }
        const conf = pointConfidence(point);
        if (conf < minCoreConfidence) warnings.push(`Низкая уверенность MediaPipe для ${name}: ${Math.round(conf * 100)}%.`);
    }

    if (errors.length) return { ok: false, points, errors, warnings };

    const shoulderY = (points.leftShoulder.y + points.rightShoulder.y) / 2;
    const hipY = (points.leftHip.y + points.rightHip.y) / 2;
    const torsoDelta = hipY - shoulderY;
    if (torsoDelta <= 0.08) errors.push('Плечи и бедра расположены слишком близко: фото не похоже на полный фронтальный рост.');

    const shoulderTilt = Math.abs(points.leftShoulder.y - points.rightShoulder.y);
    const hipTilt = Math.abs(points.leftHip.y - points.rightHip.y);
    if (shoulderTilt > 0.06) warnings.push('Плечи сильно наклонены: корпус может быть повернут или поза асимметрична.');
    if (hipTilt > 0.06) warnings.push('Бедра сильно наклонены: поза может исказить расчет.');

    const shoulderWidth = Math.abs(points.rightShoulder.x - points.leftShoulder.x);
    const hipWidth = Math.abs(points.rightHip.x - points.leftHip.x);
    if (shoulderWidth < 0.12 || hipWidth < 0.07) warnings.push('Корпус выглядит повернутым боком: фронтальные мерки будут приблизительными.');

    const shoulderCenterX = (points.leftShoulder.x + points.rightShoulder.x) / 2;
    const hipCenterX = (points.leftHip.x + points.rightHip.x) / 2;
    if (Math.abs(shoulderCenterX - hipCenterX) > Math.max(0.07, shoulderWidth * 0.35)) {
        warnings.push('Центр плеч и бедер заметно смещен: поза не строго фронтальная.');
    }

    return { ok: errors.length === 0, points, errors, warnings };
}

export function detectArmTorsoRisk(landmarks) {
    const leftShoulder = getPoint(landmarks, 11);
    const rightShoulder = getPoint(landmarks, 12);
    const leftHip = getPoint(landmarks, 23);
    const rightHip = getPoint(landmarks, 24);
    const pairs = [
        { side: 'left', elbow: getPoint(landmarks, 13), wrist: getPoint(landmarks, 15), shoulder: leftShoulder, hip: leftHip },
        { side: 'right', elbow: getPoint(landmarks, 14), wrist: getPoint(landmarks, 16), shoulder: rightShoulder, hip: rightHip },
    ];
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return { risk: 'unknown', warnings: [] };

    const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
    const warnings = [];
    let closeCount = 0;
    for (const item of pairs) {
        const refX = (item.shoulder.x + item.hip.x) / 2;
        const elbowClose = item.elbow && Math.abs(item.elbow.x - refX) < shoulderWidth * 0.42;
        const wristClose = item.wrist && Math.abs(item.wrist.x - refX) < shoulderWidth * 0.52;
        if (elbowClose || wristClose) closeCount += 1;
    }
    if (closeCount >= 2) warnings.push('Руки близко к корпусу: они могут расширять грудь и талию.');
    else if (closeCount === 1) warnings.push('Одна рука близко к корпусу: соответствующая сторона может искажать сечения.');
    return { risk: closeCount >= 2 ? 'high' : closeCount === 1 ? 'medium' : 'low', warnings };
}

export function validateSidePoseLandmarks(landmarks, { minCoreConfidence = 0.22 } = {}) {
    const required = [
        ['leftShoulder', 11],
        ['rightShoulder', 12],
        ['leftHip', 23],
        ['rightHip', 24],
    ];
    const points = {};
    const warnings = [];
    const errors = [];

    for (const [name, index] of required) {
        const point = getPoint(landmarks, index);
        points[name] = point;
        if (!point) {
            errors.push(`На фото сбоку не найдена ключевая точка: ${name}.`);
            continue;
        }
        const conf = pointConfidence(point);
        if (conf < minCoreConfidence) warnings.push(`Низкая уверенность MediaPipe на фото сбоку для ${name}: ${Math.round(conf * 100)}%.`);
    }

    if (errors.length) return { ok: false, points, errors, warnings, metrics: {} };

    const shoulderY = (points.leftShoulder.y + points.rightShoulder.y) / 2;
    const hipY = (points.leftHip.y + points.rightHip.y) / 2;
    const torsoDelta = hipY - shoulderY;
    if (torsoDelta <= 0.08) errors.push('Фото сбоку не похоже на полный рост: плечи и бедра слишком близко по вертикали.');

    const shoulderWidth = Math.abs(points.rightShoulder.x - points.leftShoulder.x);
    const hipWidth = Math.abs(points.rightHip.x - points.leftHip.x);
    if (shoulderWidth > 0.26 || hipWidth > 0.22) {
        errors.push('Фото сбоку похоже на фронтальный ракурс: плечи/бедра слишком широко разведены по X.');
    } else if (shoulderWidth > 0.20 || hipWidth > 0.17) {
        warnings.push('Фото сбоку не строго профильное: глубина может быть завышена.');
    }

    const shoulderTilt = Math.abs(points.leftShoulder.y - points.rightShoulder.y);
    const hipTilt = Math.abs(points.leftHip.y - points.rightHip.y);
    if (shoulderTilt > 0.10 || hipTilt > 0.10) warnings.push('Фото сбоку заметно наклонено: глубина может быть неточной.');

    return {
        ok: errors.length === 0,
        points,
        errors,
        warnings,
        metrics: { shoulderY, hipY, torsoDelta, shoulderWidth, hipWidth, shoulderTilt, hipTilt },
    };
}

function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return dr * dr + dg * dg + db * db;
}

function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = clampValue(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
    return sorted[idx];
}

function dilate(src, w, h, minNeighbors) {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let count = 0;
            for (let yy = -1; yy <= 1; yy++) {
                for (let xx = -1; xx <= 1; xx++) count += src[(y + yy) * w + (x + xx)];
            }
            out[y * w + x] = count >= minNeighbors ? 1 : 0;
        }
    }
    return out;
}

export function buildForegroundMask(sourceCanvas, sourceCtx, anchor) {
    if (!sourceCanvas || !sourceCtx || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) return null;
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    let imageData;
    try {
        imageData = sourceCtx.getImageData(0, 0, w, h);
    } catch {
        return null;
    }
    return buildForegroundMaskFromImageData(imageData.data, w, h, anchor);
}

export function buildForegroundMaskFromImageData(data, w, h, anchor) {
    if (!data || !w || !h) return null;
    const borderStep = Math.max(2, Math.floor(Math.min(w, h) / 80));
    const samples = [];
    const sample = (x, y) => {
        const i = (y * w + x) * 4;
        samples.push([data[i], data[i + 1], data[i + 2]]);
    };

    for (let x = 0; x < w; x += borderStep) {
        sample(x, 0);
        sample(x, h - 1);
    }
    for (let y = borderStep; y < h - borderStep; y += borderStep) {
        sample(0, y);
        sample(w - 1, y);
    }
    if (!samples.length) return null;

    const bgR = median(samples.map((s) => s[0]));
    const bgG = median(samples.map((s) => s[1]));
    const bgB = median(samples.map((s) => s[2]));
    const borderDists = samples.map((s) => colorDistanceSq(s[0], s[1], s[2], bgR, bgG, bgB));
    const adaptiveThresholdSq = Math.max(36 * 36, percentile(borderDists, 0.88) + 32 * 32);

    const rawMask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (colorDistanceSq(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB) > adaptiveThresholdSq) {
                rawMask[y * w + x] = 1;
            }
        }
    }

    const smoothed = dilate(dilate(rawMask, w, h, 3), w, h, 4);
    return keepBestComponent(smoothed, w, h, anchor);
}

export function normalizeBinaryMask(binaryMask, w, h, anchor, { smooth = true } = {}) {
    if (!binaryMask || !w || !h || binaryMask.length < w * h) return null;
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < raw.length; i++) raw[i] = binaryMask[i] ? 1 : 0;
    const prepared = smooth ? dilate(dilate(raw, w, h, 3), w, h, 4) : raw;
    return keepBestComponent(prepared, w, h, anchor);
}

function keepBestComponent(src, w, h, anchor) {
    const visited = new Uint8Array(w * h);
    const labels = new Int32Array(w * h);
    const components = [];

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            if (src[idx] !== 1 || visited[idx] === 1) continue;
            const queue = [idx];
            visited[idx] = 1;
            let qPos = 0;
            let area = 0;
            let sumX = 0;
            let sumY = 0;
            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;
            while (qPos < queue.length) {
                const cur = queue[qPos++];
                const cx = cur % w;
                const cy = Math.floor(cur / w);
                labels[cur] = components.length + 1;
                area++;
                sumX += cx;
                sumY += cy;
                minX = Math.min(minX, cx);
                maxX = Math.max(maxX, cx);
                minY = Math.min(minY, cy);
                maxY = Math.max(maxY, cy);
                const neighbors = [cur - 1, cur + 1, cur - w, cur + w];
                for (const nb of neighbors) {
                    if (nb < 0 || nb >= w * h) continue;
                    const nx = nb % w;
                    const ny = Math.floor(nb / w);
                    if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
                    if (src[nb] !== 1 || visited[nb] === 1) continue;
                    visited[nb] = 1;
                    queue.push(nb);
                }
            }
            components.push({
                label: components.length + 1,
                area,
                cx: sumX / Math.max(1, area),
                cy: sumY / Math.max(1, area),
                minX,
                maxX,
                minY,
                maxY,
            });
        }
    }
    if (!components.length) return null;

    let best = null;
    for (const comp of components) {
        const boxW = comp.maxX - comp.minX + 1;
        const boxH = comp.maxY - comp.minY + 1;
        const aspectPenalty = boxH < h * 0.25 || boxW < w * 0.06 ? comp.area * 0.6 : 0;
        let score = comp.area - aspectPenalty;
        if (anchor && isFinite(anchor.x) && isFinite(anchor.y)) {
            const dist = Math.hypot(comp.cx - anchor.x, comp.cy - anchor.y);
            score -= dist * dist * 0.018;
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
    return { mask, width: w, height: h, areaRatio: keptArea / Math.max(1, w * h), component: best };
}

export function getMaskVerticalBounds(maskObj) {
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

export function getLongestSpanAtY(maskObj, y, searchRadius = 0) {
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
            if (!best || len > best.len) best = { y: yy, x1: bestStart, x2: bestEnd, len };
        }
    }
    return best;
}

export function getSpanByCenterCrossing(maskObj, y, expectedCenterX, searchRadius = 0, allowLongestFallback = false) {
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
                    if (!best || candidate.len > best.len || (candidate.len === best.len && candidate.centerDeviation < best.centerDeviation)) best = candidate;
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
        if (!best || candidate.len > best.len || (candidate.len === best.len && candidate.centerDeviation < best.centerDeviation)) best = candidate;
    }
    return best;
}

function pointToSegmentDistancePx(x, y, a, b, width, height) {
    if (!a || !b) return Infinity;
    const ax = a.x * width;
    const ay = a.y * height;
    const bx = b.x * width;
    const by = b.y * height;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 1) return Math.hypot(x - ax, y - ay);
    const t = clampValue(((x - ax) * dx + (y - ay) * dy) / lenSq, 0, 1);
    const px = ax + dx * t;
    const py = ay + dy * t;
    return Math.hypot(x - px, y - py);
}

function minDistanceToSegmentsPx(x, y, segments, width, height) {
    let best = Infinity;
    for (const [a, b] of segments) {
        const dist = pointToSegmentDistancePx(x, y, a, b, width, height);
        if (dist < best) best = dist;
    }
    return best;
}

function makeSegments(...points) {
    const segments = [];
    for (let i = 0; i < points.length - 1; i++) {
        if (points[i] && points[i + 1]) segments.push([points[i], points[i + 1]]);
    }
    return segments;
}

function buildPoseAwareTorsoMask(personMask, landmarks, anchor) {
    const fallback = (reason) => ({
        mask: personMask,
        diagnostics: {
            source: personMask?.source || 'personMask',
            fallbackReason: reason,
            personAreaRatio: personMask?.areaRatio || 0,
            torsoAreaRatio: personMask?.areaRatio || 0,
            removedPixelRatio: 0,
        },
    });

    if (!personMask || !personMask.mask || !landmarks) return fallback('missing-mask-or-landmarks');
    const leftShoulder = getPoint(landmarks, 11);
    const rightShoulder = getPoint(landmarks, 12);
    const leftHip = getPoint(landmarks, 23);
    const rightHip = getPoint(landmarks, 24);
    const leftElbow = getPoint(landmarks, 13);
    const rightElbow = getPoint(landmarks, 14);
    const leftWrist = getPoint(landmarks, 15);
    const rightWrist = getPoint(landmarks, 16);
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return fallback('missing-core-points');

    const { width, height } = personMask;
    const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * height;
    const hipY = ((leftHip.y + rightHip.y) / 2) * height;
    const torsoDelta = hipY - shoulderY;
    if (!isFinite(torsoDelta) || torsoDelta <= height * 0.08) return fallback('invalid-torso-geometry');

    const leftShoulderX = leftShoulder.x * width;
    const rightShoulderX = rightShoulder.x * width;
    const leftHipX = leftHip.x * width;
    const rightHipX = rightHip.x * width;
    const shoulderWidthPx = Math.abs(rightShoulderX - leftShoulderX);
    const hipWidthPx = Math.abs(rightHipX - leftHipX);
    const refWidth = Math.max(12, shoulderWidthPx, hipWidthPx * 1.15);
    const armSegments = [
        ...makeSegments(leftShoulder, leftElbow, leftWrist),
        ...makeSegments(rightShoulder, rightElbow, rightWrist),
    ];
    const armRadius = clampValue(refWidth * 0.105, 7, 24);
    const torsoBinary = new Uint8Array(width * height);
    let personPixels = 0;
    let keptPixels = 0;
    let removedByCorridor = 0;
    let removedByArm = 0;

    const padForT = (tRaw) => {
        if (tRaw < 0.16) return refWidth * 0.06 + 3;
        if (tRaw < 0.42) return refWidth * 0.09 + 3;
        if (tRaw < 0.72) return refWidth * 0.07 + 2;
        if (tRaw < 1.04) return refWidth * 0.19 + 4;
        return refWidth * 0.11 + 2;
    };

    for (let y = 0; y < height; y++) {
        const tRaw = (y - shoulderY) / torsoDelta;
        const t = clampValue(tRaw, 0, 1);
        const leftAxisX = leftShoulderX + (leftHipX - leftShoulderX) * t;
        const rightAxisX = rightShoulderX + (rightHipX - rightShoulderX) * t;
        const innerLeft = Math.min(leftAxisX, rightAxisX);
        const innerRight = Math.max(leftAxisX, rightAxisX);
        const pad = padForT(tRaw);
        const outerLeft = innerLeft - pad;
        const outerRight = innerRight + pad;
        const innerPad = Math.max(2, pad * 0.25);

        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (personMask.mask[idx] !== 1) continue;
            personPixels++;
            if (tRaw < -0.08 || tRaw > 1.24 || x < outerLeft || x > outerRight) {
                removedByCorridor++;
                continue;
            }

            const armDist = armSegments.length
                ? minDistanceToSegmentsPx(x, y, armSegments, width, height)
                : Infinity;
            const insideInnerTorso = x >= innerLeft - innerPad && x <= innerRight + innerPad;
            const shoulderBridge = tRaw < 0.14 && Math.abs(y - shoulderY) < Math.max(6, torsoDelta * 0.08);
            if (armDist <= armRadius && !insideInnerTorso && !shoulderBridge) {
                removedByArm++;
                continue;
            }

            torsoBinary[idx] = 1;
            keptPixels++;
        }
    }

    const normalized = normalizeBinaryMask(torsoBinary, width, height, anchor, { smooth: false });
    const minArea = Math.max(personPixels * 0.10, width * height * 0.01);
    if (!normalized || keptPixels < minArea || normalized.areaRatio < personMask.areaRatio * 0.10) {
        return fallback('pose-part-mask-too-small');
    }

    return {
        mask: {
            ...normalized,
            source: personMask.source ? `${personMask.source}+poseParts` : 'poseParts',
        },
        diagnostics: {
            source: personMask.source ? `${personMask.source}+poseParts` : 'poseParts',
            fallbackReason: null,
            personAreaRatio: personMask.areaRatio || (personPixels / Math.max(1, width * height)),
            torsoAreaRatio: normalized.areaRatio,
            removedPixelRatio: (removedByCorridor + removedByArm) / Math.max(1, personPixels),
            removedByArmRatio: removedByArm / Math.max(1, personPixels),
            removedByCorridorRatio: removedByCorridor / Math.max(1, personPixels),
            armRadius,
        },
    };
}

function buildExternalTorsoSegmentation(personMask, externalMask, source = null) {
    if (!personMask || !personMask.mask || !externalMask || !externalMask.mask) return null;
    if (personMask.width !== externalMask.width || personMask.height !== externalMask.height) return null;
    const personBounds = getMaskVerticalBounds(personMask);
    const externalBounds = getMaskVerticalBounds(externalMask);
    if (!personBounds || !externalBounds) return null;
    if (externalBounds.height < personBounds.height * 0.22) return null;
    const minAreaRatio = Math.max(0.012, personMask.areaRatio * 0.18);
    if (!externalMask.areaRatio || externalMask.areaRatio < minAreaRatio) return null;
    if (personMask.areaRatio && externalMask.areaRatio > personMask.areaRatio * 0.92) return null;
    return {
        mask: {
            ...externalMask,
            source: source || externalMask.source || 'bodyPartSegmentation',
        },
        diagnostics: {
            source: source || externalMask.source || 'bodyPartSegmentation',
            fallbackReason: null,
            personAreaRatio: personMask.areaRatio || 0,
            torsoAreaRatio: externalMask.areaRatio,
            removedPixelRatio: 1 - (externalMask.areaRatio / Math.max(personMask.areaRatio || 0, 0.0001)),
            removedByArmRatio: null,
            removedByCorridorRatio: null,
            external: true,
        },
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
    const isChest = section === 'chest';
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
            const x1 = Math.round((spanCenter.x1 + spanLongest.x1) / 2);
            const x2 = Math.round((spanCenter.x2 + spanLongest.x2) / 2);
            span = { ...spanCenter, x1, x2, len: x2 - x1 + 1 };
            source = 'consensus';
        } else {
            const devA = Math.abs(centerA - expectedCenterX);
            const devB = Math.abs(centerB - expectedCenterX);
            span = devA <= devB ? spanCenter : spanLongest;
            source = 'disagreeFallback';
            agreementPenalty = isHips ? 0.82 : 0.88;
        }
    } else if (!spanCenter && spanLongest) {
        span = spanLongest;
        source = 'longestFallback';
        agreementPenalty = isHips ? 0.75 : 0.82;
    }

    if (!span) return null;
    const spanCenterX = (span.x1 + span.x2) / 2;
    const centerDeviation = Math.abs(spanCenterX - expectedCenterX);
    const maxCenterDeviation = Math.max(8, expectedWidth * (isHips ? 0.30 : 0.22));
    if (centerDeviation > maxCenterDeviation) return null;

    const minWidthFactor = isHips ? 0.36 : isChest ? 0.4 : 0.30;
    const maxWidthFactor = isHips ? 1.26 : isChest ? 1.04 : 1.12;
    if (span.len < expectedWidth * minWidthFactor || span.len > expectedWidth * maxWidthFactor) return null;
    const corridorPad = isHips ? 14 : 6;
    if (span.x2 < leftTorsoX - corridorPad || span.x1 > rightTorsoX + corridorPad) return null;

    const centerScore = clampValue(1 - (centerDeviation / Math.max(1, maxCenterDeviation)), 0, 1);
    const widthScore = clampValue(1 - (Math.abs(span.len - expectedWidth) / Math.max(1, expectedWidth * (isHips ? 0.9 : 0.7))), 0, 1);
    return {
        ...span,
        relativeY: y / Math.max(1, h - 1),
        confidence: (0.45 * centerScore + 0.55 * widthScore) * agreementPenalty,
        source,
        expectedWidth,
    };
}

function buildTorsoProfile(frontMask, leftShoulder, rightShoulder, leftHip, rightHip, yStart, yEnd, section = 'torso') {
    const profile = [];
    for (let y = Math.floor(yStart); y <= Math.ceil(yEnd); y += 2) {
        const span = getFrontTorsoSpanAtY(frontMask, y, leftShoulder, rightShoulder, leftHip, rightHip, section);
        if (span) profile.push({ y, span, len: span.len, confidence: span.confidence || 0.6 });
    }
    if (!profile.length) return profile;
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
    if (!scoped.length) return null;
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
    return { ...best.span, y: best.y, relativeY: best.span.relativeY, confidence: best.confidence, peakStable: stableBand >= 2 };
}

function selectChestSpanFromProfile(profile, minY, maxY, shoulderY, hipY, shoulderWidthPx, armRisk) {
    const scoped = profile.filter((p) => p.y >= minY && p.y <= maxY);
    if (!scoped.length) return null;
    const torsoDelta = Math.max(1, hipY - shoulderY);
    const targetY = shoulderY + torsoDelta * 0.34;
    let best = null;
    for (const item of scoped) {
        const rel = (item.y - shoulderY) / torsoDelta;
        const yScore = clampValue(1 - Math.abs(item.y - targetY) / Math.max(1, torsoDelta * 0.22), 0, 1);
        const shoulderPenalty = item.smoothedLen > shoulderWidthPx * 0.94 ? 18 : 0;
        const highPenalty = rel < 0.28 ? 12 : 0;
        const armPenalty = armRisk === 'high' ? 10 : armRisk === 'medium' ? 5 : 0;
        const score = item.smoothedLen * 0.42 + (item.confidence || 0.5) * 32 + yScore * 26 - shoulderPenalty - highPenalty - armPenalty;
        if (!best || score > best.score) best = { ...item, score };
    }
    if (!best) return null;
    const around = scoped.filter((p) => Math.abs(p.y - best.y) <= 4);
    const stableBand = around.filter((p) => p.smoothedLen >= best.smoothedLen * 0.95).length;
    const shoulderLike = best.smoothedLen > shoulderWidthPx * 0.96 && (best.y - shoulderY) / torsoDelta < 0.34;
    return {
        ...best.span,
        y: best.y,
        relativeY: best.span.relativeY,
        confidence: clampValue((best.confidence || 0.55) * (shoulderLike ? 0.55 : 1), 0, 1),
        peakStable: stableBand >= 2,
        shoulderLike,
    };
}

function findWaistSpanByTorsoMask(frontMask, leftShoulder, rightShoulder, leftHip, rightHip, minY, maxY) {
    if (!frontMask || !leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
    const h = frontMask.height;
    const w = frontMask.width;
    const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * h;
    const hipY = ((leftHip.y + rightHip.y) / 2) * h;
    if (!isFinite(shoulderY) || !isFinite(hipY) || hipY <= shoulderY + 10) return null;

    const scanStart = Math.max(0, Math.floor(minY));
    const scanEnd = Math.min(h - 1, Math.ceil(maxY));
    if (scanEnd <= scanStart) return null;

    const shoulderWidthPx = Math.abs((rightShoulder.x - leftShoulder.x) * w);
    const hipsWidthPx = Math.abs((rightHip.x - leftHip.x) * w);
    const minAllowed = Math.max(8, Math.floor(Math.min(shoulderWidthPx, hipsWidthPx) * 0.30));
    const maxAllowed = Math.max(minAllowed + 1, Math.ceil(Math.max(shoulderWidthPx, hipsWidthPx) * 1.16));
    const shoulderCenterX = ((leftShoulder.x + rightShoulder.x) / 2) * w;
    const hipCenterX = ((leftHip.x + rightHip.x) / 2) * w;
    const leftShoulderX = leftShoulder.x * w;
    const rightShoulderX = rightShoulder.x * w;
    const leftHipX = leftHip.x * w;
    const rightHipX = rightHip.x * w;
    const samples = [];

    for (let y = scanStart; y <= scanEnd; y += 2) {
        const t = (y - shoulderY) / Math.max(1, (hipY - shoulderY));
        const expectedCenterX = shoulderCenterX + (hipCenterX - shoulderCenterX) * t;
        const span = getSpanByCenterCrossing(frontMask, y, expectedCenterX, 2, true);
        if (!span) continue;
        const leftTorsoX = leftShoulderX + (leftHipX - leftShoulderX) * t;
        const rightTorsoX = rightShoulderX + (rightHipX - rightShoulderX) * t;
        const expectedWidth = Math.abs(rightTorsoX - leftTorsoX);
        const dynamicMinAllowed = Math.max(minAllowed, Math.floor(expectedWidth * 0.30));
        const dynamicMaxAllowed = Math.min(maxAllowed, Math.ceil(expectedWidth * 1.14));
        if (span.len < dynamicMinAllowed || span.len > dynamicMaxAllowed) continue;
        const spanCenter = (span.x1 + span.x2) / 2;
        const maxCenterDeviation = Math.max(8, expectedWidth * 0.22);
        if (Math.abs(spanCenter - expectedCenterX) > maxCenterDeviation) continue;
        if (span.x2 < leftTorsoX - 6 || span.x1 > rightTorsoX + 6) continue;
        const centerScore = clampValue(1 - (Math.abs(spanCenter - expectedCenterX) / Math.max(1, maxCenterDeviation)), 0, 1);
        const widthScore = clampValue(1 - (Math.abs(span.len - expectedWidth) / Math.max(1, expectedWidth * 0.7)), 0, 1);
        span.confidence = 0.45 * centerScore + 0.55 * widthScore;
        samples.push(span);
    }
    if (samples.length < 2) return null;

    const medianSmoothed = samples.map((sample, idx) => {
        const lengths = [samples[idx].len];
        if (idx > 0) lengths.push(samples[idx - 1].len);
        if (idx < samples.length - 1) lengths.push(samples[idx + 1].len);
        return { sample, len: median(lengths) };
    });
    const averaged = medianSmoothed.map((entry, idx) => {
        let sum = 0;
        let cnt = 0;
        for (let j = idx - 2; j <= idx + 2; j++) {
            if (j < 0 || j >= medianSmoothed.length) continue;
            sum += medianSmoothed[j].len;
            cnt++;
        }
        return { sample: entry.sample, smoothedLen: sum / Math.max(1, cnt) };
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
        const idx = item.idx != null ? item.idx : averaged.indexOf(item);
        const around = averaged.filter((_, i) => Math.abs(i - idx) <= 2);
        const valleyBand = around.filter(v => v.smoothedLen <= item.smoothedLen * 1.06).length;
        const valleyScore = clampValue(valleyBand / 5, 0, 1);
        const lowerBias = clampValue((item.sample.y - scanStart) / Math.max(1, (scanEnd - scanStart)), 0, 1);
        const score = item.smoothedLen - valleyScore * 8 - lowerBias * 4;
        if (!best || score < best.score) best = { ...item, score, valleyScore };
    }
    if (!best) return null;
    const finalY = best.sample.y;
    const neighborhood = samples.filter((s) => Math.abs(s.y - finalY) <= 2);
    const x1 = median(neighborhood.map((s) => s.x1));
    const x2 = median(neighborhood.map((s) => s.x2));
    return {
        y: finalY,
        x1,
        x2,
        len: Math.max(1, x2 - x1 + 1),
        relativeY: finalY / Math.max(1, h - 1),
        confidence: clampValue((best.valleyScore || 0.5) * (best.sample.confidence || 0.7), 0, 1),
    };
}

function findSoftBodySpanByMask(frontMask, leftShoulder, rightShoulder, leftHip, rightHip, minY, maxY, mode = 'min', section = 'torso') {
    if (!frontMask || !leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
    const h = frontMask.height;
    const w = frontMask.width;
    const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * h;
    const hipY = ((leftHip.y + rightHip.y) / 2) * h;
    if (!isFinite(shoulderY) || !isFinite(hipY) || hipY <= shoulderY + 10) return null;
    const scanStart = Math.max(0, Math.floor(minY));
    const scanEnd = Math.min(h - 1, Math.ceil(maxY));
    if (scanEnd <= scanStart) return null;

    const shoulderCenterX = ((leftShoulder.x + rightShoulder.x) / 2) * w;
    const hipCenterX = ((leftHip.x + rightHip.x) / 2) * w;
    const leftShoulderX = leftShoulder.x * w;
    const rightShoulderX = rightShoulder.x * w;
    const leftHipX = leftHip.x * w;
    const rightHipX = rightHip.x * w;
    const isHips = section === 'hips';
    const samples = [];

    for (let y = scanStart; y <= scanEnd; y += 2) {
        const t = clampValue((y - shoulderY) / Math.max(1, (hipY - shoulderY)), 0, 1.22);
        const tForAxis = clampValue(t, 0, 1);
        const expectedCenterX = shoulderCenterX + (hipCenterX - shoulderCenterX) * tForAxis;
        const leftAxisX = leftShoulderX + (leftHipX - leftShoulderX) * tForAxis;
        const rightAxisX = rightShoulderX + (rightHipX - rightShoulderX) * tForAxis;
        const expectedWidth = Math.max(8, Math.abs(rightAxisX - leftAxisX));
        const span = getSpanByCenterCrossing(frontMask, y, expectedCenterX, 5, true);
        if (!span || span.len < Math.max(8, expectedWidth * (isHips ? 0.34 : 0.26))) continue;

        const spanCenter = (span.x1 + span.x2) / 2;
        const maxCenterDeviation = Math.max(14, expectedWidth * (isHips ? 0.62 : 0.50));
        const centerDeviation = Math.abs(spanCenter - expectedCenterX);
        if (centerDeviation > maxCenterDeviation) continue;

        const maxWidth = expectedWidth * (isHips ? 2.35 : 1.95);
        if (span.len > maxWidth) continue;
        const corridorPad = Math.max(isHips ? 26 : 18, expectedWidth * (isHips ? 0.55 : 0.42));
        const leftLimit = Math.min(leftAxisX, rightAxisX) - corridorPad;
        const rightLimit = Math.max(leftAxisX, rightAxisX) + corridorPad;
        if (span.x2 < leftLimit || span.x1 > rightLimit) continue;

        const centerScore = clampValue(1 - (centerDeviation / Math.max(1, maxCenterDeviation)), 0, 1);
        const widthScore = isHips
            ? clampValue(span.len / Math.max(1, expectedWidth * 1.3), 0, 1)
            : clampValue(1 - (span.len / Math.max(1, expectedWidth * 1.95)), 0, 1);
        samples.push({
            ...span,
            expectedWidth,
            centerDeviation,
            relativeY: y / Math.max(1, h - 1),
            confidence: 0.32 + centerScore * 0.22 + widthScore * 0.16,
            source: 'softAnatomy',
        });
    }
    if (!samples.length) return null;

    const smoothed = samples.map((sample, idx) => {
        const neighborhood = samples.filter((_, i) => Math.abs(i - idx) <= 2);
        return {
            sample,
            smoothedLen: median(neighborhood.map((item) => item.len)),
            smoothedConfidence: median(neighborhood.map((item) => item.confidence)),
        };
    });
    let best = smoothed[0];
    for (const item of smoothed) {
        if (mode === 'max') {
            if (item.smoothedLen > best.smoothedLen) best = item;
        } else if (item.smoothedLen < best.smoothedLen) {
            best = item;
        }
    }
    const near = samples.filter((sample) => Math.abs(sample.y - best.sample.y) <= 2);
    const x1 = Math.round(median(near.map((sample) => sample.x1)));
    const x2 = Math.round(median(near.map((sample) => sample.x2)));
    if (!isFinite(x1) || !isFinite(x2) || x2 <= x1) return null;
    return {
        ...best.sample,
        x1,
        x2,
        len: x2 - x1 + 1,
        confidence: clampValue(best.smoothedConfidence || best.sample.confidence || 0.42, 0.30, 0.70),
        source: mode === 'max' ? 'softAnatomyMax' : 'softAnatomyMin',
    };
}

function isValidDepth(widthCm, depthCm) {
    if (!widthCm || !depthCm || widthCm <= 0 || depthCm <= 0) return false;
    const ratio = depthCm / widthCm;
    return ratio >= 0.45 && ratio <= 1.6;
}

function estimateSideDepthCm(sideMask, relY, scaleCmPerPx, sidePose = null, torsoT = null) {
    if (!sideMask || !scaleCmPerPx) return null;
    const h = sideMask.height;
    const w = sideMask.width;
    const offsets = [0, -0.025, 0.025, -0.05, 0.05];
    const candidates = [];
    for (const off of offsets) {
        let y = clampValue((relY + off) * h, 0, h - 1);
        let expectedCenterX = w * 0.5;
        if (sidePose?.ok && sidePose.points) {
            const { leftShoulder, rightShoulder, leftHip, rightHip } = sidePose.points;
            const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * h;
            const hipY = ((leftHip.y + rightHip.y) / 2) * h;
            const shoulderCenterX = ((leftShoulder.x + rightShoulder.x) / 2) * w;
            const hipCenterX = ((leftHip.x + rightHip.x) / 2) * w;
            const t = torsoT != null && isFinite(torsoT)
                ? clampValue(torsoT, 0, 1.18)
                : clampValue((relY - 0.2) / 0.45, 0, 1);
            y = clampValue(shoulderY + (hipY - shoulderY) * (t + off * 1.6), 0, h - 1);
            expectedCenterX = shoulderCenterX + (hipCenterX - shoulderCenterX) * t;
        }
        const span = getSpanByCenterCrossing(sideMask, y, expectedCenterX, 5, true);
        if (!span || span.len < 6) continue;
        const centerPenalty = clampValue(1 - (Math.abs(((span.x1 + span.x2) / 2) - expectedCenterX) / Math.max(8, w * 0.16)), 0, 1);
        candidates.push({ depthCm: span.len * scaleCmPerPx, absOffset: Math.abs(off), offset: off, span, confidence: centerPenalty });
    }
    if (!candidates.length) return null;
    const exact = candidates.find((c) => c.absOffset === 0);
    const medianDepth = median(candidates.map((c) => c.depthCm));
    const medianConfidence = median(candidates.map((c) => c.confidence || 0.5)) || 0.5;
    const nearest = candidates.reduce((best, item) => (!best || item.absOffset < best.absOffset ? item : best), null);
    if (!exact) return { depthCm: medianDepth, source: 'sideNeighborMedian', consistent: false, confidence: medianConfidence, span: nearest?.span || null };
    const mismatch = Math.abs(exact.depthCm - medianDepth) / Math.max(1, medianDepth);
    if (mismatch <= 0.18) return { depthCm: exact.depthCm, source: 'sideExact', consistent: true, confidence: exact.confidence || medianConfidence, span: exact.span };
    return { depthCm: medianDepth, source: 'sideNeighborMedian', consistent: false, confidence: medianConfidence * 0.82, span: nearest?.span || null };
}

function measureCrossSectionWidth(maskObj, center, dir, maxSteps) {
    if (!maskObj || !center || !dir) return null;
    const { mask, width, height } = maskObj;
    const len = Math.hypot(dir.x, dir.y) || 1;
    const nx = dir.x / len;
    const ny = dir.y / len;
    const sample = (x, y) => {
        const ix = Math.round(x);
        const iy = Math.round(y);
        if (ix < 0 || ix >= width || iy < 0 || iy >= height) return false;
        return mask[iy * width + ix] === 1;
    };
    if (!sample(center.x, center.y)) return null;
    let neg = 0;
    let pos = 0;
    let gap = 0;
    for (let s = 1; s <= maxSteps; s++) {
        if (sample(center.x - nx * s, center.y - ny * s)) { neg = s; gap = 0; } else { gap++; }
        if (gap > 2) break;
    }
    gap = 0;
    for (let s = 1; s <= maxSteps; s++) {
        if (sample(center.x + nx * s, center.y + ny * s)) { pos = s; gap = 0; } else { gap++; }
        if (gap > 2) break;
    }
    const widthPx = neg + pos + 1;
    return widthPx >= 4 ? widthPx : null;
}

function measureLimb(maskObj, a, b, scaleCmPerPx, fallbackWidthCm, depthRatio = 0.78) {
    if (!maskObj || !a || !b || !scaleCmPerPx) {
        if (!fallbackWidthCm) return { value: null, method: null, confidence: 0 };
        return {
            value: fallbackWidthCm * Math.PI,
            method: 'lengthApprox',
            confidence: 0.38,
        };
    }
    const w = maskObj.width;
    const h = maskObj.height;
    const ax = a.x * w;
    const ay = a.y * h;
    const bx = b.x * w;
    const by = b.y * h;
    const dx = bx - ax;
    const dy = by - ay;
    const sectionDir = { x: -dy, y: dx };
    const samples = [];
    for (const t of [0.38, 0.48, 0.58]) {
        const center = { x: ax + dx * t, y: ay + dy * t };
        const widthPx = measureCrossSectionWidth(maskObj, center, sectionDir, Math.max(12, Math.hypot(dx, dy) * 0.32));
        if (widthPx) samples.push(widthPx);
    }
    if (!samples.length) {
        if (!fallbackWidthCm) return { value: null, method: null, confidence: 0 };
        return { value: fallbackWidthCm * Math.PI, method: 'lengthApprox', confidence: 0.34 };
    }
    const widthCm = median(samples) * scaleCmPerPx;
    const depthCm = widthCm * depthRatio;
    return {
        value: ellipseCircumference(widthCm / 2, Math.max(depthCm / 2, widthCm * 0.28)),
        method: 'maskSection',
        confidence: samples.length >= 2 ? 0.68 : 0.54,
    };
}

function applySanity(value, partKey, profile) {
    if (value == null) return { value: null, lowConfidence: true };
    const ranges = {
        chest: [0.35 * profile.heightCm, 0.78 * profile.heightCm],
        waist: [0.30 * profile.heightCm, 0.70 * profile.heightCm],
        hips: [0.35 * profile.heightCm, 0.80 * profile.heightCm],
    };
    const [min, max] = ranges[partKey] || [0, 999];
    const clamped = clampValue(value, min, max);
    return { value: clamped, lowConfidence: clamped !== value };
}

export function analyzeBodyScan({
    frontCanvas,
    frontCtx,
    frontMask = null,
    frontMaskSource = null,
    frontTorsoMask = null,
    frontTorsoMaskSource = null,
    sideCanvas = null,
    sideCtx = null,
    sideMask = null,
    sideMaskSource = null,
    landmarks,
    landmarksSide = null,
    profile,
    previousHipsEstimate = null,
} = {}) {
    const scanProfile = profile || getScanProfile();
    const poseValidation = validatePoseLandmarks(landmarks);
    const warnings = [...poseValidation.warnings];
    const errors = [...poseValidation.errors];
    const qualityReasons = { chest: [], waist: [], hips: [], arm: [], leg: [] };
    const methods = { chest: null, waist: null, hips: null, arm: null, leg: null };
    const confidence = { chest: 0, waist: 0, hips: 0, arm: 0, leg: 0 };

    if (!poseValidation.ok) {
        return { ok: false, errors, warnings, qualityReasons, methods, confidence, values: {}, overlay: null };
    }

    const { leftShoulder, rightShoulder, leftHip, rightHip } = poseValidation.points;
    const frontW = frontMask ? frontMask.width : (frontCanvas ? frontCanvas.width : 0);
    const frontH = frontMask ? frontMask.height : (frontCanvas ? frontCanvas.height : 0);
    const torsoAnchor = {
        x: (((leftShoulder.x + rightShoulder.x + leftHip.x + rightHip.x) / 4) * frontW),
        y: (((leftShoulder.y + rightShoulder.y + leftHip.y + rightHip.y) / 4) * frontH),
    };
    const personMask = frontMask || buildForegroundMask(frontCanvas, frontCtx, torsoAnchor);
    if (!personMask) {
        return { ok: false, errors: ['Не удалось выделить силуэт на фронтальном фото.'], warnings, qualityReasons, methods, confidence, values: {}, overlay: null };
    }
    const bounds = getMaskVerticalBounds(personMask);
    if (!bounds || bounds.height < 40) {
        return { ok: false, errors: ['Силуэт определён ненадёжно. Проверьте фон и освещение.'], warnings, qualityReasons, methods, confidence, values: {}, overlay: null };
    }

    const scaleCmPerPx = scanProfile.heightCm / bounds.height;
    if (!isFinite(scaleCmPerPx) || scaleCmPerPx <= 0) {
        return { ok: false, errors: ['Ошибка масштабирования по росту.'], warnings, qualityReasons, methods, confidence, values: {}, overlay: null };
    }
    const subjectHeightRatio = bounds.height / Math.max(1, personMask.height);
    const smallSubject = subjectHeightRatio < 0.55;
    if (smallSubject) {
        warnings.push('Человек занимает слишком малую часть кадра: масштаб и сечения менее надежны.');
    }

    const armRiskInfo = detectArmTorsoRisk(landmarks);
    warnings.push(...armRiskInfo.warnings);
    const externalTorsoSegmentation = buildExternalTorsoSegmentation(personMask, frontTorsoMask, frontTorsoMaskSource);
    const poseTorsoSegmentation = buildPoseAwareTorsoMask(personMask, landmarks, torsoAnchor);
    const torsoSegmentation = externalTorsoSegmentation || poseTorsoSegmentation;
    const mask = torsoSegmentation?.mask || personMask;
    const limbMask = personMask;

    const sidePoseValidation = landmarksSide ? validateSidePoseLandmarks(landmarksSide) : null;
    if (sidePoseValidation) {
        warnings.push(...sidePoseValidation.warnings);
        if (!sidePoseValidation.ok && sidePoseValidation.errors.length) {
            warnings.push(`Фото сбоку не используется: ${sidePoseValidation.errors.join(' ')}`);
        }
    }
    const sideCandidateReady = !!(landmarksSide && sideCanvas && sideCanvas.width > 0 && sideCanvas.height > 0);
    const resolvedSideMask = sideMask || (sideCandidateReady ? buildForegroundMask(sideCanvas, sideCtx, { x: sideCanvas.width * 0.5, y: sideCanvas.height * 0.5 }) : null);
    const sideBounds = resolvedSideMask ? getMaskVerticalBounds(resolvedSideMask) : null;
    const sideUsable = !!(sidePoseValidation?.ok && resolvedSideMask && sideBounds && sideBounds.height > 40);
    const scaleCmPerPxSide = sideUsable ? scanProfile.heightCm / sideBounds.height : null;

    const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * mask.height;
    const hipY = ((leftHip.y + rightHip.y) / 2) * mask.height;
    const torsoDelta = Math.max(10, hipY - shoulderY);
    const shoulderWidthPx = Math.abs((rightShoulder.x - leftShoulder.x) * mask.width);
    const profileStartY = shoulderY + torsoDelta * 0.18;
    const profileEndY = hipY + torsoDelta * 0.20;
    const torsoProfile = buildTorsoProfile(mask, leftShoulder, rightShoulder, leftHip, rightHip, profileStartY, profileEndY, 'torso');
    const hipsProfile = buildTorsoProfile(mask, leftShoulder, rightShoulder, leftHip, rightHip, hipY - torsoDelta * 0.08, hipY + torsoDelta * 0.32, 'hips');

    const chestMinY = shoulderY + torsoDelta * 0.26;
    const chestMaxY = shoulderY + torsoDelta * 0.43;
    const waistStartY = shoulderY + torsoDelta * 0.48;
    const waistEndY = shoulderY + torsoDelta * 0.78;
    const hipsMinY = hipY - torsoDelta * 0.06;
    const hipsMaxY = hipY + torsoDelta * 0.26;

    let chestSpan = selectChestSpanFromProfile(torsoProfile, chestMinY, chestMaxY, shoulderY, hipY, shoulderWidthPx, armRiskInfo.risk);
    let waistSpan = findWaistSpanByTorsoMask(mask, leftShoulder, rightShoulder, leftHip, rightHip, waistStartY, waistEndY);
    let hipSpan = selectSpanFromProfile(hipsProfile, hipsMinY, hipsMaxY, 'max');
    let hipSearchSource = hipSpan ? 'narrowWindow' : 'none';
    const semanticFallbackParts = {};
    if (!chestSpan && externalTorsoSegmentation && poseTorsoSegmentation?.diagnostics?.fallbackReason == null) {
        const poseMask = poseTorsoSegmentation.mask;
        const poseTorsoProfile = buildTorsoProfile(poseMask, leftShoulder, rightShoulder, leftHip, rightHip, profileStartY, profileEndY, 'torso');
        const poseChestSpan = selectChestSpanFromProfile(poseTorsoProfile, chestMinY, chestMaxY, shoulderY, hipY, shoulderWidthPx, armRiskInfo.risk);
        if (poseChestSpan) {
            chestSpan = {
                ...poseChestSpan,
                confidence: clampValue((poseChestSpan.confidence || 0.5) * 0.88, 0.34, 0.86),
                source: `poseTorsoFallback:${poseChestSpan.source || 'span'}`,
            };
            semanticFallbackParts.chest = poseTorsoSegmentation.mask.source || 'poseParts';
            qualityReasons.chest.push('semantic body-part mask не дала сечение груди, использован pose fallback');
        }
    }
    if (!hipSpan) {
        hipSearchSource = 'expandedFallback';
        hipSpan = selectSpanFromProfile(hipsProfile, hipY - torsoDelta * 0.10, hipY + torsoDelta * 0.34, 'max');
    }
    const softFallbackParts = {};
    const markSoftSpan = (span, partKey, source) => {
        if (!span) return null;
        const confidenceBase = span.confidence != null ? span.confidence : 0.45;
        softFallbackParts[partKey] = source;
        qualityReasons[partKey].push('сечение найдено по мягкой маске силуэта');
        return {
            ...span,
            confidence: clampValue(confidenceBase * 0.82, 0.34, 0.72),
            source: `${source}:${span.source || 'span'}`,
            softFallback: true,
        };
    };

    if (!waistSpan) {
        const softWaistSpan = findSoftBodySpanByMask(personMask, leftShoulder, rightShoulder, leftHip, rightHip, waistStartY, waistEndY, 'min', 'torso');
        if (softWaistSpan) waistSpan = markSoftSpan(softWaistSpan, 'waist', 'softPersonMask');
    }

    if (!hipSpan) {
        const softHipSpan = findSoftBodySpanByMask(personMask, leftShoulder, rightShoulder, leftHip, rightHip, hipsMinY, hipsMaxY, 'max', 'hips');
        if (softHipSpan) {
            hipSpan = markSoftSpan(softHipSpan, 'hips', 'softPersonMask');
            hipSearchSource = hipSearchSource === 'none' ? 'softPersonMask' : `${hipSearchSource}+softPersonMask`;
        }
    }

    if (chestSpan?.shoulderLike) qualityReasons.chest.push('сечение похоже на плечевой пояс, уверенность снижена');
    if (armRiskInfo.risk !== 'low') {
        qualityReasons.chest.push('руки близко к корпусу');
        qualityReasons.waist.push('руки близко к корпусу');
    }
    if (hipSpan && !hipSpan.peakStable) qualityReasons.hips.push('нет стабильного пика по y');

    const waistConf = waistSpan ? (waistSpan.confidence || 0) : 0;
    const hipsConfRaw = hipSpan ? (hipSpan.confidence || 0) : 0;
    const hipsWeak = !hipSpan || hipsConfRaw < 0.45 || (hipSpan.peakStable === false);
    if (waistConf >= 0.72 && hipsWeak) {
        const estHipFromWaistY = clampValue(waistSpan.y + torsoDelta * 0.23, hipY - torsoDelta * 0.05, hipY + torsoDelta * 0.34);
        const hipFromWaistSpan =
            selectSpanFromProfile(hipsProfile, estHipFromWaistY - torsoDelta * 0.09, estHipFromWaistY + torsoDelta * 0.09, 'max') ||
            getFrontTorsoSpanAtY(mask, estHipFromWaistY, leftShoulder, rightShoulder, leftHip, rightHip, 'hips');
        if (hipFromWaistSpan) {
            hipSpan = { ...hipFromWaistSpan, confidence: Math.max(hipFromWaistSpan.confidence || 0.4, 0.42), source: 'fromWaistFallback' };
            hipSearchSource = 'fromWaistFallback';
            qualityReasons.hips.push('уровень бедер оценен от талии');
        }
    }

    const circFromFront = (span, partKey, relY) => {
        if (!span) return { value: null, method: null, depthSource: 'noSpan', depthConsistent: false, sideSpan: null };
        const widthCm = span.len * scaleCmPerPx;
        const a = widthCm / 2;
        let b = null;
        let depthSource = 'frontOnlyApprox';
        let depthConsistent = false;
        let sideSpan = null;
        if (sideUsable && resolvedSideMask && scaleCmPerPxSide) {
            const torsoT = clampValue((span.y - shoulderY) / Math.max(1, torsoDelta), 0, 1.2);
            const depthInfo = estimateSideDepthCm(resolvedSideMask, relY, scaleCmPerPxSide, sidePoseValidation, torsoT);
            if (depthInfo && isValidDepth(widthCm, depthInfo.depthCm)) {
                b = depthInfo.depthCm / 2;
                depthSource = depthInfo.source;
                depthConsistent = !!depthInfo.consistent;
                sideSpan = depthInfo.span || null;
            } else if (depthInfo) {
                depthSource = 'sideDepthInvalid';
            }
        }
        if (b == null) {
            b = scanProfile.k[partKey] * a;
            return { value: ellipseCircumference(a, b), method: 'frontApprox', depthSource, depthConsistent, sideSpan };
        }
        return { value: ellipseCircumference(a, b), method: 'measured', depthSource, depthConsistent, sideSpan };
    };

    const blendWithStats = (geomValue, partKey, method) => {
        if (geomValue == null) return null;
        const statValue = scanProfile.stats[partKey] * scanProfile.heightCm;
        const alpha = method === 'measured' ? 0.78 : 0.64;
        return alpha * geomValue + (1 - alpha) * statValue;
    };

    const chestGeom = circFromFront(chestSpan, 'chest', chestSpan ? chestSpan.relativeY : 0.34);
    const waistGeom = circFromFront(waistSpan, 'waist', waistSpan ? waistSpan.relativeY : 0.58);
    const hipsGeom = circFromFront(hipSpan, 'hips', hipSpan ? hipSpan.relativeY : 0.74);
    methods.chest = chestGeom.method;
    methods.waist = waistGeom.method;
    methods.hips = hipsGeom.method;
    let chestBlended = blendWithStats(chestGeom.value, 'chest', methods.chest);
    let waistBlended = blendWithStats(waistGeom.value, 'waist', methods.waist);
    let hipsBlended = blendWithStats(hipsGeom.value, 'hips', methods.hips);
    let chestFallbackUsed = false;
    let waistFallbackUsed = false;
    let hipsFallbackUsed = false;

    const statFallbackValue = (partKey) => {
        const bmiDelta = scanProfile.bmi - 22;
        const bmiCm = {
            chest: scanProfile.gender === 'female' ? 0.65 : 0.75,
            waist: scanProfile.gender === 'female' ? 1.10 : 1.25,
            hips: scanProfile.gender === 'female' ? 0.85 : 0.70,
        };
        return (scanProfile.stats[partKey] * scanProfile.heightCm) + bmiDelta * (bmiCm[partKey] || 0.8);
    };

    if (smallSubject && methods.chest !== 'measured') {
        chestBlended = statFallbackValue('chest');
        chestFallbackUsed = true;
        methods.chest = 'statFallback';
        qualityReasons.chest.push('человек занимает мало кадра');
    }
    if (smallSubject && methods.waist !== 'measured') {
        waistBlended = statFallbackValue('waist');
        waistFallbackUsed = true;
        methods.waist = 'statFallback';
        qualityReasons.waist.push('человек занимает мало кадра');
    }
    if (smallSubject && methods.hips !== 'measured') {
        hipsBlended = statFallbackValue('hips');
        hipsFallbackUsed = true;
        methods.hips = 'statFallback';
        qualityReasons.hips.push('человек занимает мало кадра');
    }

    const chestBaseConf = chestSpan ? (chestSpan.confidence || 0) : 0;
    const waistBaseConf = waistSpan ? (waistSpan.confidence || 0) : 0;
    if ((hipsBlended == null || !isFinite(hipsBlended)) && chestBlended != null && waistBlended != null && chestBaseConf >= 0.68 && waistBaseConf >= 0.68) {
        const bmiAdj = clampValue((scanProfile.bmi - 22) * 0.004, -0.03, 0.06);
        const waistRatioBase = scanProfile.gender === 'female' ? 1.10 : 1.04;
        const chestRatioBase = scanProfile.gender === 'female' ? 1.00 : 0.95;
        hipsBlended = 0.72 * waistBlended * (waistRatioBase + bmiAdj) + 0.28 * chestBlended * (chestRatioBase + bmiAdj * 0.5);
        hipsFallbackUsed = true;
        methods.hips = 'statFallback';
        hipSearchSource = hipSearchSource === 'none' ? 'waistChestStatFallback' : `${hipSearchSource}+waistChestStatFallback`;
    }
    if ((chestBlended == null || !isFinite(chestBlended)) && waistBlended != null && hipsBlended != null && waistBaseConf >= 0.62) {
        const bmiAdj = clampValue((scanProfile.bmi - 22) * 0.0035, -0.02, 0.05);
        const chestFromWaist = waistBlended * (scanProfile.gender === 'female' ? 1.12 : 1.16) + bmiAdj * 40;
        const chestFromHips = hipsBlended * (scanProfile.gender === 'female' ? 0.96 : 1.00);
        chestBlended = 0.62 * chestFromWaist + 0.38 * chestFromHips;
        chestFallbackUsed = true;
        methods.chest = 'statFallback';
    }
    if ((waistBlended == null || !isFinite(waistBlended)) && chestBlended != null && hipsBlended != null && chestBaseConf >= 0.62) {
        const bmiAdj = clampValue((scanProfile.bmi - 22) * 0.003, -0.02, 0.05);
        waistBlended = 0.56 * chestBlended * (scanProfile.gender === 'female' ? 0.80 : 0.88) +
            0.44 * hipsBlended * (scanProfile.gender === 'female' ? 0.72 : 0.80) +
            bmiAdj * 30;
        waistFallbackUsed = true;
        methods.waist = 'statFallback';
    }
    if (chestBlended == null || !isFinite(chestBlended)) {
        chestBlended = statFallbackValue('chest');
        chestFallbackUsed = true;
        methods.chest = 'statFallback';
    }
    if (waistBlended == null || !isFinite(waistBlended)) {
        waistBlended = statFallbackValue('waist');
        waistFallbackUsed = true;
        methods.waist = 'statFallback';
    }
    if (hipsBlended == null || !isFinite(hipsBlended)) {
        hipsBlended = statFallbackValue('hips');
        hipsFallbackUsed = true;
        methods.hips = 'statFallback';
        hipSearchSource = hipSearchSource === 'none' ? 'directStatFallback' : `${hipSearchSource}+directStatFallback`;
    }

    const chestChecked = applySanity(chestBlended, 'chest', scanProfile);
    const waistChecked = applySanity(waistBlended, 'waist', scanProfile);
    const hipsChecked = applySanity(hipsBlended, 'hips', scanProfile);
    let chest = chestChecked.value;
    let waist = waistChecked.value;
    let hips = hipsChecked.value;

    confidence.chest = clampValue((chestSpan ? chestSpan.confidence || 0.55 : 0.22) * (methods.chest === 'measured' ? 1 : 0.78), 0, 1);
    confidence.waist = clampValue((waistSpan ? waistSpan.confidence || 0.50 : 0.2) * (methods.waist === 'measured' ? 1 : 0.76), 0, 1);
    confidence.hips = clampValue((hipSpan ? hipSpan.confidence || 0.55 : 0.22) * (methods.hips === 'measured' ? 1 : 0.78), 0, 1);
    if (chestFallbackUsed) confidence.chest = clampValue((confidence.waist * 0.55 + confidence.hips * 0.45) * 0.72, 0, 1);
    if (waistFallbackUsed) confidence.waist = clampValue((confidence.chest * 0.58 + confidence.hips * 0.42) * 0.72, 0, 1);
    if (hipsFallbackUsed) confidence.hips = clampValue((confidence.chest * 0.55 + confidence.waist * 0.45) * 0.74, 0, 1);
    if (methods.chest === 'statFallback' && !chestSpan) confidence.chest = Math.max(confidence.chest, 0.30);
    if (methods.waist === 'statFallback' && !waistSpan) confidence.waist = Math.max(confidence.waist, 0.28);
    if (methods.hips === 'statFallback' && !hipSpan) confidence.hips = Math.max(confidence.hips, 0.28);

    if (hips != null && waist != null && hips < (waist - 2)) {
        hips = waist - 2;
        confidence.hips *= 0.72;
        qualityReasons.hips.push('бедра оказались меньше талии, применен sanity clamp');
    }
    if (hips != null && previousHipsEstimate != null) {
        const maxJump = Math.max(6, previousHipsEstimate * 0.12);
        const delta = hips - previousHipsEstimate;
        if (Math.abs(delta) > maxJump) {
            hips = previousHipsEstimate + Math.sign(delta) * maxJump;
            confidence.hips *= 0.8;
            qualityReasons.hips.push('резкий скачок, применено ограничение delta');
        }
    }

    if (!chestSpan) qualityReasons.chest.push('сечение не найдено');
    if (!waistSpan) qualityReasons.waist.push('сечение не найдено');
    if (!hipSpan) qualityReasons.hips.push('сечение не найдено');
    const sideApproxReason = landmarksSide && !sideUsable
        ? 'профильное фото не прошло валидацию, глубина оценена приблизительно'
        : 'нет профильного фото, глубина оценена приблизительно';
    if (methods.chest === 'frontApprox') qualityReasons.chest.push(sideApproxReason);
    if (methods.waist === 'frontApprox') qualityReasons.waist.push(sideApproxReason);
    if (methods.hips === 'frontApprox') qualityReasons.hips.push(sideApproxReason);
    if (methods.chest === 'statFallback') qualityReasons.chest.push('грудь оценена статистически');
    if (methods.waist === 'statFallback') qualityReasons.waist.push('талия оценена статистически');
    if (methods.hips === 'statFallback') qualityReasons.hips.push('бедра оценены статистически');
    if (chestChecked.lowConfidence) qualityReasons.chest.push('значение вне диапазона, применен clamp');
    if (waistChecked.lowConfidence) qualityReasons.waist.push('значение вне диапазона, применен clamp');
    if (hipsChecked.lowConfidence) qualityReasons.hips.push('значение вне диапазона, применен clamp');
    if (confidence.chest < 0.55) qualityReasons.chest.push('нестабильная геометрия');
    if (confidence.waist < 0.55) qualityReasons.waist.push('нестабильная геометрия');
    if (confidence.hips < 0.55) qualityReasons.hips.push('нестабильная геометрия');

    const leftElbow = getPoint(landmarks, 13);
    const rightElbow = getPoint(landmarks, 14);
    const leftKnee = getPoint(landmarks, 25);
    const rightKnee = getPoint(landmarks, 26);
    const c = getGenderCoefficients(scanProfile.gender);
    const distNorm = (a, b) => Math.hypot((a.x - b.x) * limbMask.width, (a.y - b.y) * limbMask.height);

    let armInfo = { value: null, method: null, confidence: 0 };
    if (leftShoulder && leftElbow) {
        const upperArmPx = distNorm(leftShoulder, leftElbow);
        armInfo = measureLimb(limbMask, leftShoulder, leftElbow, scaleCmPerPx, upperArmPx * scaleCmPerPx * c.armLengthToWidth, 0.72);
    } else if (rightShoulder && rightElbow) {
        const upperArmPx = distNorm(rightShoulder, rightElbow);
        armInfo = measureLimb(limbMask, rightShoulder, rightElbow, scaleCmPerPx, upperArmPx * scaleCmPerPx * c.armLengthToWidth, 0.72);
    }
    let arm = armInfo.value;
    methods.arm = armInfo.method;
    confidence.arm = armInfo.confidence;
    if (arm == null || !isFinite(arm)) {
        const armBase = (scanProfile.gender === 'female' ? 0.16 : 0.17) * scanProfile.heightCm;
        const armAdj = ((chest || 92) - 92) * 0.08 + ((waist || 80) - 80) * 0.05 + (scanProfile.bmi - 22) * 0.35;
        arm = clampValue(armBase + armAdj, 20, 60);
        methods.arm = 'statFallback';
        confidence.arm = 0.35;
    }
    if (methods.arm !== 'maskSection') qualityReasons.arm.push('обхват бицепса рассчитан приблизительно');

    let legInfo = { value: null, method: null, confidence: 0 };
    if (leftHip && leftKnee) {
        const thighPx = distNorm(leftHip, leftKnee);
        legInfo = measureLimb(limbMask, leftHip, leftKnee, scaleCmPerPx, thighPx * scaleCmPerPx * c.legLengthToWidth, 0.82);
    } else if (rightHip && rightKnee) {
        const thighPx = distNorm(rightHip, rightKnee);
        legInfo = measureLimb(limbMask, rightHip, rightKnee, scaleCmPerPx, thighPx * scaleCmPerPx * c.legLengthToWidth, 0.82);
    }
    let leg = legInfo.value;
    methods.leg = legInfo.method;
    confidence.leg = legInfo.confidence;
    if (leg == null || !isFinite(leg)) {
        const legBase = (scanProfile.gender === 'female' ? 0.30 : 0.285) * scanProfile.heightCm;
        const legAdj = ((hips || 98) - 98) * 0.10 + (scanProfile.bmi - 22) * 0.5;
        leg = clampValue(legBase + legAdj, 40, 90);
        methods.leg = 'statFallback';
        confidence.leg = 0.35;
    }
    if (methods.leg !== 'maskSection') qualityReasons.leg.push('обхват ноги рассчитан приблизительно');

    const clampLimb = (value, key, min, max) => {
        if (value == null || !isFinite(value)) return value;
        const clamped = clampValue(value, min, max);
        if (clamped !== value) {
            confidence[key] = clampValue(confidence[key] * 0.72, 0, 1);
            qualityReasons[key].push('значение вне диапазона, применен clamp');
        }
        return clamped;
    };
    arm = clampLimb(arm, 'arm', 20, scanProfile.gender === 'female' ? 50 : 60);
    leg = clampLimb(leg, 'leg', 40, scanProfile.gender === 'female' ? 80 : 90);

    const values = { chest, waist, hips, arm, leg };
    const overlay = {
        chestY: chestSpan ? chestSpan.y : chestMinY,
        waistY: waistSpan ? waistSpan.y : ((waistStartY + waistEndY) / 2),
        hipsY: hipSpan ? hipSpan.y : hipsMaxY,
        chestSpan,
        waistSpan,
        hipsSpan: hipSpan,
        confidence,
        windows: {
            chest: { y1: chestMinY, y2: chestMaxY },
            waist: { y1: waistStartY, y2: waistEndY },
            hips: { y1: hipsMinY, y2: hipsMaxY },
        },
        sideSpans: {
            chest: chestGeom.sideSpan,
            waist: waistGeom.sideSpan,
            hips: hipsGeom.sideSpan,
        },
    };
    return {
        ok: true,
        errors,
        warnings,
        values,
        methods,
        confidence,
        qualityReasons,
        overlay,
        nextHipsEstimate: hips,
        diagnostics: {
            bounds,
            scaleCmPerPx,
            subjectHeightRatio,
            armRisk: armRiskInfo.risk,
            hipSearchSource,
            maskSource: frontMaskSource || personMask.source || 'colorThreshold',
            torsoMaskSource: mask.source || 'personMask',
            partSegmentation: torsoSegmentation?.diagnostics || null,
            semanticFallbackParts,
            softFallbackParts,
            side: {
                present: !!landmarksSide,
                usable: sideUsable,
                maskSource: sideMaskSource || resolvedSideMask?.source || null,
                errors: sidePoseValidation?.errors || [],
                warnings: sidePoseValidation?.warnings || [],
                bounds: sideBounds,
            },
            profile: scanProfile,
        },
    };
}
