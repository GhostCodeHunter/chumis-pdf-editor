// Thin wrappers around pdf.js (rendering/text) and pdf-lib (writing).
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { promptDialog, toast } from './ui.js';

const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';
export { pdfjsLib };
export const PDFLib = window.PDFLib;

/** Open bytes with pdf.js. Prompts for a password if needed. Returns { pdf, password }. */
export async function openPdfJs(bytes, { password, askPassword = true, name = 'this file' } = {}) {
  let pw = password;
  for (let attempt = 0; attempt < 5; attempt++) {
    const task = pdfjsLib.getDocument({
      data: bytes.slice(), password: pw, wasmUrl: BASE + 'wasm/', standardFontDataUrl: BASE + 'standard_fonts/',
      isEvalSupported: false, enableXfa: false,
    });
    try {
      const pdf = await task.promise;
      return { pdf, password: pw };
    } catch (e) {
      if (e && e.name === 'PasswordException' && askPassword) {
        const msg = e.code === 2 ? 'Incorrect password. Try again.' : `“${name}” is password protected.`;
        const v = await promptDialog({ title: 'Password required', label: msg, type: 'password', confirmLabel: 'Open file' });
        if (v == null) throw new Error('Password entry cancelled');
        pw = v; continue;
      }
      throw e;
    }
  }
  throw new Error('Too many wrong passwords');
}

export async function renderToCanvas(pdf, pageIndex, scale, { bg = '#fff', canvas } = {}) {
  const page = await pdf.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale });
  const c = canvas || document.createElement('canvas');
  c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
  const ctx = c.getContext('2d', { willReadFrequently: false });
  ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
  page.cleanup();
  return c;
}

/** Releases a pdf.js document (v6 removed PDFDocumentProxy.destroy). */
export function destroyPdf(pdf) { try { if (pdf?.loadingTask?.destroy) pdf.loadingTask.destroy(); else if (pdf?.destroy) pdf.destroy(); } catch {} }

export const canvasToBlob = (c, type = 'image/png', q = 0.92) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Canvas export failed')), type, q));
export const canvasToBytes = async (c, type, q) => new Uint8Array(await (await canvasToBlob(c, type, q)).arrayBuffer());

const textCache = new WeakMap();

/** Text items of a page in display coordinates (points, origin top-left), plus merged line segments. */
export async function getPageText(pdf, i) {
  let perDoc = textCache.get(pdf); if (!perDoc) textCache.set(pdf, perDoc = new Map());
  if (perDoc.has(i)) return perDoc.get(i);
  const page = await pdf.getPage(i + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.length) continue;
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    const fs = Math.hypot(tx[2], tx[3]);
    const angle = Math.atan2(tx[1], tx[0]);
    const w = it.width * vp.scale;
    if (!(fs > 0.5)) continue;
    const st = tc.styles[it.fontName] || {};
    items.push({ str: it.str, x: tx[4], baseline: tx[5], w, fs, angle, fontName: it.fontName, family: st.fontFamily || 'sans-serif', hasEOL: it.hasEOL });
  }
  const segments = buildSegments(items);
  for (const sg of segments) { // a run never reaches over the next piece of text on its line (e.g. the next table column)
    const own = new Set(sg.items); let lim = sg.w;
    for (const it of items) { if (own.has(it) || !it.str.trim() || Math.abs(it.baseline - sg.baseline) > sg.fs * 0.45) continue; const dx = it.x - sg.x; if (dx > 1 && dx < lim) lim = dx - 1; }
    sg.w = Math.max(Math.min(sg.w, lim), Math.min(sg.w, sg.fs * 0.5));
  }
  const res = { items, segments, width: vp.width, height: vp.height, text: items.map(x => x.str).join(' ') };
  perDoc.set(i, res);
  return res;
}
export function clearTextCache(pdf) { textCache.delete(pdf); opCache.delete(pdf); }

/* --- the page drawn WITHOUT a given piece of text (keeps watermarks, table rules, tints and images exactly as they are) --- */
const opCache = new WeakMap();
/** Bounding box (display points, origin top-left) and operator code of every drawing operation on a page. pdf.js records the boxes coarsely (about 1/256 of the page). */
export async function opBoxes(pdf, i) {
  let per = opCache.get(pdf); if (!per) opCache.set(pdf, per = new Map());
  if (per.has(i)) return per.get(i);
  const job = (async () => {
    const page = await pdf.getPage(i + 1); const vp = page.getViewport({ scale: 1 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: vp, recordOperations: true }).promise;
    const rb = page.recordedBBoxes; if (!rb || !rb.length) return { fn: [], boxes: [] };
    const ol = await page.getOperatorList(), boxes = [];
    for (let k = 0; k < ol.fnArray.length; k++) {
      const x0 = rb.minX(k) * c.width, x1 = rb.maxX(k) * c.width, y0 = rb.minY(k) * c.height, y1 = rb.maxY(k) * c.height;
      if (x1 > x0 && y1 > y0) boxes.push({ i: k, fn: ol.fnArray[k], x0, x1, y0, y1 });
    }
    return { fn: ol.fnArray, boxes };
  })().catch(() => ({ fn: [], boxes: [] }));
  per.set(i, job); return job;
}
export async function textOpBoxes(pdf, i) {
  const O = pdfjsLib.OPS;
  return (await opBoxes(pdf, i)).boxes.filter(b => b.fn === O.showText || b.fn === O.showSpacedText || b.fn === O.nextLineShowText || b.fn === O.nextLineSetSpacingShowText);
}
/** The text operations that draw exactly this run of text (and nothing beside it), with their boxes. */
export async function segmentOps(pdf, i, seg) {
  const ops = await textOpBoxes(pdf, i), w = seg.w;
  return ops.filter(o => { const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2; return cx >= seg.x - 1 && cx <= seg.x + w + 1 && cy >= seg.top && cy <= seg.top + seg.h && o.x0 >= seg.x - 5 && o.x1 <= seg.x + w + 5; });
}
/** Renders a rectangle of the page (points) at the given scale with some operations left out. */
export async function renderPatch(pdf, i, rect, skip, scale = 4) {
  const page = await pdf.getPage(i + 1);
  const vp = page.getViewport({ scale, offsetX: -rect.x * scale, offsetY: -rect.y * scale });
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.ceil(rect.w * scale)); c.height = Math.max(2, Math.ceil(rect.h * scale));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport: vp, operationsFilter: k => !skip.has(k) }).promise;
  return c;
}

function buildSegments(items) {
  const segs = [];
  let cur = null;
  const flush = () => { if (cur) { finishSeg(cur); segs.push(cur); cur = null; } };
  for (const it of items) {
    if (Math.abs(it.angle) > 0.05) { flush(); continue; } // only horizontal text is editable
    if (!it.str.trim()) {
      // pdf.js inserts blank items that span the empty space between pieces of text on a line (e.g. between table columns).
      // A narrow one is an ordinary word space; a wide one is a column gap and must end the current run, not extend it.
      if (!cur) continue;
      if (it.w > cur.fs * 0.7) { flush(); continue; }
    }
    if (cur) {
      const sameLine = Math.abs(it.baseline - cur.baseline) < Math.max(1.5, cur.fs * 0.3) && Math.abs(it.fs - cur.fs) < cur.fs * 0.35;
      const gap = it.x - cur.right;
      if (sameLine && gap > -cur.fs * 0.6 && gap < cur.fs * 1.1) {
        const needSpace = gap > cur.fs * 0.12 && !/\s$/.test(cur.text) && !/^\s/.test(it.str);
        cur.text += (needSpace ? ' ' : '') + it.str; cur.right = Math.max(cur.right, it.x + it.w); cur.items.push(it); cur.pre.push(needSpace ? ' ' : '');
        continue;
      }
      flush();
    }
    cur = { text: it.str, x: it.x, baseline: it.baseline, fs: it.fs, right: it.x + it.w, items: [it], pre: [''], fontName: it.fontName, family: it.family };
  }
  flush();
  return segs.filter(s => s.text.trim());
}
function finishSeg(s) {
  s.w = s.right - s.x; s.text = s.text.replace(/\s+$/, '');
  s.top = s.baseline - s.fs * 0.95; s.h = s.fs * 1.22;
}
/** A run rebuilt from a subset of items (used when a run is split, e.g. at a table border). */
export function makeSeg(items, pre) {
  const first = items.find(i => i.str.trim()) || items[0], last = items[items.length - 1];
  const from = items.indexOf(first);
  const seg = { text: items.slice(from).map((it, k) => (k ? pre[from + k] || '' : '') + it.str).join(''), x: first.x, baseline: first.baseline, fs: first.fs, right: last.x + last.w, items: items.slice(from), pre: ['', ...pre.slice(from + 1)], fontName: first.fontName, family: first.family };
  finishSeg(seg); return seg;
}

export async function getFontInfo(pdf, i, fontName) {
  try {
    const page = await pdf.getPage(i + 1);
    if (!page.commonObjs.has(fontName)) { await page.getOperatorList(); }
    const f = page.commonObjs.has(fontName) ? page.commonObjs.get(fontName) : null;
    if (!f) return {};
    const name = String(f.name || f.loadedName || '');
    return { name, bold: !!f.bold || /bold|black|heavy|demi/i.test(name), italic: !!f.italic || /italic|oblique/i.test(name), serif: f.isSerifFont, mono: f.isMonospace };
  } catch { return {}; }
}

export function triggerErrorToast(e, what) { console.error(e); toast(`${what}: ${e.message || e}`, 'error', 8000); }

/* ---------- pdf-lib helpers ---------- */
export async function loadPdfLib(bytes, opts = {}) {
  return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, ...opts });
}

export function parseRanges(str, max) {
  // "1-3,5,8-" → zero-based page indexes; empty = all
  const s = (str || '').trim();
  if (!s) return Array.from({ length: max }, (_, i) => i);
  const out = [];
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : max;
      const step = a <= b ? 1 : -1;
      for (let p = a; step > 0 ? p <= b : p >= b; p += step) if (p >= 1 && p <= max) out.push(p - 1);
    } else if (/^\d+$/.test(part)) { const p = +part; if (p >= 1 && p <= max) out.push(p - 1); }
    else throw new Error(`Cannot read page range “${part}”`);
  }
  if (!out.length) throw new Error('No pages match that range');
  return out;
}

export const PAGE_SIZES = { A4: [595.28, 841.89], A3: [841.89, 1190.55], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224] };

export function rgbHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return PDFLib.rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
