// A small flow-layout engine: turns headings, paragraphs, lists, tables and images into paginated PDF pages.
import { PDFLib, rgbHex, canvasToBytes } from './pdfio.js';
import { rasterText } from './bake.js';

const { PDFDocument, StandardFonts } = PDFLib;
const SIZES = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11 };

const clean = t => String(t ?? '').replace(/\r/g, '').replace(/\t/g, '    ').replace(/[   ]/g, ' ').replace(/[​-‍﻿]/g, '');

export async function renderBlocksToPdf(blocks, { pageSize = [595.28, 841.89], margin = 54, baseSize = 11, mono = false } = {}) {
  const pdf = await PDFDocument.create();
  const F = mono
    ? { r: await pdf.embedFont(StandardFonts.Courier), b: await pdf.embedFont(StandardFonts.CourierBold), i: await pdf.embedFont(StandardFonts.CourierOblique), bi: await pdf.embedFont(StandardFonts.CourierBoldOblique) }
    : { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold), i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique) };
  const [PW, PH] = pageSize; const CW = PW - margin * 2;
  for (const f of Object.values(F)) f._cs = new Set(f.getCharacterSet());
  let page = null, y = 0;
  const newPage = () => { page = pdf.addPage([PW, PH]); y = PH - margin; };
  const need = hh => { if (!page || y - hh < margin) newPage(); };
  const fontFor = r => (r.bold && r.italic ? F.bi : r.bold ? F.b : r.italic ? F.i : F.r);
  const ok = (font, s) => { for (const ch of s) if (ch !== '\n' && !font._cs.has(ch.codePointAt(0))) return false; return true; };

  async function rasterPara(runs, size, indent, width) {
    const text = runs.map(r => r.text).join('');
    const a = { text, size, font: 'helv', bold: runs[0]?.bold, italic: runs[0]?.italic, color: runs[0]?.color || '#000000', align: 'left' };
    const r = rasterText(a, width);
    let h = r.h, w = r.w;
    if (h > PH - margin * 2) { const k = (PH - margin * 2) / h; h *= k; w *= k; }
    need(h); const png = await pdf.embedPng(await canvasToBytes(r.canvas, 'image/png'));
    page.drawImage(png, { x: margin + indent, y: y - h, width: w, height: h }); y -= h;
  }

  async function paragraph(runs, { size = baseSize, indent = 0, bullet = null, align = 'left', gap = size * 0.55, width = CW - indent } = {}) {
    runs = runs.filter(r => r.text !== '' && r.text != null).map(r => ({ ...r, text: clean(r.text) }));
    if (!runs.length) { y -= size * 0.8; return; }
    const allText = runs.map(r => r.text).join('');
    if (!runs.every(r => ok(fontFor(r), r.text))) { if (bullet) { need(size * 1.3); page.drawText(bullet, { x: margin + indent - 14, y: y - size, size, font: F.r }); } await rasterPara(runs, size, indent, width); y -= gap; return; }
    // tokenise
    const words = [];
    for (const r of runs) {
      const font = fontFor(r), sz = r.size || size;
      for (const part of r.text.split(/(\n|\s+)/)) { if (part === '') continue; if (part === '\n') words.push({ nl: true }); else words.push({ text: part, font, size: sz, color: r.color, space: /^\s+$/.test(part) }); }
    }
    const lines = []; let line = [], lw = 0;
    const push = () => { while (line.length && line[line.length - 1].space) line.pop(); lines.push(line); line = []; lw = 0; };
    for (const w of words) {
      if (w.nl) { push(); continue; }
      const wd = w.font.widthOfTextAtSize(w.text, w.size);
      if (!w.space && lw + wd > width && line.length) push();
      if (w.space && !line.length) continue;
      if (!w.space && wd > width) { // very long word: split
        let chunk = ''; for (const ch of w.text) { if (w.font.widthOfTextAtSize(chunk + ch, w.size) > width - lw && chunk) { line.push({ ...w, text: chunk, wd: w.font.widthOfTextAtSize(chunk, w.size) }); push(); chunk = ch; } else chunk += ch; }
        line.push({ ...w, text: chunk, wd: w.font.widthOfTextAtSize(chunk, w.size) }); lw += w.font.widthOfTextAtSize(chunk, w.size); continue;
      }
      line.push({ ...w, wd }); lw += wd;
    }
    push();
    const lh = Math.max(size, ...runs.map(r => r.size || 0)) * 1.28;
    for (let k = 0; k < lines.length; k++) {
      need(lh); const L = lines[k]; const tw = L.reduce((s, w) => s + (w.wd ?? w.font.widthOfTextAtSize(w.text, w.size)), 0);
      let x = margin + indent + (align === 'center' ? (width - tw) / 2 : align === 'right' ? width - tw : 0);
      if (bullet && k === 0) page.drawText(bullet, { x: margin + indent - 14, y: y - size, size, font: F.r });
      for (const w of L) { if (!w.space) page.drawText(w.text, { x, y: y - size, size: w.size, font: w.font, color: w.color ? rgbHex(w.color) : undefined }); x += w.wd ?? w.font.widthOfTextAtSize(w.text, w.size); }
      y -= lh;
    }
    y -= gap;
  }

  async function table(rows) {
    if (!rows.length) return;
    const cols = Math.max(...rows.map(r => r.length)); const size = Math.max(7, Math.min(10, baseSize - (cols > 6 ? 2 : 0)));
    const wts = Array(cols).fill(1); rows.forEach(r => r.forEach((c, i) => { wts[i] = Math.max(wts[i], Math.min(40, String(c ?? '').length + 2)); }));
    const total = wts.reduce((a, b) => a + b, 0); const widths = wts.map(w => Math.max(28, (w / total) * CW)); const scale = CW / widths.reduce((a, b) => a + b, 0); const W = widths.map(w => w * scale);
    const pad = 4;
    for (let ri = 0; ri < rows.length; ri++) {
      const cells = rows[ri]; const header = ri === 0;
      const font = header ? F.b : F.r; const wrapped = [];
      let rowH = size * 1.3 + pad * 2;
      for (let c = 0; c < cols; c++) {
        const txt = clean(cells[c] ?? '');
        const safe = ok(font, txt) ? txt : txt.replace(/[^\x20-\x7e¡-ÿ]/g, '?');
        const ls = []; for (const para of safe.split('\n')) { let cur = ''; for (const wd of para.split(' ')) { const t = cur ? cur + ' ' + wd : wd; if (font.widthOfTextAtSize(t, size) <= W[c] - pad * 2 || !cur) cur = t; else { ls.push(cur); cur = wd; } } ls.push(cur); }
        wrapped.push(ls); rowH = Math.max(rowH, ls.length * size * 1.25 + pad * 2);
      }
      need(rowH); let x = margin;
      for (let c = 0; c < cols; c++) {
        page.drawRectangle({ x, y: y - rowH, width: W[c], height: rowH, borderColor: rgbHex('#999999'), borderWidth: 0.5, color: header ? rgbHex('#eeeeee') : undefined });
        wrapped[c].forEach((l, k) => { if (l) page.drawText(l, { x: x + pad, y: y - pad - size * (k + 1) * 1.15 + size * 0.15, size, font }); });
        x += W[c];
      }
      y -= rowH;
    }
    y -= baseSize;
  }

  async function image(b) {
    const img = b.mime === 'image/jpeg' ? await pdf.embedJpg(b.bytes) : await pdf.embedPng(b.bytes);
    let w = b.w || img.width, hh = b.h || img.height; const maxW = CW, maxH = PH - margin * 2;
    const k = Math.min(1, maxW / w, maxH / hh); w *= k; hh *= k;
    need(hh); page.drawImage(img, { x: margin, y: y - hh, width: w, height: hh }); y -= hh + baseSize;
  }

  newPage();
  for (const b of blocks) {
    if (b.type === 'h') { const size = SIZES[b.level] || 12; y -= size * 0.4; need(size * 2.2); await paragraph(b.runs.map(r => ({ ...r, bold: true })), { size, gap: size * 0.4 }); }
    else if (b.type === 'p') await paragraph(b.runs, { align: b.align, size: b.size || baseSize });
    else if (b.type === 'li') await paragraph(b.runs, { indent: 18 + (b.depth || 0) * 18, bullet: b.ordered ? `${b.n}.` : '•', gap: baseSize * 0.25 });
    else if (b.type === 'table') await table(b.rows);
    else if (b.type === 'img') await image(b);
    else if (b.type === 'pagebreak') newPage();
    else if (b.type === 'hr') { need(10); page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: PW - margin, y: y - 4 }, thickness: 0.7, color: rgbHex('#999999') }); y -= 14; }
  }
  return pdf.save({ useObjectStreams: true });
}

/** **bold** and *italic* inline markdown → runs. */
export function inlineMd(text) {
  const runs = []; const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g; let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    const t = m[0]; const bold = t.startsWith('**') || t.startsWith('__');
    runs.push({ text: t.slice(bold ? 2 : 1, bold ? -2 : -1), bold, italic: !bold }); last = m.index + t.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

export function markdownToBlocks(src, md = true) {
  const blocks = []; let para = [];
  const flush = () => { if (para.length) { const t = para.join(md ? ' ' : '\n'); blocks.push({ type: 'p', runs: md ? inlineMd(t) : [{ text: t }] }); para = []; } };
  for (const line of src.replace(/\r/g, '').split('\n')) {
    if (!md) { para.push(line); continue; }
    let m;
    if (!line.trim()) { flush(); }
    else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); blocks.push({ type: 'h', level: m[1].length, runs: inlineMd(m[2]) }); }
    else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) { flush(); blocks.push({ type: 'li', runs: inlineMd(m[1]) }); }
    else if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) { flush(); blocks.push({ type: 'li', ordered: true, n: m[1], runs: inlineMd(m[2]) }); }
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); blocks.push({ type: 'hr' }); }
    else para.push(line.trim());
  }
  flush();
  if (!md) { // plain text: keep each paragraph as typed, split on blank lines
    const all = blocks.length ? blocks[0].runs[0].text : '';
    return all.split(/\n{2,}/).map(t => ({ type: 'p', runs: [{ text: t }] }));
  }
  return blocks;
}
