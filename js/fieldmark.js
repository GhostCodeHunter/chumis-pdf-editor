// A signature field as it looks WITHOUT the fallback “?” that many signers draw inside it.
// The “?” is found by its colour: each drawing operation inside the field is rendered on its own and the yellow ones (and any
// outline drawn around them) are left out of a final render of the field. Nothing is painted over, so the text underneath is intact.
import { opBoxes, pdfjsLib } from './pdfio.js';

const yellowPixels = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] > 140 && d[i + 2] < 130 && d[i] - d[i + 2] > 70) n++; return n; };

async function drawRegion(page, rect, scale, filter) {
  const vp = page.getViewport({ scale, offsetX: -rect.x * scale, offsetY: -rect.y * scale });
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.ceil(rect.w * scale)); c.height = Math.max(2, Math.ceil(rect.h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport: vp, operationsFilter: filter }).promise;
  return c;
}

/** Returns a canvas of the field (rect = display points) without its yellow “?”, or null if the field has none. */
export async function renderCleanField(pdf, pageIndex, rect, scale = 4) {
  const O = pdfjsLib.OPS, { fn, boxes } = await opBoxes(pdf, pageIndex); if (!boxes.length) return null;
  const PAINT = new Set([O.stroke, O.closeStroke, O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke, O.constructPath, O.showText, O.showSpacedText, O.nextLineShowText, O.nextLineSetSpacingShowText, O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintImageXObjectRepeat, O.paintImageMaskXObjectRepeat, O.paintSolidColorImageMask, O.shadingFill].filter(v => v !== undefined));
  const inside = b => b.x0 >= rect.x - 2 && b.x1 <= rect.x + rect.w + 2 && b.y0 >= rect.y - 2 && b.y1 <= rect.y + rect.h + 2;
  const cands = boxes.filter(b => PAINT.has(b.fn) && inside(b) && !(b.x1 - b.x0 > rect.w * 0.9 && b.y1 - b.y0 > rect.h * 0.9)); // not the field's own background
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
  return drawRegion(page, rect, scale, k => !skip.has(k));
}
