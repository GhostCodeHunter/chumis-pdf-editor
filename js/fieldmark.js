// A signature field as it looks WITHOUT the fallback “?” that many signers draw inside it.
// The “?” is found by its colour: each drawing operation inside the field is rendered on its own and the yellow ones (and any
// outline drawn around them) are left out of a final render of the field. Nothing is painted over, so the text underneath is intact.
import { opBoxes, pdfjsLib } from './pdfio.js';

const yellowPixels = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] > 140 && d[i + 2] < 130 && d[i] - d[i + 2] > 70) n++; return n; };

async function drawRegion(page, rect, scale, filter, transparent = false) {
  const vp = page.getViewport({ scale, offsetX: -rect.x * scale, offsetY: -rect.y * scale });
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.ceil(rect.w * scale)); c.height = Math.max(2, Math.ceil(rect.h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true }); if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  await page.render({ canvasContext: ctx, canvas: c, viewport: vp, operationsFilter: filter, background: transparent ? 'rgba(0,0,0,0)' : '#ffffff' }).promise;
  return c;
}

/** Returns a canvas of the field (rect = display points) without its yellow “?”, or null if the field has none. */
export async function renderCleanField(pdf, pageIndex, rect, scale = 4) {
  const O = pdfjsLib.OPS, { fn, boxes } = await opBoxes(pdf, pageIndex); if (!boxes.length) return null;
  const PAINT = new Set([O.stroke, O.closeStroke, O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke, O.constructPath, O.showText, O.showSpacedText, O.nextLineShowText, O.nextLineSetSpacingShowText, O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintImageXObjectRepeat, O.paintImageMaskXObjectRepeat, O.paintSolidColorImageMask, O.shadingFill].filter(v => v !== undefined));
  const inside = b => b.x0 >= rect.x - 2 && b.x1 <= rect.x + rect.w + 2 && b.y0 >= rect.y - 2 && b.y1 <= rect.y + rect.h + 2;
  const page0 = await pdf.getPage(pageIndex + 1), ol = await page0.getOperatorList();
  const overlap = r => Math.max(0, Math.min(r.x1, rect.x + rect.w) - Math.max(r.x0, rect.x)) * Math.max(0, Math.min(r.y1, rect.y + rect.h) - Math.max(r.y0, rect.y));
  let group = null; // [begin, end] of the drawing operations of THIS field's appearance
  for (let k = 0; k < fn.length; k++) if (fn[k] === O.beginAnnotation) {
    let e = k + 1; while (e < fn.length && fn[e] !== O.endAnnotation) e++;
    const inner = boxes.filter(b => b.i > k && b.i < e); if (!inner.length) continue;
    const u = { x0: Math.min(...inner.map(b => b.x0)), y0: Math.min(...inner.map(b => b.y0)), x1: Math.max(...inner.map(b => b.x1)), y1: Math.max(...inner.map(b => b.y1)) };
    const score = overlap(u) / (rect.w * rect.h); if (score > 0.5 && (!group || score > group.score)) group = { b: k, e, score };
  }
  const inGroup = k => !group || (k > group.b && k < group.e);
  const cands = boxes.filter(b => PAINT.has(b.fn) && inGroup(b.i) && inside(b) && !(b.x1 - b.x0 > rect.w * 0.9 && b.y1 - b.y0 > rect.h * 0.9)); // not the field's own background
  if (!cands.length || cands.length > 80) return null;
  const page = await pdf.getPage(pageIndex + 1);
  const yellow = [];
  for (const b of cands) {                       // draw each candidate alone (all state operations stay on) and look for yellow
    const c = await drawRegion(page, rect, 2, k => !PAINT.has(fn[k]) || k === b.i);
    if (yellowPixels(c) >= 8) yellow.push(b);
  }
  if (!yellow.length) return null;
  const U = { x0: Math.min(...yellow.map(b => b.x0)) - 1.5, y0: Math.min(...yellow.map(b => b.y0)) - 1.5, x1: Math.max(...yellow.map(b => b.x1)) + 1.5, y1: Math.max(...yellow.map(b => b.y1)) + 1.5 };
  const skip = new Set(yellow.map(b => b.i));
  const vector = new Set([O.stroke, O.closeStroke, O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke, O.constructPath].filter(v => v !== undefined));
  const area = r => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0), uArea = area(U);
  for (const b of cands) { // an outline or shadow drawn around the “?”: a shape that sits (almost) entirely on it and is not bigger than it
    if (!vector.has(b.fn)) continue;
    const inter = area({ x0: Math.max(b.x0, U.x0), x1: Math.min(b.x1, U.x1), y0: Math.max(b.y0, U.y0), y1: Math.min(b.y1, U.y1) });
    if (inter >= 0.6 * area(b) && area(b) <= 1.8 * uArea) skip.add(b.i);
  }
  // the field's own plain-white background is left out too, so the text can sit above the tick (as it does in Acrobat)
  const big = boxes.filter(b => vector.has(b.fn) && b.x1 - b.x0 >= rect.w * 0.9 && b.y1 - b.y0 >= rect.h * 0.9 && b.x1 - b.x0 <= rect.w + 12 && b.y1 - b.y0 <= rect.h + 12 && b.x0 >= rect.x - 8 && b.y0 >= rect.y - 8);
  for (const b of big) {
    const c = await drawRegion(page, rect, 1, k => !PAINT.has(fn[k]) || k === b.i, true), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) ink++;
    if (!ink) skip.add(b.i);
  }
  if (!group) return drawRegion(page, rect, scale, k => !skip.has(k)); // appearance not separable: the whole region, on white
  const out = await drawRegion(page, rect, scale, k => !skip.has(k) && (!PAINT.has(fn[k]) || inGroup(k)), true); out.layered = true; return out; // only this field's own drawing, on a transparent canvas
}
