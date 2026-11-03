// Organize pages: reorder (drag & drop), rotate, delete, duplicate, extract, insert, split.
import { h, icon, button, toast, dialog, field, select, confirmDialog, withProgress, pickFiles, readBytes, uid, downloadBlob, baseName, popupMenu, clamp } from './ui.js';
import { openPdfJs, PDFLib, parseRanges, PAGE_SIZES } from './pdfio.js';

const { PDFDocument, degrees } = PDFLib;

export function openOrganize(dv) {
  if (!dv.editable) return dv.needUnlock();
  if (dv.organizer) return;
  dv.organizer = new Organizer(dv);
}

class Organizer {
  constructor(dv) {
    this.dv = dv; this.doc = dv.doc; this.app = dv.app;
    this.sources = new Map(); // key -> { pdf, bytes }
    this.sources.set('self', { pdf: this.doc.pdf, bytes: null });
    this.items = Array.from({ length: this.doc.numPages }, (_, i) => this.makeItem('self', i));
    this.last = null; this.thumbSize = 160;
    this.root = dv.organizeEl;
    this.dragIds = null;
    this.build(); this.render();
    this.root.hidden = false; dv.scrollEl.style.visibility = 'hidden';
    this.keyHandler = e => this.onKey(e); this.root.addEventListener('keydown', this.keyHandler);
  }

  makeItem(key, index, extra = {}) { return { id: uid(), key, index, rot: 0, selected: false, ...extra }; }

  /* ---------------------------------------------------------------- UI */
  build() {
    const mk = (ic, title, fn, label) => { const b = button({ icon: ic, label, kind: 'ghost', title, onClick: fn, size: 'sm' }); return b; };
    this.bar = h('div.og-bar',
      mk('select-all', 'Select all pages (Ctrl+A)', () => this.selectAll(), 'Select all'),
      h('span.sep'),
      mk('rotate-ccw', 'Rotate left', () => this.rotate(-90)), mk('rotate-cw', 'Rotate right', () => this.rotate(90)),
      mk('duplicate', 'Duplicate selected pages', () => this.duplicate()), mk('trash', 'Delete selected pages (Del)', () => this.remove()),
      mk('chev-left', 'Move selected pages earlier', () => this.move(-1)), mk('chev-right', 'Move selected pages later', () => this.move(1)),
      h('span.sep'),
      mk('export', 'Extract selected pages into a new document', () => this.extract(), 'Extract'),
      mk('scissors', 'Split document', () => this.splitDialog(), 'Split'),
      (this.insertBtn = mk('plus', 'Insert pages', () => popupMenu(this.insertBtn, [
        { label: 'Blank page', icon: 'blank', onClick: () => this.insertBlank() },
        { label: 'Pages from another file…', icon: 'file-plus', onClick: () => this.insertFromFile() },
      ]), 'Insert')),
      h('span.grow'),
      h('label.og-size', h('span.sr-only', 'Thumbnail size'), icon('zoom-out', 14), h('input', { type: 'range', min: 100, max: 260, value: this.thumbSize, 'aria-label': 'Thumbnail size', oninput: e => { this.thumbSize = +e.target.value; this.grid.style.setProperty('--og', this.thumbSize + 'px'); } }), icon('zoom-in', 14)),
      this.countEl = h('span.og-count'),
      button({ label: 'Cancel', onClick: () => this.close(), size: 'sm' }),
      this.applyBtn = button({ label: 'Apply changes', kind: 'primary', onClick: () => this.apply(), size: 'sm' }));
    this.grid = h('div.og-grid', { style: { '--og': this.thumbSize + 'px' }, tabindex: 0, role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Pages' });
    this.grid.addEventListener('dragover', e => this.onDragOver(e)); this.grid.addEventListener('drop', e => this.onDrop(e)); this.grid.addEventListener('dragleave', e => { if (!this.grid.contains(e.relatedTarget)) this.clearMarks(); });
    this.grid.addEventListener('click', e => { if (e.target === this.grid) { this.items.forEach(i => (i.selected = false)); this.syncSel(); } });
    this.root.replaceChildren(this.bar, h('div.og-scroll', this.grid));
    this.io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { this.io.unobserve(e.target); this.drawThumb(this.items.find(i => i.id === e.target.dataset.id), e.target); } }), { root: this.root.querySelector('.og-scroll'), rootMargin: '300px' });
  }

  render() {
    this.cards = this.cards || new Map();
    const frag = document.createDocumentFragment();
    const before = new Map([...this.cards].map(([id, el]) => [id, el.getBoundingClientRect()]));
    this.items.forEach((it, n) => {
      let el = this.cards.get(it.id);
      if (!el) { el = this.makeCard(it); this.cards.set(it.id, el); this.io.observe(el); }
      el.querySelector('.og-num').textContent = n + 1;
      el.classList.toggle('selected', it.selected); el.setAttribute('aria-selected', String(it.selected));
      frag.append(el);
    });
    for (const [id, el] of [...this.cards]) if (!this.items.some(i => i.id === id)) { el.remove(); this.cards.delete(id); this.io.unobserve(el); }
    this.grid.replaceChildren(frag);
    // FLIP: animate cards from their old position to the new one
    for (const [id, el] of this.cards) {
      const b = before.get(id); if (!b) { el.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' }); continue; }
      const a = el.getBoundingClientRect(); const dx = b.left - a.left, dy = b.top - a.top;
      if (Math.abs(dx) + Math.abs(dy) > 2) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    this.syncSel();
  }

  makeCard(it) {
    const card = h('div.og-card', { role: 'option', draggable: true, dataset: { id: it.id }, tabindex: -1 },
      h('div.og-thumb', h('div.og-ph')), h('div.og-label', h('span.og-num'), it.blank ? h('em', 'Blank') : null, it.key !== 'self' ? h('em', 'Inserted') : null),
      h('span.og-check', icon('check', 14)));
    card.addEventListener('click', e => this.onSelect(it, e));
    card.addEventListener('dblclick', () => { this.close(); this.dv.viewer.scrollToPage(it.index); });
    card.addEventListener('dragstart', e => {
      if (!it.selected) { this.items.forEach(i => (i.selected = i === it)); this.syncSel(); }
      this.dragIds = this.items.filter(i => i.selected).map(i => i.id);
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pages');
      requestAnimationFrame(() => this.dragIds.forEach(id => this.cards.get(id)?.classList.add('dragging')));
    });
    card.addEventListener('dragend', () => { this.dragIds = null; this.clearMarks(); this.cards.forEach(c => c.classList.remove('dragging')); });
    return card;
  }

  async drawThumb(it, card) {
    if (!it) return;
    const box = card.querySelector('.og-thumb');
    try {
      let canvas = document.createElement('canvas');
      if (it.blank) { const r = it.blank.h / it.blank.w; canvas.width = 180; canvas.height = Math.round(180 * r); const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height); }
      else {
        const src = this.sources.get(it.key); const page = await src.pdf.getPage(it.index + 1);
        const rotation = ((page.rotate + it.rot) % 360 + 360) % 360;
        const vp = page.getViewport({ scale: 0.38, rotation });
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: c, canvas, viewport: vp }).promise;
      }
      canvas.setAttribute('aria-hidden', 'true');
      const old = box.querySelector('canvas');
      if (old) { old.replaceWith(canvas); canvas.animate([{ transform: `rotate(${-(it.lastDir || 0)}deg) scale(.86)`, opacity: .25 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' }); }
      else { box.replaceChildren(canvas); canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 }); }
      box.dataset.rot = it.rot;
    } catch (e) { console.warn('organize thumb', e); }
  }

  /* ---------------------------------------------------------------- selection */
  onSelect(it, e) {
    const idx = this.items.indexOf(it);
    if (e.shiftKey && this.last != null) {
      const [a, b] = [Math.min(this.last, idx), Math.max(this.last, idx)];
      this.items.forEach((x, k) => { x.selected = k >= a && k <= b; });
    } else if (e.ctrlKey || e.metaKey) { it.selected = !it.selected; this.last = idx; }
    else { const was = it.selected && this.items.filter(x => x.selected).length === 1; this.items.forEach(x => (x.selected = false)); it.selected = !was; this.last = idx; }
    this.syncSel();
  }
  selectAll() { const all = this.items.every(i => i.selected); this.items.forEach(i => (i.selected = !all)); this.syncSel(); }
  syncSel() {
    this.items.forEach(i => { const c = this.cards.get(i.id); if (c) { c.classList.toggle('selected', i.selected); c.setAttribute('aria-selected', String(i.selected)); } });
    const n = this.items.filter(i => i.selected).length;
    this.countEl.textContent = `${this.items.length} page${this.items.length === 1 ? '' : 's'}${n ? ` · ${n} selected` : ''}`;
    this.bar.querySelectorAll('button').forEach(b => { if (/rotate|duplicate|delete|earlier|later|extract/i.test(b.title)) b.disabled = !n; });
  }
  get sel() { return this.items.filter(i => i.selected); }

  /* ---------------------------------------------------------------- edits */
  rotate(deg) {
    this.sel.forEach(it => { it.rot = ((it.rot + deg) % 360 + 360) % 360; it.lastDir = deg; const c = this.cards.get(it.id); if (c) this.drawThumb(it, c); });
  }
  remove() {
    const n = this.sel.length; if (!n) return;
    if (n === this.items.length) return toast('A document needs at least one page.', 'error');
    this.items = this.items.filter(i => !i.selected); this.last = null; this.render();
  }
  duplicate() {
    const out = [];
    for (const it of this.items) { out.push(it); if (it.selected) { const c = { ...it, id: uid(), selected: true, dup: true }; out.push(c); it.selected = false; } }
    this.items = out; this.render();
  }
  move(dir) {
    const items = this.items; const sel = this.sel; if (!sel.length) return;
    if (dir < 0) for (let i = 1; i < items.length; i++) { if (items[i].selected && !items[i - 1].selected) [items[i - 1], items[i]] = [items[i], items[i - 1]]; }
    else for (let i = items.length - 2; i >= 0; i--) { if (items[i].selected && !items[i + 1].selected) [items[i + 1], items[i]] = [items[i], items[i + 1]]; }
    this.render();
  }
  insertAt() { const idx = this.items.map(i => i.selected).lastIndexOf(true); return idx < 0 ? this.items.length : idx + 1; }
  insertBlank() {
    const ref = this.items[Math.max(0, this.insertAt() - 1)];
    const info = this.dv.viewer.pages[ref?.key === 'self' ? ref.index : 0];
    const w = info?.w || PAGE_SIZES.A4[0], hh = info?.h || PAGE_SIZES.A4[1];
    this.items.splice(this.insertAt(), 0, this.makeItem('blank', 0, { blank: { w, h: hh }, selected: false })); this.render();
  }
  async insertFromFile() {
    const files = await pickFiles({ accept: 'application/pdf,.pdf,image/*', multiple: true }); if (!files.length) return;
    await withProgress('Reading files', async () => {
      let at = this.insertAt();
      for (const f of files) {
        let bytes = await readBytes(f);
        if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) { const { fileToPdf } = await import('./create.js'); bytes = await fileToPdf(f, bytes); }
        const { pdf } = await openPdfJs(bytes, { name: f.name }); const key = uid();
        this.sources.set(key, { pdf, bytes });
        for (let i = 0; i < pdf.numPages; i++) this.items.splice(at++, 0, this.makeItem(key, i));
      }
    });
    this.render();
  }

  /* ---------------------------------------------------------------- drag & drop */
  dropIndex(e) {
    const cards = [...this.grid.querySelectorAll('.og-card:not(.dragging)')];
    let best = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) { if (e.clientX < r.left + r.width / 2) return { el: c, before: true }; best = { el: c, before: false }; }
    }
    if (best) return best;
    for (const c of cards) { const r = c.getBoundingClientRect(); if (e.clientY < r.top) return { el: c, before: true }; }
    return cards.length ? { el: cards[cards.length - 1], before: false } : null;
  }
  onDragOver(e) { if (!this.dragIds) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; this.clearMarks(); const d = this.dropIndex(e); if (d) d.el.classList.add(d.before ? 'drop-before' : 'drop-after'); }
  clearMarks() { this.grid.querySelectorAll('.drop-before, .drop-after').forEach(c => c.classList.remove('drop-before', 'drop-after')); }
  onDrop(e) {
    if (!this.dragIds) return; e.preventDefault();
    const d = this.dropIndex(e); this.clearMarks(); if (!d) return;
    const moving = this.items.filter(i => this.dragIds.includes(i.id)); const rest = this.items.filter(i => !this.dragIds.includes(i.id));
    const targetId = d.el.dataset.id; let at = rest.findIndex(i => i.id === targetId); if (!d.before) at++;
    rest.splice(at, 0, ...moving); this.items = rest; this.dragIds = null; this.cards.forEach(c => c.classList.remove('dragging')); this.render();
  }
  onKey(e) {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.selectAll(); }
    else if (e.key === 'Escape') this.close();
  }

  /* ---------------------------------------------------------------- output */
  async buildPdf(items, baked) {
    const out = await PDFDocument.create(); const cache = new Map();
    cache.set('self', await PDFDocument.load(baked, { updateMetadata: false }));
    for (const it of items) {
      if (it.blank) { out.addPage([it.blank.w, it.blank.h]); continue; }
      let src = cache.get(it.key);
      if (!src) { src = await PDFDocument.load(this.sources.get(it.key).bytes, { updateMetadata: false }); cache.set(it.key, src); }
      const [pg] = await out.copyPages(src, [it.index]);
      if (it.rot) pg.setRotation(degrees((((pg.getRotation().angle + it.rot) % 360) + 360) % 360));
      out.addPage(pg);
    }
    return out.save({ useObjectStreams: true });
  }

  async apply() {
    const changed = this.items.some((it, n) => it.key !== 'self' || it.index !== n || it.rot) || this.items.length !== this.doc.numPages;
    if (!changed) return this.close();
    const ok = this.doc.hasEdits() ? await confirmDialog({ title: 'Apply page changes?', message: 'Your edits on these pages (text, shapes, signatures, OCR) will be merged into the document so they can no longer be moved or edited individually.', confirmLabel: 'Apply changes' }) : true;
    if (!ok) return;
    const bytes = await withProgress('Applying page changes', async p => { p.update(null, 'Rebuilding document…'); const baked = await this.doc.bake(); return this.buildPdf(this.items, baked); });
    if (!bytes) return;
    await this.doc.replaceBytes(bytes); this.close(); toast('Page changes applied.', 'success');
  }

  async extract() {
    const sel = this.sel; if (!sel.length) return;
    const bytes = await withProgress('Extracting pages', async () => this.buildPdf(sel, await this.doc.bake()));
    if (!bytes) return;
    await this.app.openBytes(baseName(this.doc.name) + '-extract.pdf', bytes);
    toast(`Extracted ${sel.length} page${sel.length === 1 ? '' : 's'} into a new tab.`, 'success');
  }

  splitDialog() {
    const total = this.items.length;
    const mode = select([['every', 'Every N pages'], ['ranges', 'By page ranges'], ['each', 'Each page separately']], 'every', v => draw());
    const nIn = h('input.input', { type: 'number', min: 1, value: Math.max(1, Math.ceil(total / 2)) });
    const rIn = h('input.input', { type: 'text', placeholder: 'e.g. 1-3, 4-6, 7-' });
    const hold = h('div');
    const draw = () => { hold.replaceChildren(mode.value === 'every' ? field('Pages per file', nIn) : mode.value === 'ranges' ? field('Ranges (one file per range)', rIn, `This document has ${total} pages.`) : h('p.hint', `Creates ${total} single-page files.`)); };
    draw();
    const d = dialog({
      title: 'Split document', width: 440, body: h('div', field('Split', mode), hold, h('p.hint', 'You get a ZIP file with one PDF per part. Page order and rotations from this screen are used.')),
      actions: [button({ label: 'Cancel', onClick: () => d.close() }), button({ label: 'Split & download', kind: 'primary', onClick: async () => {
        let groups;
        try {
          if (mode.value === 'every') { const n = Math.max(1, +nIn.value | 0); groups = []; for (let i = 0; i < total; i += n) groups.push(this.items.slice(i, i + n)); }
          else if (mode.value === 'each') groups = this.items.map(i => [i]);
          else groups = rIn.value.split(',').map(s => s.trim()).filter(Boolean).map(r => parseRanges(r, total).map(i => this.items[i]));
          if (!groups.length) throw new Error('Nothing to split');
        } catch (e) { return toast(e.message, 'error'); }
        d.close();
        await withProgress('Splitting', async p => {
          const baked = await this.doc.bake(); const zip = new JSZip();
          for (let g = 0; g < groups.length; g++) { p.update(g / groups.length, `Part ${g + 1} of ${groups.length}`); zip.file(`${baseName(this.doc.name)}-part${String(g + 1).padStart(2, '0')}.pdf`, await this.buildPdf(groups[g], baked)); }
          downloadBlob(await zip.generateAsync({ type: 'blob' }), baseName(this.doc.name) + '-split.zip');
        });
        toast('Split complete — check your downloads.', 'success');
      } })],
    });
  }

  close() {
    this.root.hidden = true; this.root.replaceChildren(); this.dv.scrollEl.style.visibility = '';
    this.io.disconnect(); this.root.removeEventListener('keydown', this.keyHandler); this.dv.organizer = null;
    this.dv.viewer.applyFit();
  }
}
