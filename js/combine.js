// Combine files: merge PDFs (and images, Word, text, spreadsheets) into one document.
import { h, icon, button, toast, pickFiles, readBytes, withProgress, uid, emptyState, confirmDialog } from './ui.js';
import { openPdfJs, PDFLib, parseRanges } from './pdfio.js';

const { PDFDocument, degrees } = PDFLib;

export function mount(root, app) {
  const items = []; let dragId = null;
  const grid = h('div.cb-grid'); const summary = h('span.cb-summary'); const holder = h('div');
  const combineBtn = button({ label: 'Combine files', icon: 'merge', kind: 'primary', disabled: true, onClick: () => combine() });
  const bar = h('div.cb-bar', button({ label: 'Add files', icon: 'plus', onClick: async () => addFiles(await pickFiles({ accept: 'application/pdf,.pdf,image/*,.docx,.txt,.md,.csv,.xlsx', multiple: true })) }),
    button({ label: 'Clear all', kind: 'ghost', onClick: async () => { if (items.length && await confirmDialog({ title: 'Remove all files?', message: 'The list will be emptied. Your original files are not affected.', confirmLabel: 'Remove all', danger: true })) { items.length = 0; draw(); } } }),
    h('span.grow'), summary, combineBtn);
  root.append(h('div.home-inner', h('div.sec-h', h('div', h('h1', 'Combine files'), h('p.hint', 'Add PDFs or images, drag to reorder, optionally pick page ranges, then combine. Files never leave your device.'))), bar, holder));

  async function addFiles(files) {
    if (!files.length) return;
    await withProgress('Reading files', async p => {
      for (const [i, f] of files.entries()) {
        p.update(i / files.length, f.name);
        try {
          let bytes = await readBytes(f);
          if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) { const { fileToPdf } = await import('./create.js'); bytes = await fileToPdf(f, bytes); }
          await PDFDocument.load(bytes, { updateMetadata: false }); // must be writable
          const { pdf } = await openPdfJs(bytes, { name: f.name, askPassword: false });
          items.push({ id: uid(), name: f.name, bytes, pdf, pages: pdf.numPages, range: '', rot: 0 });
        } catch (e) { toast(`Skipped “${f.name}”: ${/encrypt/i.test(e.message) || e.name === 'PasswordException' ? 'it is password protected — open it from Home and use “Unlock for editing” first' : e.message}`, 'error', 8000); }
      }
    });
    draw();
  }

  async function thumb(it, box) {
    try { const page = await it.pdf.getPage(1); const vp = page.getViewport({ scale: 0.4 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); await page.render({ canvasContext: x, canvas: c, viewport: vp }).promise; box.replaceChildren(c); } catch {}
  }

  function draw() {
    holder.replaceChildren();
    if (!items.length) {
      holder.append(h('button.dropzone', { type: 'button', onclick: async () => addFiles(await pickFiles({ accept: 'application/pdf,.pdf,image/*,.docx,.txt,.md,.csv,.xlsx', multiple: true })) }, icon('cloud', 40), h('strong', 'Drop files here or click to add'), h('span', 'PDF, JPG, PNG, WebP, Word (.docx), text, CSV and Excel (.xlsx) files are all accepted.')));
    } else holder.append(grid);
    grid.replaceChildren(...items.map((it, n) => card(it, n)));
    const total = items.reduce((s, it) => { try { return s + parseRanges(it.range, it.pages).length; } catch { return s; } }, 0);
    summary.textContent = items.length ? `${items.length} file${items.length === 1 ? '' : 's'} · ${total} page${total === 1 ? '' : 's'}` : '';
    combineBtn.disabled = items.length < 1;
  }

  function card(it, n) {
    const box = h('div.cb-thumb'); thumb(it, box);
    const range = h('input.input', { type: 'text', value: it.range, placeholder: 'All pages', 'aria-label': `Page range for ${it.name}`, title: 'Pages to include, e.g. 1-3, 5, 8-', oninput: e => { it.range = e.target.value; e.target.classList.remove('bad'); }, onchange: draw });
    const el = h('div.cb-card', { draggable: true, dataset: { id: it.id } },
      h('span.cb-order', n + 1), box, h('div.cb-name', { title: it.name }, it.name),
      h('div.cb-meta', h('span', `${it.pages} page${it.pages === 1 ? '' : 's'}`), h('span', it.rot ? `Rotated ${it.rot}°` : '')),
      h('div.cb-actions', range,
        button({ icon: 'rotate-cw', kind: 'ghost', size: 'sm', title: 'Rotate all pages 90° right', onClick: () => { it.rot = (it.rot + 90) % 360; draw(); } }),
        button({ icon: 'trash', kind: 'ghost', size: 'sm', title: `Remove ${it.name}`, onClick: () => { items.splice(items.indexOf(it), 1); draw(); } })));
    el.addEventListener('dragstart', e => { dragId = it.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'file'); requestAnimationFrame(() => el.classList.add('dragging')); });
    el.addEventListener('dragend', () => { dragId = null; grid.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(c => c.classList.remove('dragging', 'drop-before', 'drop-after')); });
    el.addEventListener('dragover', e => { if (!dragId || dragId === it.id) return; e.preventDefault(); const r = el.getBoundingClientRect(); const before = e.clientX < r.left + r.width / 2; el.classList.toggle('drop-before', before); el.classList.toggle('drop-after', !before); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', e => {
      if (!dragId) return; e.preventDefault(); e.stopPropagation(); const r = el.getBoundingClientRect(); const before = e.clientX < r.left + r.width / 2;
      const moving = items.splice(items.findIndex(x => x.id === dragId), 1)[0]; let at = items.indexOf(it); if (!before) at++; items.splice(at, 0, moving); dragId = null; draw();
    });
    return el;
  }

  async function combine() {
    const bytes = await withProgress('Combining files', async p => {
      const out = await PDFDocument.create();
      for (const [i, it] of items.entries()) {
        p.update(i / items.length, `${it.name}`);
        let idx; try { idx = parseRanges(it.range, it.pages); } catch (e) { throw new Error(`${it.name}: ${e.message}`); }
        const src = await PDFDocument.load(it.bytes, { updateMetadata: false });
        const pages = await out.copyPages(src, idx);
        pages.forEach(pg => { if (it.rot) pg.setRotation(degrees((pg.getRotation().angle + it.rot) % 360)); out.addPage(pg); });
      }
      return out.save({ useObjectStreams: true });
    });
    if (!bytes) return;
    const name = items.length === 1 ? items[0].name.replace(/\.[^.]+$/, '') + '.pdf' : 'Combined.pdf';
    await app.openBytes(name, bytes); toast('Files combined — download it from the new tab.', 'success');
  }

  app.views.get('combine').api = { addFiles };
  draw();
}
