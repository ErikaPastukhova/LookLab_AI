/**
 * Prototype renderer for VirtualTryOn.
 * Сейчас это простое наложение оверлея (canvas 2D).
 * В будущем достаточно заменить реализацию этой функции на ML/нейросетевую.
 */

/**
 * @typedef {Object} ClothingItem
 * @property {string} id
 * @property {string} name
 * @property {'top'|'bottom'|'dress'|'outerwear'|'skirt'} category
 * @property {string} categoryLabel
 * @property {string} color
 * @property {string} garmentImageUrl
 * @property {{x:number,y:number,w:number,h:number}} overlayPlacement
 */

/**
 * @typedef {Object} RenderTryOnArgs
 * @property {HTMLCanvasElement} canvas
 * @property {HTMLImageElement} photo
 * @property {ClothingItem} clothingItem
 * @property {{x:number,y:number,w:number,h:number}} placement
 */

function clearCanvas(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(248,250,252,1)';
  ctx.fillRect(0, 0, w, h);
}

function drawPhotoCover(ctx, w, h, img) {
  const imgRatio = img.width / img.height;
  const canvasRatio = w / h;

  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;

  if (imgRatio > canvasRatio) {
    // Image is wider: crop left/right.
    sh = img.height;
    sw = sh * canvasRatio;
    sx = (img.width - sw) / 2;
  } else {
    // Image is taller: crop top/bottom.
    sw = img.width;
    sh = sw / canvasRatio;
    sy = (img.height - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

function rgba(hex, alpha) {
  // hex like #RRGGBB
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawOverlay(ctx, w, h, item, placement) {
  const x = placement.x * w;
  const y = placement.y * h;
  const ow = placement.w * w;
  const oh = placement.h * h;

  // Subtle shadow under overlay.
  ctx.save();
  ctx.shadowColor = rgba(item.color, 0.35);
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;

  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(item.color, 0.32);
  ctx.strokeStyle = rgba(item.color, 0.8);
  ctx.lineWidth = Math.max(2, w * 0.004);

  const category = item.category;
  if (category === 'top') {
    // Torso.
    roundRect(ctx, x, y, ow, oh * 0.75, Math.min(ow, oh) * 0.12);
    ctx.fill();
    ctx.stroke();

    // Sleeves.
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(item.color, 0.28);
    roundRect(ctx, x - ow * 0.14, y + oh * 0.16, ow * 0.18, oh * 0.42, ow * 0.08);
    ctx.fill();
    roundRect(ctx, x + ow * 0.96, y + oh * 0.16, ow * 0.18, oh * 0.42, ow * 0.08);
    ctx.fill();
  } else if (category === 'bottom') {
    // Pants.
    roundRect(ctx, x + ow * 0.06, y, ow * 0.88, oh * 0.92, ow * 0.09);
    ctx.fill();
    ctx.stroke();

    // Slight knee highlight.
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba('#ffffff', 0.18);
    roundRect(ctx, x + ow * 0.18, y + oh * 0.42, ow * 0.64, oh * 0.18, ow * 0.06);
    ctx.fill();
  } else if (category === 'dress') {
    // Torso.
    roundRect(ctx, x, y, ow, oh * 0.35, ow * 0.12);
    ctx.fill();
    ctx.stroke();

    // Skirt shape (trapezoid-ish).
    ctx.beginPath();
    ctx.moveTo(x + ow * 0.08, y + oh * 0.33);
    ctx.lineTo(x + ow * 0.92, y + oh * 0.33);
    ctx.lineTo(x + ow * 0.75, y + oh);
    ctx.lineTo(x + ow * 0.25, y + oh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Collar line.
    ctx.lineWidth = Math.max(2, w * 0.003);
    ctx.strokeStyle = rgba('#ffffff', 0.45);
    ctx.beginPath();
    ctx.moveTo(x + ow * 0.3, y + oh * 0.22);
    ctx.lineTo(x + ow * 0.7, y + oh * 0.22);
    ctx.stroke();
  } else if (category === 'outerwear') {
    // Jacket/coat outer shape.
    roundRect(ctx, x, y, ow, oh, Math.min(ow, oh) * 0.14);
    ctx.fill();
    ctx.stroke();

    // Lapels / front opening.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba('#ffffff', 0.5);
    ctx.lineWidth = Math.max(2, w * 0.003);
    ctx.beginPath();
    ctx.moveTo(x + ow * 0.5, y + oh * 0.18);
    ctx.lineTo(x + ow * 0.42, y + oh * 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + ow * 0.5, y + oh * 0.18);
    ctx.lineTo(x + ow * 0.58, y + oh * 0.85);
    ctx.stroke();
  } else if (category === 'skirt') {
    // Waist.
    roundRect(ctx, x, y, ow, oh * 0.22, ow * 0.1);
    ctx.fill();
    ctx.stroke();

    // Skirt cone.
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(x + ow * 0.12, y + oh * 0.18);
    ctx.lineTo(x + ow * 0.88, y + oh * 0.18);
    ctx.lineTo(x + ow * 0.72, y + oh);
    ctx.lineTo(x + ow * 0.28, y + oh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Pattern stripe.
    ctx.fillStyle = rgba('#ffffff', 0.18);
    ctx.beginPath();
    ctx.moveTo(x + ow * 0.44, y + oh * 0.38);
    ctx.lineTo(x + ow * 0.56, y + oh * 0.38);
    ctx.lineTo(x + ow * 0.62, y + oh * 0.85);
    ctx.lineTo(x + ow * 0.38, y + oh * 0.85);
    ctx.closePath();
    ctx.fill();
  }

  // Top highlight / transparency.
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = rgba(item.color, 0.12);
  roundRect(ctx, x, y, ow, oh * 0.22, Math.min(ow, oh) * 0.1);
  ctx.fill();

  ctx.restore();
}

/**
 * Contract for future ML renderer:
 * - in this prototype version: placement comes from clothingItem.overlayPlacement
 * - later: placement can be computed by a segmentation model and passed in.
 *
 * @param {RenderTryOnArgs} args
 * @returns {Promise<void>}
 */
export async function applyClothingToPhoto({ canvas, photo, clothingItem, placement }) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return;

  clearCanvas(ctx, w, h);
  drawPhotoCover(ctx, w, h, photo);

  if (!clothingItem) return;

  drawOverlay(ctx, w, h, clothingItem, placement || clothingItem.overlayPlacement);
  // Async for ML compatibility.
  return Promise.resolve();
}

