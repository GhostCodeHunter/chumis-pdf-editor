// Writes the editor's annotations, OCR text and page-level edits into real PDF bytes (via pdf-lib).
import { PDFLib, rgbHex, openPdfJs, canvasToBytes, destroyPdf, getPageText } from './pdfio.js';
import { CSS_BUILTIN, isCustom, cssFamilyFor, probeBase, embeddedFontFor, readyForCanvas } from './fonts.js';

const {
  PDFDocument, StandardFonts, rgb, BlendMode, pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  setTextRenderingMode, TextRenderingMode, LineCapStyle, PDFHexString,
} = PDFLib;

export const LINE_HEIGHT = 1.2;
// Where the first baseline sits inside a line box of height 1.2×size, per built-in font family.
export const BASELINE = { helv: 0.9465, times: 0.9375, cour: 0.8665 };
export const CSS_FONT = CSS_BUILTIN;
const STD = {
  helv: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  cour: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};

/** Geometry of a pdf-lib page: displayed size and the matrix mapping display-up coordinates to user space. */
export function pageGeom(page) {
  const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const { x: x0, y: y0, width: w, height: h } = box;
  if (rot === 90) return { W: h, H: w, m: [0, 1, -1, 0, x0 + w, y0], rot };
  if (rot === 180) return { W: w, H: h, m: [-1, 0, 0, -1, x0 + w, y0 + h], rot };
  if (rot === 270) return { W: h, H: w, m: [0, -1, 1, 0, x0, y0 + h], rot };
  return { W: w, H: h, m: [1, 0, 0, 1, x0, y0], rot };
}

class FontBox {
  constructor(pdf) { this.pdf = pdf; this.cache = new Map(); }
  async get(family, bold, italic) {
    const names = STD[family] || STD.helv;
    const name = names[(bold ? 1 : 0) + (italic ? 2 : 0)];
    if (!this.cache.has(name)) this.cache.set(name, await this.pdf.embedFont(StandardFonts[name]));
    const font = this.cache.get(name);
    if (!font._cs) font._cs = new Set(font.getCharacterSet());
    return font;
  }
}

const cleanText = t => String(t ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[   ]/g, ' ').replace(/[​-‍﻿]/g, '');
const encodable = (font, text) => { for (const ch of text) { if (ch !== '\n' && !font._cs.has(ch.codePointAt(0))) return false; } return true; };

export function wrapLines(text, font, size, maxW) {
  const out = [];
  for (const para of cleanText(text).split('\n')) {
    if (maxW == null) { out.push(para); continue; }
    let line = '';
    for (const tok of para.split(/(\s+)/)) {
      if (!tok) continue;
      const cand = line + tok;
      if (font.widthOfTextAtSize(cand.trimEnd(), size) <= maxW) { line = cand; continue; }
      if (line.trim()) { out.push(line.trimEnd()); line = ''; }
      if (/^\s+$/.test(tok)) continue;
      if (font.widthOfTextAtSize(tok, size) <= maxW) { line = tok; continue; }
      let chunk = '';
      for (const ch of tok) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxW && chunk) { out.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Rasterise text (for scripts the built-in PDF fonts cannot encode, e.g. Devanagari, Malayalam, ₹). */
export function rasterText(a, maxW, baseRatio) {
  const S = 4, size = a.size || 14;
  const cvs = document.createElement('canvas'); const ctx = cvs.getContext('2d');
  const NOTO = '"Noto Sans", "Noto Sans Devanagari", "Noto Sans Malayalam", "Noto Sans Tamil", "Noto Sans Telugu", "Noto Sans Bengali", "Noto Sans Arabic"';
  const fam = isCustom(a.font) ? `${cssFamilyFor(a)}, ${NOTO}, sans-serif` : (CSS_FONT[a.font] || CSS_FONT.helv).replace(/sans-serif$/, NOTO + ', sans-serif');
  const f = `${a.italic ? 'italic ' : ''}${a.bold ? 'bold ' : ''}${size * S}px ${fam}`;
  ctx.font = f;
  const lines = [];
  for (const para of cleanText(a.text).split('\n')) {
    if (maxW == null) { lines.push(para); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (ctx.measureText((line + word).trimEnd()).width / S <= maxW || !line) line += word; else { lines.push(line.trimEnd()); line = word.trimStart(); }
    }
    lines.push(line.trimEnd());
  }
  const lh = size * LINE_HEIGHT;
  const width = Math.max(1, maxW ?? Math.max(...lines.map(l => ctx.measureText(l).width / S)));
  cvs.width = Math.ceil(width * S) + 2; cvs.height = Math.ceil(lines.length * lh * S) + 2;
  const c2 = cvs.getContext('2d'); c2.font = f; c2.fillStyle = a.color || '#000'; c2.textBaseline = 'alphabetic';
  lines.forEach((l, i) => {
    const w = c2.measureText(l).width / S;
    const dx = a.align === 'center' ? (width - w) / 2 : a.align === 'right' ? width - w : 0;
    c2.fillText(l, dx * S, (i * lh + (baseRatio ?? 0.95) * size) * S);
  });
  return { canvas: cvs, w: cvs.width / S, h: cvs.height / S };
}

export async function bakeDoc(doc, { onProgress } = {}) {
  const needs = doc.pages.some(p => p.annots.length || (p.ocr && p.ocr.searchable !== false)) || doc.formValues && Object.keys(doc.formValues).length;
  if (!needs) return doc.bytes;
  const pdf = await PDFDocument.load(doc.bytes, { updateMetadata: false });
  const fonts = new FontBox(pdf);
  const imgCache = new Map();
  const pages = pdf.getPages();
  const redactPages = [];

  if (doc.formValues && Object.keys(doc.formValues).length) applyFormValues(pdf, doc.formValues, doc.flattenForm);

  for (let i = 0; i < pages.length; i++) {
    const meta = doc.pages[i]; if (!meta) continue;
    const page = pages[i];
    const hasOcr = meta.ocr && meta.ocr.searchable !== false && meta.ocr.words?.length;
    if (!meta.annots.length && !hasOcr) continue;
    onProgress && onProgress(i / pages.length, `Applying edits to page ${i + 1}`);
    const g = pageGeom(page);
    const Y = y => g.H - y;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...g.m));
    if (hasOcr) await drawOcrText(page, fonts, meta.ocr, g);
    for (const a of meta.annots) {
      try { await drawAnnot(pdf, page, fonts, doc, a, g, Y, imgCache); }
      catch (e) { console.warn('Could not draw annotation', a.type, e); }
      if (a.type === 'redact' && !redactPages.includes(i)) redactPages.push(i);
    }
    page.pushOperators(popGraphicsState());
  }

  if (redactPages.length) await applyRedactions(pdf, doc, redactPages, onProgress);
  return pdf.save({ useObjectStreams: true });
}

async function embedAsset(pdf, doc, id, cache) {
  if (cache.has(id)) return cache.get(id);
  const asset = doc.assets.get(id); if (!asset) return null;
  const img = asset.mime === 'image/jpeg' ? await pdf.embedJpg(asset.bytes) : await pdf.embedPng(asset.bytes);
  cache.set(id, img); return img;
}

async function drawAnnot(pdf, page, fonts, doc, a, g, Y, imgCache) {
  const op = a.opacity ?? 1;
  switch (a.type) {
    case 'rect': {
      if (!a.fill && !a.stroke) break;
      page.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: a.fill ? rgbHex(a.fill) : undefined, borderColor: a.stroke ? rgbHex(a.stroke) : undefined, borderWidth: a.stroke ? a.sw : 0, opacity: a.fill ? op : undefined, borderOpacity: op });
      break;
    }
    case 'ellipse': {
      if (!a.fill && !a.stroke) break;
      page.drawEllipse({ x: a.x + a.w / 2, y: Y(a.y + a.h / 2), xScale: Math.abs(a.w / 2), yScale: Math.abs(a.h / 2), color: a.fill ? rgbHex(a.fill) : undefined, borderColor: a.stroke ? rgbHex(a.stroke) : undefined, borderWidth: a.stroke ? a.sw : 0, opacity: a.fill ? op : undefined, borderOpacity: op });
      break;
    }
    case 'line': case 'arrow': {
      const col = rgbHex(a.stroke);
      page.drawLine({ start: { x: a.x1, y: Y(a.y1) }, end: { x: a.x2, y: Y(a.y2) }, thickness: a.sw, color: col, opacity: op, lineCap: LineCapStyle.Round });
      if (a.type === 'arrow') {
        const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = Math.max(9, a.sw * 4.5);
        for (const s of [-1, 1]) {
          const ax = a.x2 - L * Math.cos(ang + s * 0.45), ay = a.y2 - L * Math.sin(ang + s * 0.45);
          page.drawLine({ start: { x: a.x2, y: Y(a.y2) }, end: { x: ax, y: Y(ay) }, thickness: a.sw, color: col, opacity: op, lineCap: LineCapStyle.Round });
        }
      }
      break;
    }
    case 'ink': {
      if (!a.points || a.points.length < 2) break;
      const d = 'M ' + a.points.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L ');
      page.drawSvgPath(d, { x: 0, y: g.H, borderColor: rgbHex(a.stroke), borderWidth: a.sw, borderOpacity: op, borderLineCap: LineCapStyle.Round, blendMode: a.hl ? BlendMode.Multiply : BlendMode.Normal });
      break;
    }
    case 'highlight': case 'underline': case 'strike': {
      for (const [x, y, w, h] of a.rects) {
        if (a.type === 'highlight') page.drawRectangle({ x, y: Y(y + h), width: w, height: h, color: rgbHex(a.color), opacity: op, blendMode: BlendMode.Multiply });
        else {
          const yy = a.type === 'underline' ? y + h * 0.9 : y + h * 0.55;
          page.drawLine({ start: { x, y: Y(yy) }, end: { x: x + w, y: Y(yy) }, thickness: Math.max(0.8, h * 0.07), color: rgbHex(a.color), opacity: op });
        }
      }
      break;
    }
    case 'whiteout': page.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: rgbHex(a.color || '#ffffff') }); break;
    case 'redact': page.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: rgb(0, 0, 0) }); break;
    case 'mark': {
      const col = rgbHex(a.color || '#000000'), s = Math.min(a.w, a.h), t = Math.max(1, s * 0.12);
      const P = (u, v) => ({ x: a.x + u * a.w, y: Y(a.y + v * a.h) });
      if (a.kind === 'check') { page.drawLine({ start: P(.12, .55), end: P(.38, .88), thickness: t, color: col, lineCap: LineCapStyle.Round }); page.drawLine({ start: P(.38, .88), end: P(.9, .12), thickness: t, color: col, lineCap: LineCapStyle.Round }); }
      else if (a.kind === 'cross') { page.drawLine({ start: P(.15, .15), end: P(.85, .85), thickness: t, color: col, lineCap: LineCapStyle.Round }); page.drawLine({ start: P(.85, .15), end: P(.15, .85), thickness: t, color: col, lineCap: LineCapStyle.Round }); }
      else page.drawEllipse({ x: a.x + a.w / 2, y: Y(a.y + a.h / 2), xScale: a.w * 0.3, yScale: a.h * 0.3, color: col });
      break;
    }
    case 'image': {
      const img = await embedAsset(pdf, doc, a.assetId, imgCache); if (!img) break;
      page.drawImage(img, { x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, opacity: op });
      break;
    }
    case 'text': case 'textedit': await drawTextAnnot(pdf, page, fonts, doc, a, Y, imgCache); break;
    case 'note': {
      const x = a.x, y = a.y, S = 18;
      const pts = [[x, Y(y + S)], [x + S, Y(y)]].map(([dx, dy]) => [g.m[0] * dx + g.m[2] * dy + g.m[4], g.m[1] * dx + g.m[3] * dy + g.m[5]]);
      const c = parseInt((a.color || '#ffd54a').slice(1), 16);
      const ctx = pdf.context;
      const dict = ctx.obj({
        Type: 'Annot', Subtype: 'Text', Name: 'Comment', F: 4, Open: false,
        Rect: [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])],
        C: [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255],
      });
      dict.set(PDFLib.PDFName.of('Contents'), PDFHexString.fromText(a.text || ''));
      dict.set(PDFLib.PDFName.of('T'), PDFHexString.fromText('Pagewise PDF'));
      page.node.addAnnot(ctx.register(dict));
      break;
    }
  }
}

async function drawTextAnnot(pdf, page, fonts, doc, a, Y, imgCache) {
  const text = cleanText(a.text);
  const size = a.size || 14;
  const isEdit = a.type === 'textedit';
  const custom = isCustom(a.font);
  // background / cover
  if (isEdit) page.drawRectangle({ x: a.x - 1, y: Y(a.y + a.h), width: a.coverW + 2, height: a.h, color: rgbHex(a.bg || '#ffffff') });
  else if (a.bg) page.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: rgbHex(a.bg) });
  if (!text.trim()) return;
  const maxW = isEdit ? null : a.w;
  const lh = size * LINE_HEIGHT;
  let font = null, baseRatio = BASELINE[a.font] ?? BASELINE.helv;
  if (custom) {
    baseRatio = (await probeBase(a)) ?? 0.95;
    const emb = await embeddedFontFor(pdf, a, text); font = emb ? emb.font : null;
  } else {
    font = await fonts.get(a.font || 'helv', a.bold, a.italic);
    if (!encodable(font, text)) font = null;
  }
  if (!font) { // scripts / glyphs the font cannot supply as live text → draw a picture of the text (exact look, not selectable)
    await readyForCanvas(a);
    const r = rasterText(a, maxW, baseRatio);
    const png = await pdf.embedPng(await canvasToBytes(r.canvas, 'image/png'));
    page.drawImage(png, { x: a.x, y: Y(a.y + r.h), width: r.w, height: r.h, opacity: a.opacity ?? 1 });
    return;
  }
  const lines = wrapLines(text, font, size, maxW);
  const base = baseRatio * size;
  const boxW = isEdit ? Math.max(a.coverW, ...lines.map(l => font.widthOfTextAtSize(l, size))) : a.w;
  lines.forEach((l, i) => {
    if (!l) return;
    const w = font.widthOfTextAtSize(l, size);
    const dx = a.align === 'center' ? (boxW - w) / 2 : a.align === 'right' ? boxW - w : 0;
    page.drawText(l, { x: a.x + dx, y: Y(a.y + i * lh + base), size, font, color: rgbHex(a.color || '#000000'), opacity: a.opacity ?? 1 });
  });
}

const fontBoxes = new WeakMap();
/** Adds an invisible (selectable/searchable) text layer. words: [{text,x,y,w,h}] in display points, top-left origin, page unrotated. */
export async function addInvisibleText(pdf, page, words) {
  let fb = fontBoxes.get(pdf); if (!fb) fontBoxes.set(pdf, fb = new FontBox(pdf));
  const g = pageGeom(page);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...g.m));
  await drawOcrText(page, fb, { words }, g);
  page.pushOperators(popGraphicsState());
}

async function drawOcrText(page, fonts, ocr, g) {
  const font = await fonts.get('helv', false, false);
  const Y = y => g.H - y;
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  for (const w of ocr.words) {
    let t = cleanText(w.text).split('').filter(ch => font._cs.has(ch.codePointAt(0))).join('');
    if (!t.trim()) continue;
    const size = Math.max(2, w.h * 0.85);
    const nat = font.widthOfTextAtSize(t, size);
    if (!nat) continue;
    const sx = w.w / nat;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, 1, w.x, Y(w.y + w.h * 0.85)));
    page.drawText(t, { x: 0, y: 0, size, font });
    page.pushOperators(popGraphicsState());
  }
  page.pushOperators(popGraphicsState());
}

async function applyRedactions(pdf, doc, redactPages, onProgress) {
  // True redaction: the page is rendered with the black boxes burned in, then replaced by that picture,
  // so the covered text/images no longer exist in the file.
  const tmp = await pdf.save();
  const { pdf: js } = await openPdfJs(tmp, { askPassword: false });
  const SCALE = 2.5;
  for (const i of redactPages) {
    onProgress && onProgress(0.9, `Redacting page ${i + 1}`);
    const page = await js.getPage(i + 1);
    const vp = page.getViewport({ scale: SCALE });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
    ctx.fillStyle = '#000';
    for (const a of doc.pages[i].annots) if (a.type === 'redact') ctx.fillRect(a.x * SCALE, a.y * SCALE, a.w * SCALE, a.h * SCALE);
    const jpg = await pdf.embedJpg(await canvasToBytes(c, 'image/jpeg', 0.9));
    const W = vp.width / SCALE, H = vp.height / SCALE;
    const np = pdf.insertPage(i, [W, H]);
    np.drawImage(jpg, { x: 0, y: 0, width: W, height: H });
    pdf.removePage(i + 1);
    // keep the rest of the page's text selectable/searchable; anything touching a redaction box is dropped
    const reds = doc.pages[i].annots.filter(a => a.type === 'redact');
    const t = await getPageText(js, i);
    const words = t.items.filter(it => Math.abs(it.angle) < 0.05 && !reds.some(r => it.x < r.x + r.w && it.x + it.w > r.x && it.baseline - it.fs < r.y + r.h && it.baseline > r.y))
      .map(it => ({ text: it.str, x: it.x, y: it.baseline - it.fs, w: it.w, h: it.fs / 0.85 }));
    if (words.length) await addInvisibleText(pdf, np, words);
  }
  destroyPdf(js);
}

function applyFormValues(pdf, values, flatten) {
  const form = pdf.getForm();
  for (const [name, v] of Object.entries(values)) {
    try {
      const f = form.getField(name);
      if (f instanceof PDFLib.PDFTextField) f.setText(String(v));
      else if (f instanceof PDFLib.PDFCheckBox) v ? f.check() : f.uncheck();
      else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) f.select(String(v));
      else if (f instanceof PDFLib.PDFRadioGroup) f.select(String(v));
    } catch (e) { console.warn('form field', name, e); }
  }
  if (flatten) form.flatten();
}

/** Reads AcroForm fields for the form panel. */
export async function readFormFields(bytes) {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const form = pdf.getForm();
    const L = PDFLib;
    return form.getFields().map(f => {
      const o = { name: f.getName() };
      if (f instanceof L.PDFTextField) { o.type = 'TextField'; o.value = f.getText() ?? ''; }
      else if (f instanceof L.PDFCheckBox) { o.type = 'CheckBox'; o.value = f.isChecked(); }
      else if (f instanceof L.PDFDropdown || f instanceof L.PDFOptionList) { o.type = 'Dropdown'; o.options = f.getOptions(); o.value = f.getSelected()[0] ?? ''; }
      else if (f instanceof L.PDFRadioGroup) { o.type = 'RadioGroup'; o.options = f.getOptions(); o.value = f.getSelected() ?? ''; }
      else return null;
      return o;
    }).filter(Boolean);
  } catch { return []; }
}
