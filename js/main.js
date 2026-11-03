// App shell: tabs, views, opening files, drag & drop, install button.
import { h, $, icon, button, toast, pickFiles, readBytes, confirmDialog, withProgress, nextFrame } from './ui.js';
import { PdfDoc } from './doc.js';
import { DocView } from './docview.js';
import { renderHome, renderTools, TOOL_CARDS } from './home.js';
import { APP_NAME } from './config.js';
import { registerSW, installButton } from './pwa.js';

const isPdfBytes = b => b.length > 5 && String.fromCharCode(...b.subarray(0, 1024).slice(0, 1024)).includes('%PDF-');

export const app = {
  docs: [], views: new Map(), tabs: [{ id: 'home', kind: 'home', title: 'Home', icon: 'home' }, { id: 'tools', kind: 'tools', title: 'Tools', icon: 'tools' }],
  active: 'home',

  get activeView() { return this.views.get(this.active); },
  get activeDoc() { return this.docs.find(d => d.id === this.active); },

  async openDialog() {
    const files = await pickFiles({ accept: 'application/pdf,.pdf,image/*,.docx,.txt,.md,.csv,.xlsx', multiple: true });
    for (const f of files) await this.openFile(f);
  },

  async openFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let bytes, name = file.name;
    try {
      bytes = await readBytes(file);
      if (!(file.type === 'application/pdf' || ext === 'pdf' || isPdfBytes(bytes))) {
        const { fileToPdf } = await import('./create.js');
        const out = await withProgress('Converting to PDF', async () => fileToPdf(file, bytes));
        if (!out) return; bytes = out; name = name.replace(/\.[^.]+$/, '') + '.pdf';
      }
    } catch (e) { return toast(`Could not read “${file.name}”: ${e.message}`, 'error', 7000); }
    return this.openBytes(name, bytes);
  },

  async openBytes(name, bytes) {
    let doc;
    try {
      doc = await withProgress('Opening ' + name, async () => PdfDoc.open(name, bytes));
    } catch (e) { console.error(e); if (!/cancelled/i.test(e.message)) toast(`“${name}” could not be opened: ${e.message}`, 'error', 8000); return; }
    if (!doc) return;
    return this.addDoc(doc);
  },

  async addDoc(doc) {
    const dv = new DocView(doc, this);
    const view = h('section.view.view-doc', { dataset: { id: doc.id } }, dv.root);
    $('#views').append(view);
    this.docs.push(doc); this.views.set(doc.id, { el: view, dv });
    this.tabs.push({ id: doc.id, kind: 'doc', title: doc.name, icon: 'pdf' });
    this.activate(doc.id);
    await nextFrame();
    await dv.init();
    doc.addEventListener('structure', () => this.renderTabs());
    return dv;
  },

  /** Shows a stand-alone tool screen (combine / create) in its own tab. */
  async ensureToolTab(id) {
    if (this.views.has(id)) return;
    const titles = { combine: ['Combine files', 'merge'], create: ['Create a PDF', 'file-plus'] };
    const el = h('section.view.view-tool', { dataset: { id } });
    $('#views').append(el);
    this.views.set(id, { el });
    this.tabs.push({ id, kind: id, title: titles[id][0], icon: titles[id][1] });
    const mod = await import(id === 'combine' ? './combine.js' : './create.js');
    mod.mount(el, this);
  },

  async activate(id) {
    if (id === 'combine' || id === 'create') await this.ensureToolTab(id);
    if (!this.views.has(id) && id !== 'home' && id !== 'tools') return;
    this.active = id;
    if (id === 'home') renderHome($('#view-home'), this);
    if (id === 'tools') renderTools($('#view-tools'), this);
    const all = { home: { el: $('#view-home') }, tools: { el: $('#view-tools') } };
    for (const [k, v] of [...Object.entries(all), ...this.views]) {
      const on = k === id; const el = v.el;
      if (on) { el.hidden = false; el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
      else { el.hidden = true; el.classList.remove('enter'); }
    }
    this.renderTabs();
    const dv = this.views.get(id)?.dv; document.title = dv ? `${dv.doc.name} — ${APP_NAME}` : APP_NAME;
    if (dv) { requestAnimationFrame(() => dv.viewer?.applyFit()); dv.scrollEl.focus({ preventScroll: true }); }
  },

  async closeTab(id) {
    const doc = this.docs.find(d => d.id === id);
    if (doc && (doc.hasEdits() || doc.dirty)) {
      const ok = await confirmDialog({ title: 'Close without saving?', message: `“${doc.name}” has changes that haven’t been downloaded. Closing will discard them.`, confirmLabel: 'Discard changes', danger: true });
      if (!ok) return;
    }
    const v = this.views.get(id);
    if (v) { v.dv?.destroy(); v.el.classList.add('leaving'); setTimeout(() => v.el.remove(), 180); this.views.delete(id); }
    this.docs = this.docs.filter(d => d.id !== id);
    const idx = this.tabs.findIndex(t => t.id === id); this.tabs.splice(idx, 1);
    if (this.active === id) this.activate(this.tabs[Math.max(0, idx - 1)].id); else this.renderTabs();
  },

  renderTabs() {
    const bar = $('#tabs'); bar.replaceChildren();
    this.tabs.forEach(t => {
      const doc = this.docs.find(d => d.id === t.id);
      const tab = h('div.tab' + (t.id === this.active ? '.active' : ''), { role: 'presentation' },
        h('button.tab-main', { type: 'button', role: 'tab', 'aria-selected': String(t.id === this.active), title: doc ? doc.name : t.title, onclick: () => this.activate(t.id) },
          icon(t.icon, 18), h('span.tab-title', doc ? doc.name : t.title), doc && (doc.hasEdits() || doc.dirty) ? h('i.dot', { title: 'Unsaved changes' }) : null),
        t.kind !== 'home' && t.kind !== 'tools' ? button({ icon: 'close', kind: 'ghost', size: 'sm', title: `Close ${t.title}`, onClick: () => this.closeTab(t.id) }) : null);
      bar.append(tab);
    });
    const dvActive = this.activeDoc;
    $('#btn-download').hidden = !dvActive; $('#btn-print').hidden = !dvActive;
  },

  /** Run a tool card: opens the screen, or the tool on the active document (asking for a file if needed). */
  async runTool(t) {
    if (t.view) return this.activate(t.view);
    let doc = this.activeDoc;
    if (!doc) {
      toast('Choose a PDF to use this tool.', 'info', 2500);
      const files = await pickFiles({ accept: 'application/pdf,.pdf', multiple: false });
      if (!files[0]) return;
      await this.openFile(files[0]); doc = this.activeDoc; if (!doc) return;
    }
    const dv = this.views.get(doc.id).dv;
    await dv.ready;
    t.run(dv);
  },
};

/* ------------------------------------------------------------------ boot */
function boot() {
  $('#btn-open').replaceChildren(icon('folder-open', 18), h('span', 'Open'));
  $('#btn-open').addEventListener('click', () => app.openDialog());
  $('#btn-print').replaceChildren(icon('printer', 18), h('span', 'Print'));
  $('#btn-print').title = 'Print this document (Ctrl+P)';
  $('#btn-print').addEventListener('click', () => app.views.get(app.active)?.dv?.print());
  $('#btn-download').replaceChildren(icon('download', 18), h('span', 'Download PDF'));
  $('#btn-download').addEventListener('click', () => app.views.get(app.active)?.dv?.download());
  $('#top-install').append(installButton({ label: 'Install', kind: 'ghost' }));
  $('#brand-name').textContent = APP_NAME;
  app.renderTabs(); app.activate('home');

  // Drag & drop
  const overlay = $('#drop-overlay'); let depth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { depth++; overlay.classList.add('on'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('on'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; overlay.classList.remove('on');
    const files = [...(e.dataTransfer?.files || [])];
    const api = app.views.get(app.active)?.api;
    if (api?.addFiles) return api.addFiles(files);
    for (const f of files) await app.openFile(f);
  });

  window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); app.openDialog(); } });
  window.addEventListener('beforeunload', e => { if (app.docs.some(d => d.hasEdits() || d.dirty)) { e.preventDefault(); e.returnValue = ''; } });

  // Installed app: "Open with" / double-click a PDF
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
      for (const fh of params.files || []) { try { await app.openFile(await fh.getFile()); } catch (e) { console.warn(e); } }
    });
  }
  registerSW();
}
boot();
window.__app = app; // handy for debugging and automated tests
