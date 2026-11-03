// The editor screen for one open document: toolbar, property bar, side panels, viewer.
import { h, icon, button, toast, dialog, confirmDialog, popupMenu, field, select, downloadBlob, printBlob, baseName, withProgress, clamp, uid } from './ui.js';
import { Viewer } from './viewer.js';
import { Annots } from './annots.js';
import { renderToCanvas } from './pdfio.js';
import { BASELINE } from './bake.js';
import { fontPicker } from './fontpicker.js';

const TOOLS = [
  { id: 'undo', icon: 'undo', label: 'Undo', key: 'Ctrl+Z', action: dv => dv.doc.undo(), state: dv => !dv.doc.canUndo },
  { id: 'redo', icon: 'redo', label: 'Redo', key: 'Ctrl+Y', action: dv => dv.doc.redo(), state: dv => !dv.doc.canRedo },
  '|',
  { id: 'select', icon: 'select', label: 'Select', key: 'V', tool: 'select' },
  { id: 'edittext', icon: 'edit-text', label: 'Edit text', key: 'E', tool: 'edittext', edit: true },
  { id: 'text', icon: 'text-add', label: 'Add text', key: 'T', tool: 'text', edit: true },
  { id: 'image', icon: 'image-add', label: 'Add image', action: dv => dv.annots.chooseImage(), edit: true },
  '|',
  { id: 'rect', icon: 'rect', label: 'Rectangle', tool: 'rect', edit: true },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', tool: 'ellipse', edit: true },
  { id: 'line', icon: 'line', label: 'Line', tool: 'line', edit: true },
  { id: 'arrow', icon: 'arrow', label: 'Arrow', tool: 'arrow', edit: true },
  { id: 'pen', icon: 'pen', label: 'Draw', tool: 'pen', edit: true },
  '|',
  { id: 'highlight', icon: 'highlight', label: 'Highlight text', tool: 'highlight', edit: true },
  { id: 'underline', icon: 'underline', label: 'Underline text', tool: 'underline', edit: true },
  { id: 'strike', icon: 'strike', label: 'Strike through text', tool: 'strike', edit: true },
  { id: 'highlighter', icon: 'marker', label: 'Freehand highlighter', tool: 'highlighter', edit: true },
  { id: 'note', icon: 'note', label: 'Add comment', tool: 'note', edit: true },
  '|',
  { id: 'whiteout', icon: 'whiteout', label: 'White-out', tool: 'whiteout', edit: true },
  { id: 'redact', icon: 'redact', label: 'Redact (permanent)', tool: 'redact', edit: true },
  { id: 'check', icon: 'check', label: 'Checkmark', tool: 'check', edit: true },
  { id: 'cross', icon: 'cross', label: 'Cross', tool: 'cross', edit: true },
  { id: 'sign', icon: 'sign', label: 'Sign', action: dv => dv.openPanel('sign'), edit: true },
];
const ICON_FIX = { marker: 'highlight' };

const RAIL = [
  ['organize', 'layers', 'Organize pages'],
  ['signatures', 'certificate', 'Digital signatures'],
  ['export', 'export', 'Export & convert'],
  ['ocr', 'ocr', 'Scan & OCR'],
  ['verify', 'shield-check', 'Verify documents'],
  ['tools', 'cog', 'More tools'],
];

const FONT_OPTS = [['helv', 'Sans (Helvetica)'], ['times', 'Serif (Times)'], ['cour', 'Mono (Courier)']];

export class DocView {
  constructor(doc, app) {
    this.doc = doc; this.app = app; this.panel = null; this.panelApi = null;
    this.find = { hits: [], idx: -1, q: '' };
    this.root = h('div.docview');
    this.build();
  }

  get editable() { return this.doc.editable; }

  async init() {
    this.viewer = new Viewer(this.doc, this.scrollEl);
    this.annots = new Annots(this);
    this.annots.addEventListener('selection', () => this.renderProps());
    this.annots.addEventListener('tool', () => { this.syncToolbar(); this.renderProps(); });
    this.viewer.addEventListener('page', e => this.onPage(e.detail));
    this.viewer.addEventListener('zoom', () => this.syncZoom());
    this.doc.addEventListener('history', () => this.syncToolbar());
    this.doc.addEventListener('structure', () => this.rebuild());
    await this.viewer.build();
    this.buildThumbs();
    this.syncToolbar(); this.syncZoom(); this.renderProps(); this.onPage(0);
    this.updateBanner();
    import('./signatures.js').then(m => m.attach(this)).catch(e => console.warn('signature check skipped', e));
  }

  async rebuild() {
    this.annots.sel = null; this.annots.editing = null;
    this.sigApi?.clear(); await this.viewer.build(); this.buildThumbs(); this.updateBanner(); this.syncToolbar(); this.onPage(Math.min(this.viewer.current, this.doc.numPages - 1));
    if (this.panelApi?.refresh) this.panelApi.refresh();
  }

  /* ------------------------------------------------------------ DOM */
  build() {
    this.toolbarEl = h('div.dv-toolbar', { role: 'toolbar', 'aria-label': 'Document tools' });
    this.propsEl = h('div.dv-props', { 'aria-label': 'Tool options' });
    this.bannerEl = h('div.dv-banner', { hidden: true });
    this.sigBarEl = h('div.dv-sigbar', { hidden: true, role: 'status' });
    this.scrollEl = h('div.dv-scroll', { tabindex: 0 });
    this.leftEl = h('aside.dv-left', { 'aria-label': 'Sidebar' });
    this.rightEl = h('aside.dv-right', { hidden: true, 'aria-label': 'Tool panel' });
    this.railEl = h('nav.dv-rail', { 'aria-label': 'Tools' });
    this.organizeEl = h('div.dv-organize', { hidden: true });
    this.statusEl = h('div.dv-status');
    this.body = h('div.dv-body', this.leftEl, h('div.dv-center', this.sigBarEl, this.bannerEl, this.scrollEl, this.organizeEl), this.rightEl, this.railEl);
    this.root.append(this.toolbarEl, this.propsEl, this.body, this.statusEl);
    this.buildToolbar(); this.buildLeft(); this.buildRail();
    if (matchMedia('(max-width: 1000px)').matches) this.leftEl.hidden = true; // phones/tablets: open the sidebar on demand
    this.sideBtn.setAttribute('aria-pressed', String(!this.leftEl.hidden));
    this.root.addEventListener('keydown', e => this.onKey(e));
  }

  buildToolbar() {
    const t = this.toolbarEl; this.btns = {};
    this.sideBtn = button({ icon: 'panel', kind: 'ghost', title: 'Show or hide the page sidebar', onClick: () => this.toggleLeft() });
    t.append(this.sideBtn, h('span.sep'));
    for (const it of TOOLS) {
      if (it === '|') { t.append(h('span.sep')); continue; }
      const ic = ICON_FIX[it.icon] || it.icon;
      const b = button({ icon: ic, kind: 'ghost', title: it.label + (it.key ? ` (${it.key})` : ''), cls: 'tb' });
      b.dataset.id = it.id;
      b.addEventListener('click', () => {
        if (it.edit && !this.editable) return this.needUnlock();
        if (it.tool) this.setTool(this.annots.tool === it.tool && it.tool !== 'select' ? 'select' : it.tool);
        else it.action(this);
      });
      this.btns[it.id] = { b, it }; t.append(b);
    }
    t.append(h('span.grow'), button({ icon: 'search', kind: 'ghost', title: 'Find in document (Ctrl+F)', onClick: () => this.showLeft('find') }));
    // page navigation + zoom live in the status bar at the bottom
    this.pageInput = h('input.input.page-input', { type: 'number', min: 1, 'aria-label': 'Page number', onchange: e => this.viewer.scrollToPage(clamp(+e.target.value - 1, 0, this.doc.numPages - 1)) });
    this.pageTotal = h('span.page-total');
    this.zoomSel = select([['fitw', 'Fit width'], ['fitp', 'Fit page'], ['50', '50%'], ['75', '75%'], ['100', '100%'], ['125', '125%'], ['150', '150%'], ['200', '200%'], ['300', '300%']], 'fitw', v => {
      if (v === 'fitw') this.viewer.setFit('width'); else if (v === 'fitp') this.viewer.setFit('page'); else this.viewer.setZoom(+v / 100);
    });
    this.zoomSel.classList.add('zoom-select'); this.zoomSel.setAttribute('aria-label', 'Zoom');
    this.statusInfo = h('span.status-info');
    this.statusEl.append(this.statusInfo, h('span.grow'),
      button({ icon: 'chev-up', kind: 'ghost', size: 'sm', title: 'Previous page', onClick: () => this.viewer.scrollToPage(this.viewer.current - 1) }),
      this.pageInput, this.pageTotal,
      button({ icon: 'chev-down', kind: 'ghost', size: 'sm', title: 'Next page', onClick: () => this.viewer.scrollToPage(this.viewer.current + 1) }),
      h('span.sep'),
      button({ icon: 'zoom-out', kind: 'ghost', size: 'sm', title: 'Zoom out (Ctrl + −)', onClick: () => this.viewer.setZoom(this.viewer.zoom / 1.15) }),
      this.zoomSel,
      button({ icon: 'zoom-in', kind: 'ghost', size: 'sm', title: 'Zoom in (Ctrl + +)', onClick: () => this.viewer.setZoom(this.viewer.zoom * 1.15) }));
  }

  setTool(t) {
    if (!this.editable && t !== 'select') return this.needUnlock();
    this.annots.setTool(t);
  }
  needUnlock() {
    toast('This file is locked for editing. Use “Unlock for editing” in the banner above the page.', 'error', 6000);
  }

  syncToolbar() {
    const cur = this.annots?.tool;
    for (const { b, it } of Object.values(this.btns)) {
      if (it.tool) b.setAttribute('aria-pressed', String(cur === it.tool));
      if (it.state) b.disabled = it.state(this);
      if (it.edit && !this.editable) b.classList.add('locked'); else b.classList.remove('locked');
    }
  }

  syncZoom() {
    const z = this.viewer.zoom;
    this.zoomSel.value = this.viewer.fitMode === 'width' ? 'fitw' : this.viewer.fitMode === 'page' ? 'fitp' : '';
    if (this.viewer.fitMode === 'custom') {
      let o = this.zoomSel.querySelector('option[data-custom]');
      if (!o) { o = h('option', { dataset: { custom: '1' } }); this.zoomSel.prepend(o); }
      o.value = 'c'; o.textContent = Math.round(z * 100) + '%'; this.zoomSel.value = 'c';
    } else this.zoomSel.querySelector('option[data-custom]')?.remove();
    this.statusInfo.textContent = `${this.doc.name} · ${this.doc.numPages} page${this.doc.numPages === 1 ? '' : 's'}`;
  }
  onPage(i) {
    this.pageInput.value = i + 1; this.pageTotal.textContent = `/ ${this.doc.numPages}`;
    this.thumbEls?.forEach((t, k) => t.classList.toggle('current', k === i));
    const cur = this.thumbEls?.[i]; if (cur && this.leftTab === 'pages' && !this.leftEl.hidden) cur.scrollIntoView({ block: 'nearest' });
  }

  updateBanner() {
    const b = this.bannerEl;
    if (this.editable) { b.hidden = true; b.replaceChildren(); this.syncToolbar(); return; }
    b.hidden = false;
    b.replaceChildren(icon('lock', 18), h('span', `${this.doc.lockReason} You can read, search and export it, but editing needs an unlocked copy.`),
      button({ label: 'Unlock for editing', kind: 'primary', size: 'sm', onClick: () => this.unlock() }));
    this.syncToolbar();
  }
  async unlock() {
    const ok = await confirmDialog({ title: 'Unlock for editing?', message: 'The pages will be converted to pictures with a hidden text layer, so text stays searchable but is no longer live text. The original file on your computer is not changed.', confirmLabel: 'Unlock copy' });
    if (!ok) return;
    await withProgress('Unlocking', async p => { await this.doc.unlock({ onProgress: (f, t) => p.update(f, t) }); });
    toast('Unlocked — you can edit this copy now.', 'success');
  }

  /* ------------------------------------------------------------ property bar */
  propGroup() {
    const s = this.annots.selected;
    if (s) {
      const t = s.a.type;
      if (t === 'ink') return s.a.hl ? 'highlighter' : 'pen';
      if (t === 'line' || t === 'arrow') return 'stroke';
      if (t === 'rect' || t === 'ellipse') return 'shape';
      if (['highlight', 'underline', 'strike'].includes(t)) return 'markup';
      if (t === 'whiteout') return 'fill';
      return { text: 'text', textedit: 'textedit', note: 'note', mark: 'mark', image: 'image', redact: 'redact' }[t] || null;
    }
    return { text: 'text', edittext: 'textedit', rect: 'shape', ellipse: 'shape', line: 'stroke', arrow: 'stroke', pen: 'pen', highlighter: 'highlighter', highlight: 'markup', underline: 'markup', strike: 'markup', whiteout: 'fill', note: 'note', check: 'mark', cross: 'mark', dot: 'mark', redact: 'redact' }[this.annots.tool] || null;
  }
  renderProps() {
    const el = this.propsEl; el.replaceChildren();
    const grp = this.propGroup(); const s = this.annots.selected;
    const dKey = { stroke: 'shape', markup: this.annots.tool in this.annots.defaults ? this.annots.tool : 'highlight' }[grp] || grp;
    const val = k => (s ? s.a[k] : this.annots.defaults[dKey]?.[k]);
    const set = (k, v) => this.annots.setProp(k, v);
    const colorIn = (k, label, allowNone) => {
      const v = val(k);
      const inp = h('input', { type: 'color', value: v || '#000000', 'aria-label': label, oninput: e => { set(k, e.target.value); none && none.classList.remove('on'); } });
      const none = allowNone ? h('button.btn.btn-ghost.btn-sm.nofill' + (v ? '' : '.on'), { type: 'button', title: `No ${label.toLowerCase()}`, onclick: () => { set(k, null); none.classList.add('on'); } }, 'None') : null;
      return h('label.pg.color', h('span', label), inp, none);
    };
    const num = (k, label, min, max, step = 1) => h('label.pg', h('span', label), h('input.input.num', { type: 'number', min, max, step, value: val(k) ?? '', onchange: e => set(k, clamp(+e.target.value || min, min, max)) }));
    const range = (k, label) => h('label.pg', h('span', label), h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: val(k) ?? 1, 'aria-label': label, oninput: e => set(k, +e.target.value) }));
    const toggle = (k, ic, label) => { const b = button({ icon: ic, kind: 'ghost', title: label, cls: 'tb' }); b.setAttribute('aria-pressed', String(!!val(k))); b.onclick = () => { const nv = !val(k); set(k, nv); b.setAttribute('aria-pressed', String(nv)); }; return b; };
    const items = [];
    if (grp === 'text' || grp === 'textedit') {
      items.push(h('div.pg', h('span', 'Font'), fontPicker({ value: { font: val('font') || 'helv', gname: val('gname') }, onChange: v => this.annots.setFont(v.font, v.gname) })), num('size', 'Size', 4, 144, 0.5), toggle('bold', 'bold', 'Bold'), toggle('italic', 'italic', 'Italic'));
      if (grp === 'text') {
        const al = h('div.seg'); ['left', 'center', 'right'].forEach(a => { const b = h('button', { type: 'button', title: 'Align ' + a, 'aria-pressed': String((val('align') || 'left') === a), onclick: () => { set('align', a); al.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); } }, icon('align-' + a, 16)); al.append(b); });
        items.push(al);
      }
      items.push(colorIn('color', 'Text colour'));
      items.push(colorIn('bg', grp === 'text' ? 'Background' : 'Cover colour', grp === 'text'));
    } else if (grp === 'shape') items.push(colorIn('stroke', 'Line colour', true), num('sw', 'Width', 0.5, 40, 0.5), colorIn('fill', 'Fill', true), range('opacity', 'Opacity'));
    else if (grp === 'stroke') items.push(colorIn('stroke', 'Colour'), num('sw', 'Width', 0.5, 40, 0.5), range('opacity', 'Opacity'));
    else if (grp === 'pen' || grp === 'highlighter') items.push(colorIn('stroke', 'Colour'), num('sw', 'Width', 0.5, 60, 0.5), range('opacity', 'Opacity'));
    else if (grp === 'markup') items.push(colorIn('color', 'Colour'), range('opacity', 'Opacity'));
    else if (grp === 'fill' || grp === 'note' || grp === 'mark') items.push(colorIn('color', 'Colour'));
    else if (grp === 'image') items.push(range('opacity', 'Opacity'));
    else if (grp === 'redact') items.push(h('span.note', icon('info', 16), ' Redaction is permanent: when you save, the page becomes a picture with the black boxes burned in.'));
    if (s) {
      items.push(h('span.grow'),
        button({ icon: 'duplicate', kind: 'ghost', title: 'Duplicate (Ctrl+D)', onClick: () => this.annots.duplicateSelected() }),
        button({ icon: 'up', kind: 'ghost', title: 'Bring to front', onClick: () => this.annots.reorder(true) }),
        button({ icon: 'down', kind: 'ghost', title: 'Send to back', onClick: () => this.annots.reorder(false) }),
        button({ icon: 'trash', kind: 'ghost', title: 'Delete (Del)', onClick: () => this.annots.deleteSelected() }));
    }
    el.classList.toggle('on', items.length > 0);
    el.append(...items);
  }

  editNote(a, pi) {
    const ta = h('textarea.textarea', { rows: 5, value: a.text || '', autofocus: true, placeholder: 'Write your comment…' });
    const d = dialog({
      title: 'Comment', body: ta, width: 420,
      actions: [button({ label: 'Delete', kind: 'danger', onClick: () => { this.annots.select(a, pi); this.annots.deleteSelected(); d.close(); } }),
        button({ label: 'Save comment', kind: 'primary', onClick: () => { a.text = ta.value; this.annots.repaint(a, pi); this.doc.checkpoint(); d.close(); } })],
    });
  }

  /* ------------------------------------------------------------ left sidebar */
  buildLeft() {
    const tabs = h('div.tabs-mini', { role: 'tablist' },
      ...[['pages', 'Pages', 'pages'], ['find', 'Find', 'search'], ['forms', 'Form', 'form']].map(([id, label, ic]) =>
        h('button', { type: 'button', role: 'tab', dataset: { tab: id }, title: label, onclick: () => this.showLeft(id) }, icon(ic, 16), h('span', label))));
    this.thumbsEl = h('div.thumbs');
    this.findEl = h('div.findpane', { hidden: true });
    this.formsEl = h('div.formpane', { hidden: true });
    this.leftEl.append(tabs, this.thumbsEl, this.findEl, this.formsEl);
    this.leftTab = 'pages'; this.markTab();
    this.buildFind();
  }
  markTab() { this.leftEl.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === this.leftTab))); }
  toggleLeft() { this.leftEl.hidden = !this.leftEl.hidden; this.sideBtn.setAttribute('aria-pressed', String(!this.leftEl.hidden)); }
  showLeft(tab) {
    this.leftEl.hidden = false; this.leftTab = tab; this.markTab();
    this.thumbsEl.hidden = tab !== 'pages'; this.findEl.hidden = tab !== 'find'; this.formsEl.hidden = tab !== 'forms';
    if (tab === 'find') { const i = this.findEl.querySelector('input'); i.focus(); i.select(); }
    if (tab === 'forms') this.buildForms();
    this.sideBtn.setAttribute('aria-pressed', 'true');
  }

  buildThumbs() {
    this.thumbsEl.replaceChildren(); this.thumbEls = [];
    if (this.thumbIO) this.thumbIO.disconnect();
    this.thumbIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { this.thumbIO.unobserve(e.target); this.drawThumb(e.target); } }), { root: this.thumbsEl, rootMargin: '300px' });
    for (let i = 0; i < this.doc.numPages; i++) {
      const pg = this.viewer.pages[i];
      const ratio = pg ? pg.h / pg.w : 1.41;
      const box = h('div.thumb-img', { style: { aspectRatio: `${pg?.w || 1} / ${pg?.h || 1.41}` } });
      const t = h('button.thumb', { type: 'button', title: `Go to page ${i + 1}`, dataset: { i }, onclick: () => this.viewer.scrollToPage(i) }, box, h('span', String(i + 1)));
      this.thumbEls.push(t); this.thumbsEl.append(t); this.thumbIO.observe(t);
    }
  }
  async drawThumb(t) {
    const i = +t.dataset.i; const box = t.firstChild; const rev = this.doc.rev;
    try { const c = await renderToCanvas(this.doc.pdf, i, 0.28); if (rev !== this.doc.rev) return; c.setAttribute('aria-hidden', 'true'); box.replaceChildren(c); requestAnimationFrame(() => c.classList.add('in')); } catch {}
  }

  /* ------------------------------------------------------------ find */
  buildFind() {
    const inp = h('input.input', { type: 'search', placeholder: 'Find in document', 'aria-label': 'Find in document', onkeydown: e => { if (e.key === 'Enter') { e.shiftKey ? this.findStep(-1) : (inp.dataset.last === inp.value ? this.findStep(1) : this.runFind(inp.value)); inp.dataset.last = inp.value; } } });
    this.findCount = h('div.hint', 'Type a word and press Enter.');
    this.findList = h('div.find-list');
    this.findEl.append(h('div.find-bar', inp, button({ icon: 'chev-up', kind: 'ghost', title: 'Previous match', onClick: () => this.findStep(-1) }), button({ icon: 'chev-down', kind: 'ghost', title: 'Next match', onClick: () => this.findStep(1) })), this.findCount, this.findList);
  }
  async runFind(q) {
    q = q.trim(); this.clearFind(); this.find.q = q; if (!q) { this.findCount.textContent = 'Type a word and press Enter.'; return; }
    this.findCount.textContent = 'Searching…';
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); const hits = [];
    for (let i = 0; i < this.doc.numPages; i++) {
      const segs = await this.viewer.segmentsFor(i);
      for (const s of segs) {
        for (const m of s.text.matchAll(re)) {
          const L = s.text.length; hits.push({ page: i, x: s.x + (m.index / L) * s.w, y: s.top, w: Math.max(4, (m[0].length / L) * s.w), h: s.h, text: s.text, at: m.index });
        }
      }
    }
    this.find.hits = hits;
    this.findCount.textContent = hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'No matches found.';
    for (const hit of hits) { const info = this.viewer.pages[hit.page]; hit.el = h('div.hit-mark', { style: { left: hit.x + 'px', top: hit.y + 'px', width: hit.w + 'px', height: hit.h + 'px' } }); info.searchEl.append(hit.el); }
    hits.slice(0, 200).forEach((hit, k) => {
      const t = hit.text, a = Math.max(0, hit.at - 18);
      this.findList.append(h('button.find-item', { type: 'button', onclick: () => this.findGo(k) }, h('b', `p.${hit.page + 1}`), ' ', (a > 0 ? '…' : '') + t.slice(a, hit.at + q.length + 28)));
    });
    if (hits.length) this.findGo(0);
  }
  clearFind() { this.find.hits.forEach(x => x.el?.remove()); this.find = { hits: [], idx: -1, q: '' }; this.findList.replaceChildren(); }
  findStep(d) { const n = this.find.hits.length; if (!n) return; this.findGo((this.find.idx + d + n) % n); }
  findGo(k) {
    const hs = this.find.hits; if (!hs.length) return;
    hs.forEach(x => x.el.classList.remove('active')); const hit = hs[k]; this.find.idx = k; hit.el.classList.add('active');
    this.viewer.scrollToRect(hit.page, hit.y, hit.h);
  }

  /* ------------------------------------------------------------ forms */
  async buildForms() {
    const el = this.formsEl; el.replaceChildren(h('div.hint', 'Reading form…'));
    const fields = await this.doc.getFormFields();
    el.replaceChildren();
    if (!fields.length) { el.append(h('div.empty-mini', icon('form', 28), h('p', 'This PDF has no fillable form fields.'), h('p.hint', 'Use “Add text” to type anywhere on the page.'))); return; }
    el.append(h('div.hint', 'Fill the fields below. Values are written into the PDF when you download it.'));
    for (const f of fields) {
      const cur = this.doc.formValues[f.name] ?? f.value;
      let ctl;
      if (f.type === 'CheckBox') ctl = h('input', { type: 'checkbox', checked: !!cur, onchange: e => { this.doc.formValues[f.name] = e.target.checked; this.doc.dirty = true; } });
      else if (f.options) ctl = select([['', '—'], ...f.options], cur, v => { this.doc.formValues[f.name] = v; this.doc.dirty = true; });
      else ctl = h('input.input', { type: 'text', value: cur, oninput: e => { this.doc.formValues[f.name] = e.target.value; this.doc.dirty = true; } });
      el.append(field(f.name, ctl));
    }
    el.append(h('label.check', h('input', { type: 'checkbox', onchange: e => { this.doc.flattenForm = e.target.checked; } }), ' Make filled fields permanent (flatten)'),
      h('p.hint', 'Field values are saved in the PDF but may not appear in the page preview until you download and reopen the file.'));
  }

  /* ------------------------------------------------------------ right rail + panels */
  buildRail() {
    for (const [id, ic, label] of RAIL) {
      const b = button({ icon: ic, kind: 'ghost', title: label, cls: 'rail-btn' });
      b.dataset.id = id; b.addEventListener('click', () => id === 'organize' ? this.openOrganize() : this.openPanel(id));
      this.railEl.append(b);
    }
  }
  async openPanel(id) {
    if (this.panel === id) return this.closePanel();
    this.closePanel();
    this.panel = id; this.rightEl.hidden = false; this.rightEl.replaceChildren(h('div.panel-loading', 'Loading…'));
    this.railEl.querySelectorAll('.rail-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    const loaders = { export: () => import('./convert.js'), ocr: () => import('./ocr.js'), signatures: () => import('./signatures.js'), verify: () => import('./verify.js'), tools: () => import('./pagetools.js'), sign: () => import('./sign.js') };
    try {
      const mod = await loaders[id]();
      if (this.panel !== id) return;
      this.rightEl.replaceChildren();
      this.panelApi = await mod.mountPanel(this, this.rightEl) || {};
    } catch (e) { console.error(e); this.rightEl.replaceChildren(h('div.panel-loading', 'Could not load this panel: ' + e.message)); }
  }
  closePanel() {
    this.panelApi?.destroy?.(); this.panelApi = null; this.panel = null; this.rightEl.hidden = true; this.rightEl.replaceChildren();
    this.railEl.querySelectorAll('.rail-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
  }
  panelHeader(title, subtitle) {
    return h('div.panel-h', h('div', h('h2', title), subtitle ? h('p', subtitle) : null), button({ icon: 'close', kind: 'ghost', title: 'Close panel', onClick: () => this.closePanel() }));
  }

  async openOrganize() {
    this.closePanel(); this.annots.setTool('select');
    const m = await import('./organize.js');
    m.openOrganize(this);
  }

  /* ------------------------------------------------------------ output */
  async download({ asNew } = {}) {
    const bytes = await withProgress('Preparing your PDF', async p => this.doc.bake({ onProgress: (f, t) => p.update(f, t) }));
    if (!bytes) return;
    const name = (this.doc.hasEdits() || this.doc.dirty ? baseName(this.doc.name) + '-edited' : baseName(this.doc.name)) + '.pdf';
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), name);
    this.doc.dirty = false; toast(`Saved ${name}`, 'success');
  }

  /** Prints the document exactly as it would be saved (edits, signatures and stamps included). */
  async print() {
    const bytes = await withProgress('Preparing to print', async p => this.doc.bake({ onProgress: (f, t) => p.update(f, t) }));
    if (!bytes) return;
    printBlob(new Blob([bytes], { type: 'application/pdf' }));
    toast('Opening the print dialog…', 'info', 2500);
  }

  /* ------------------------------------------------------------ keyboard */
  onKey(e) {
    const t = e.target; const typing = t.matches?.('input, textarea, select') || t.isContentEditable;
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.doc.redo() : this.doc.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.doc.redo(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.download(); }
    else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); this.print(); }
    else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); this.showLeft('find'); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.annots.duplicateSelected(); }
    else if (mod && e.key.toLowerCase() === 'c' && this.annots.selected) { this.annots.copy(); }
    else if (mod && e.key.toLowerCase() === 'v' && this.annots.clip) { e.preventDefault(); this.annots.paste(); }
    else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.viewer.setZoom(this.viewer.zoom * 1.15); }
    else if (mod && e.key === '-') { e.preventDefault(); this.viewer.setZoom(this.viewer.zoom / 1.15); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.annots.selected) { e.preventDefault(); this.annots.deleteSelected(); } }
    else if (e.key === 'Escape') { if (this.annots.tool !== 'select') this.setTool('select'); else this.annots.select(null); }
    else if (e.key.startsWith('Arrow') && this.annots.selected) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; this.annots.nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0); }
    else if (!mod && !e.altKey && e.key.length === 1) {
      const k = e.key.toUpperCase();
      for (const { it } of Object.values(this.btns)) if (it.key === k && it.tool) { if (it.edit && !this.editable) return; this.setTool(it.tool); }
    }
  }

  destroy() { this.panelApi?.destroy?.(); this.viewer.destroy(); this.thumbIO?.disconnect(); this.doc.destroy(); }
}
