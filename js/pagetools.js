// "More tools" panel: watermark, page numbers, crop, reduce size, document properties.
import { h, icon, button, toast, field, select, withProgress, fmtSize } from './ui.js';
import { PDFLib, rgbHex, openPdfJs, destroyPdf, parseRanges } from './pdfio.js';
import { rasterizeToPdf } from './doc.js';

const { PDFDocument, StandardFonts, degrees } = PDFLib;

export function mountPanel(dv, el) {
  const doc = dv.doc;
  const guard = fn => async () => { if (!dv.editable) return dv.needUnlock(); await fn(); };
  const run = (title, fn) => withProgress(title, async () => { await doc.applyBytesOp(fn); });

  /* watermark */
  const wmText = h('input.input', { type: 'text', value: 'CONFIDENTIAL', maxlength: 60 });
  const wmSize = h('input.input', { type: 'number', value: 64, min: 8, max: 300 }); const wmOpacity = h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.2 });
  const wmColor = h('input', { type: 'color', value: '#d31510' }); const wmRot = select([[45, 'Diagonal (45°)'], [0, 'Horizontal'], [90, 'Vertical']], 45);
  const wmPages = h('input.input', { type: 'text', placeholder: 'All pages' });
  const watermark = h('details.acc', h('summary', icon('drop', 18), 'Watermark'), h('div',
    field('Text', wmText), h('div.cr-row', field('Size', wmSize), field('Angle', wmRot)), h('div.cr-row', field('Colour', wmColor), field('Opacity', wmOpacity)), field('Pages', wmPages, 'Leave empty for all pages, or e.g. 1-3, 5'),
    button({ label: 'Add watermark', kind: 'primary', onClick: guard(async () => {
      const text = wmText.value.trim(); if (!text) return toast('Enter the watermark text.', 'error');
      if (/[^\x20-\x7e¡-ÿ]/.test(text)) return toast('Watermark text supports Latin letters and numbers only.', 'error');
      await run('Adding watermark', async bytes => {
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false }); const font = await pdf.embedFont(StandardFonts.HelveticaBold);
        const idx = new Set(parseRanges(wmPages.value, pdf.getPageCount())); const size = +wmSize.value || 64, ang = +wmRot.value;
        pdf.getPages().forEach((pg, i) => {
          if (!idx.has(i)) return; const { width: W, height: H } = pg.getSize(); const w = font.widthOfTextAtSize(text, size);
          const rad = ang * Math.PI / 180; const cx = W / 2 - (w / 2) * Math.cos(rad) + (size * 0.35) * Math.sin(rad), cy = H / 2 - (w / 2) * Math.sin(rad) - (size * 0.35) * Math.cos(rad);
          pg.drawText(text, { x: cx, y: cy, size, font, color: rgbHex(wmColor.value), opacity: +wmOpacity.value, rotate: degrees(ang) });
        });
        return pdf.save({ useObjectStreams: true });
      }); toast('Watermark added.', 'success');
    }) })));

  /* page numbers */
  const pnFmt = select([['Page {n} of {total}', 'Page 1 of 10'], ['{n} / {total}', '1 / 10'], ['{n}', '1'], ['- {n} -', '- 1 -']], 'Page {n} of {total}');
  const pnPos = select([['bc', 'Bottom centre'], ['br', 'Bottom right'], ['bl', 'Bottom left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['tl', 'Top left']], 'bc');
  const pnSize = h('input.input', { type: 'number', value: 10, min: 6, max: 36 }); const pnStart = h('input.input', { type: 'number', value: 1, min: 0 });
  const numbers = h('details.acc', h('summary', icon('hash', 18), 'Page numbers'), h('div',
    field('Format', pnFmt), field('Position', pnPos), h('div.cr-row', field('Font size', pnSize), field('Start at', pnStart)),
    button({ label: 'Add page numbers', kind: 'primary', onClick: guard(async () => {
      await run('Adding page numbers', async bytes => {
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false }); const font = await pdf.embedFont(StandardFonts.Helvetica); const size = +pnSize.value || 10; const total = pdf.getPageCount();
        pdf.getPages().forEach((pg, i) => {
          const start = Number.isFinite(parseInt(pnStart.value, 10)) ? parseInt(pnStart.value, 10) : 1;
          const t = pnFmt.value.replace('{n}', String(i + start)).replace('{total}', String(total));
          const { width: W, height: H } = pg.getSize(); const w = font.widthOfTextAtSize(t, size); const m = 28;
          const x = pnPos.value.endsWith('c') ? (W - w) / 2 : pnPos.value.endsWith('r') ? W - w - m : m; const y = pnPos.value.startsWith('b') ? m - size / 2 : H - m;
          pg.drawText(t, { x, y, size, font, color: rgbHex('#333333') });
        });
        return pdf.save({ useObjectStreams: true });
      }); toast('Page numbers added.', 'success');
    }) })));

  /* crop */
  const cropVals = ['Top', 'Right', 'Bottom', 'Left'].map(l => h('input.input', { type: 'number', min: 0, value: 0, 'aria-label': `${l} margin` }));
  const crop = h('details.acc', h('summary', icon('crop', 18), 'Crop pages'), h('div',
    h('p.hint', 'Trim this many points (1 pt = 1/72 inch) from each edge of every page.'), h('div.cr-row', field('Top', cropVals[0]), field('Bottom', cropVals[2])), h('div.cr-row', field('Left', cropVals[3]), field('Right', cropVals[1])),
    button({ label: 'Crop all pages', kind: 'primary', onClick: guard(async () => {
      const [t, r, b, l] = cropVals.map(i => Math.max(0, +i.value || 0)); if (!(t + r + b + l)) return toast('Enter at least one margin.', 'error');
      await run('Cropping', async bytes => {
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
        pdf.getPages().forEach(pg => { const box = pg.getCropBox(); const rot = ((pg.getRotation().angle % 360) + 360) % 360; let [mt, mr, mb, ml] = [t, r, b, l];
          if (rot === 90) [mt, mr, mb, ml] = [l, t, r, b]; else if (rot === 180) [mt, mr, mb, ml] = [b, l, t, r]; else if (rot === 270) [mt, mr, mb, ml] = [r, b, l, t];
          const w = box.width - ml - mr, hh = box.height - mt - mb; if (w < 20 || hh < 20) return; pg.setCropBox(box.x + ml, box.y + mb, w, hh); });
        return pdf.save({ useObjectStreams: true });
      }); toast('Pages cropped.', 'success');
    }) })));

  /* reduce size */
  const dpi = select([[72, 'Smallest — 72 dpi'], [110, 'Small — 110 dpi'], [150, 'Balanced — 150 dpi'], [200, 'Sharp — 200 dpi']], 110); const q = select([[0.5, 'Low quality'], [0.7, 'Medium quality'], [0.85, 'High quality']], 0.7);
  const shrink = h('details.acc', h('summary', icon('compress', 18), 'Reduce file size'), h('div',
    h('p.hint', `Current size: ${fmtSize(doc.bytes.length)}. Pages are re-drawn as compressed pictures; text stays selectable through a hidden layer. Best for scans and photos.`), field('Resolution', dpi), field('Quality', q),
    button({ label: 'Reduce file size', kind: 'primary', onClick: guard(async () => {
      const before = doc.bytes.length; let after = 0;
      const res = await withProgress('Reducing size', async p => {
        const baked = await doc.bake(); const { pdf } = await openPdfJs(baked, { askPassword: false });
        const out = await rasterizeToPdf(pdf, { scale: +dpi.value / 72, quality: +q.value, withText: true, onProgress: (f, t) => p.update(f, t) }); destroyPdf(pdf); after = out.length; return out;
      });
      if (!res) return;
      if (after >= before) return toast(`That would not make it smaller (${fmtSize(before)} → ${fmtSize(after)}). The file was left as it is.`, 'info', 7000);
      await doc.replaceBytes(res); toast(`Reduced from ${fmtSize(before)} to ${fmtSize(after)}.`, 'success', 6000);
    }) })));

  /* properties */
  const meta = {}; ['Title', 'Author', 'Subject', 'Keywords'].forEach(k => meta[k] = h('input.input', { type: 'text' }));
  PDFDocument.load(doc.bytes, { updateMetadata: false }).then(p => { meta.Title.value = p.getTitle() || ''; meta.Author.value = p.getAuthor() || ''; meta.Subject.value = p.getSubject() || ''; meta.Keywords.value = p.getKeywords() || ''; }).catch(() => {});
  const props = h('details.acc', h('summary', icon('info', 18), 'Document properties'), h('div',
    ...Object.entries(meta).map(([k, v]) => field(k, v)),
    h('div.cr-row',
      button({ label: 'Save properties', kind: 'primary', onClick: guard(async () => { await run('Saving', async bytes => { const p = await PDFDocument.load(bytes, { updateMetadata: false }); p.setTitle(meta.Title.value); p.setAuthor(meta.Author.value); p.setSubject(meta.Subject.value); p.setKeywords(meta.Keywords.value.split(/[,;]/).map(s => s.trim()).filter(Boolean)); p.setProducer("Chumi's PDF Editor"); return p.save({ useObjectStreams: true }); }); toast('Properties saved.', 'success'); }) }),
      button({ label: 'Remove all', onClick: guard(async () => { await run('Removing metadata', async bytes => { const p = await PDFDocument.load(bytes, { updateMetadata: false }); p.setTitle(''); p.setAuthor(''); p.setSubject(''); p.setKeywords([]); p.setCreator(''); p.setProducer(''); return p.save({ useObjectStreams: true }); }); Object.values(meta).forEach(i => (i.value = '')); toast('Metadata removed.', 'success'); }) }))));

  const note = h('div.note-box', icon('info', 16), h('span', 'Password protection and certificate-based digital signing are not available in the browser version. Use your desktop PDF software for those.'));
  el.append(dv.panelHeader('More tools', 'Stamp, number, crop and shrink your PDF.'), h('div.panel-b', watermark, numbers, crop, shrink, props, note));
  return {};
}
