// Export panel: PDF → images, text, Word, Excel, PowerPoint, HTML, Markdown.
import { h, icon, button, toast, field, select, withProgress, downloadBlob, baseName, progressDialog } from './ui.js';
import { openPdfJs, destroyPdf, renderToCanvas, canvasToBlob, parseRanges, canvasToBytes } from './pdfio.js';
import { pageSegments, buildBlocks, toTxt, toMd, toHtml, toDocx, toXlsx } from './extract.js';

const FORMATS = [
  ['docx', 'word', 'Word', '.docx · editable text'],
  ['xlsx', 'excel', 'Excel', '.xlsx · tables from aligned text'],
  ['pptx', 'ppt', 'PowerPoint', '.pptx · one slide per page'],
  ['png', 'image-file', 'Images', 'PNG · JPG · WebP'],
  ['txt', 'txt', 'Text', '.txt · plain text'],
  ['html', 'html', 'HTML', '.html · web page'],
  ['md', 'markdown', 'Markdown', '.md · headings & lists'],
  ['pdf', 'pdf', 'PDF', 'Save a copy with your edits'],
];

let pptxLoading = null;
function loadPptx() {
  if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
  if (!pptxLoading) pptxLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('../vendor/pptxgen.bundle.js', import.meta.url).href; s.onload = () => res(window.PptxGenJS); s.onerror = () => rej(new Error('Could not load the PowerPoint writer')); document.head.append(s); });
  return pptxLoading;
}

export function mountPanel(dv, el) {
  const doc = dv.doc; let fmt = 'docx';
  const grid = h('div.fmt-grid'); const opts = h('div.panel-sec');
  const scope = h('input.input', { type: 'text', placeholder: 'All pages — or e.g. 1-3, 5' });
  const drawGrid = () => grid.replaceChildren(...FORMATS.map(([id, ic, name, sub]) => h('button.fmt', { type: 'button', 'aria-pressed': String(id === fmt), onclick: () => { fmt = id; drawGrid(); drawOpts(); } }, icon(ic, 22), h('strong', name), h('span', sub))));
  let o = {};
  function drawOpts() {
    opts.replaceChildren(); o = {};
    if (fmt === 'docx') { o.mode = select([['text', 'Editable text (recommended)'], ['image', 'Exact look — pages as pictures']], 'text'); opts.append(field('Word layout', o.mode)); }
    if (fmt === 'png') { o.type = select([['image/png', 'PNG (sharp)'], ['image/jpeg', 'JPG (smaller)'], ['image/webp', 'WebP (smallest)']], 'image/png'); o.dpi = select([[72, '72 dpi — screen'], [150, '150 dpi — good'], [300, '300 dpi — print']], 150); opts.append(field('Format', o.type), field('Resolution', o.dpi)); }
    if (fmt === 'pptx') { o.dpi = select([[100, 'Standard'], [150, 'High']], 100); opts.append(field('Picture quality', o.dpi)); }
    if (['docx', 'xlsx', 'txt', 'html', 'md'].includes(fmt)) { o.ocr = h('input', { type: 'checkbox', checked: true }); opts.append(h('label.check', o.ocr, ' Use OCR on pages that are only pictures (needs internet the first time)')); }
  }
  drawGrid(); drawOpts();

  const go = button({ label: 'Export', icon: 'export', kind: 'primary', onClick: () => exportNow() });

  async function textPagesIdx() {
    let idx; try { idx = parseRanges(scope.value, doc.numPages); } catch (e) { toast(e.message, 'error'); return null; }
    return idx;
  }

  async function exportNow() {
    const idx = await textPagesIdx(); if (!idx) return;
    const base = baseName(doc.name); const p = progressDialog('Exporting');
    try {
      if (fmt === 'pdf') {
        p.update(null, 'Saving PDF…'); const bytes = await doc.bake(); downloadBlob(new Blob([bytes], { type: 'application/pdf' }), base + (doc.hasEdits() ? '-edited' : '') + '.pdf'); toast('PDF saved.', 'success'); return;
      }
      if (fmt === 'png' || fmt === 'pptx' || (fmt === 'docx' && o.mode.value === 'image')) {
        p.update(0, 'Preparing pages…'); const baked = await doc.bake(); const { pdf } = await openPdfJs(baked, { askPassword: false });
        const dpi = +(o.dpi?.value || 150); const imgs = [];
        for (let k = 0; k < idx.length; k++) {
          p.update(k / idx.length, `Page ${idx[k] + 1}`);
          const type = fmt === 'png' ? o.type.value : 'image/png';
          const c = await renderToCanvas(pdf, idx[k], fmt === 'docx' ? 150 / 72 : dpi / 72);
          const page = await pdf.getPage(idx[k] + 1); const vp = page.getViewport({ scale: 1 });
          imgs.push({ blob: await canvasToBlob(c, type, 0.92), bytes: fmt === 'docx' ? await canvasToBytes(c, 'image/png') : null, dataUrl: fmt === 'pptx' ? c.toDataURL('image/jpeg', 0.9) : null, w: vp.width, h: vp.height, n: idx[k] + 1 }); c.width = c.height = 0;
        }
        destroyPdf(pdf);
        if (fmt === 'png') {
          const ext = o.type.value === 'image/jpeg' ? 'jpg' : o.type.value === 'image/webp' ? 'webp' : 'png';
          if (imgs.length === 1) downloadBlob(imgs[0].blob, `${base}-page${imgs[0].n}.${ext}`);
          else { const zip = new JSZip(); imgs.forEach(im => zip.file(`${base}-page${String(im.n).padStart(3, '0')}.${ext}`, im.blob)); p.update(null, 'Zipping…'); downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}-images.zip`); }
        } else if (fmt === 'pptx') {
          p.update(null, 'Building slides…'); const Pptx = await loadPptx(); const pptx = new Pptx(); pptx.title = base;
          pptx.defineLayout({ name: 'PDF', width: imgs[0].w / 72, height: imgs[0].h / 72 }); pptx.layout = 'PDF';
          imgs.forEach(im => { const s = pptx.addSlide(); s.addImage({ data: im.dataUrl, x: 0, y: 0, w: im.w / 72, h: im.h / 72 }); });
          downloadBlob(await pptx.write({ outputType: 'blob' }), base + '.pptx');
        } else downloadBlob(await toDocx([], { images: imgs.map(im => ({ bytes: im.bytes, w: im.w, h: im.h })) }), base + '.docx');
        toast('Export complete.', 'success'); return;
      }
      // text-based formats
      const needOcr = o.ocr?.checked ? [] : null;
      if (needOcr) for (const i of idx) { if (!doc.pages[i].ocr) { const t = (await (await import('./pdfio.js')).getPageText(doc.pdf, i)).items; if (!t.length) needOcr.push(i); } }
      if (needOcr?.length) {
        p.update(0, `Running OCR on ${needOcr.length} scanned page${needOcr.length === 1 ? '' : 's'}…`);
        const { runOcr } = await import('./ocr.js');
        await runOcr(doc, needOcr, { langs: ['eng'], scale: 3, onProgress: (f, t) => p.update(f, t) }); needOcr.forEach(i => dv.viewer.invalidate(i));
      }
      p.update(null, 'Reading page text…');
      const pagesSegs = []; for (const i of idx) pagesSegs.push(await pageSegments(doc, i));
      if (pagesSegs.every(s => !s.length)) { toast('No text was found. Run OCR first, or enable “Use OCR” and try again.', 'error', 8000); return; }
      p.update(null, 'Writing file…');
      if (fmt === 'xlsx') downloadBlob(await toXlsx(pagesSegs), base + '.xlsx');
      else {
        const blocks = buildBlocks(pagesSegs);
        if (fmt === 'docx') downloadBlob(await toDocx(blocks), base + '.docx');
        else if (fmt === 'txt') downloadBlob(new Blob([toTxt(blocks)], { type: 'text/plain;charset=utf-8' }), base + '.txt');
        else if (fmt === 'md') downloadBlob(new Blob([toMd(blocks)], { type: 'text/markdown;charset=utf-8' }), base + '.md');
        else if (fmt === 'html') downloadBlob(new Blob([toHtml(blocks, base)], { type: 'text/html;charset=utf-8' }), base + '.html');
      }
      toast('Export complete.', 'success');
    } catch (e) { console.error(e); toast(`Export failed: ${e.message || e}`, 'error', 9000); }
    finally { p.close(); }
  }

  el.append(dv.panelHeader('Export & convert', 'Turn this PDF into another format.'),
    h('div.panel-b', grid, opts, field('Pages', scope), go,
      h('p.hint', 'Word, Excel and HTML are rebuilt from the text and layout of each page, so complex designs are simplified. Use “Exact look” in Word or the Images / PowerPoint options when the layout must be preserved.')));
  return {};
}
