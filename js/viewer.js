// Continuous-scroll page viewer: canvas + text layer + overlay layers (search, edit-text boxes, annotations).
import { pdfjsLib, getPageText } from './pdfio.js';
import { h, clamp } from './ui.js';
import { fitSegment, splitAtRules } from './segfit.js';

const MAX_CANVAS_PX = 16e6;

export class Viewer extends EventTarget {
  constructor(doc, scrollEl) {
    super();
    this.doc = doc; this.scroll = scrollEl;
    this.pagesEl = h('div.pages'); scrollEl.append(this.pagesEl);
    this.zoom = 1; this.fitMode = 'width';
    this.pages = []; // {i, w, h, el, canvas, textEl, hitEl, searchEl, annotEl, zoomRendered, task, visible}
    this.current = 0;
    this.io = new IntersectionObserver(es => this.onIntersect(es), { root: scrollEl, rootMargin: '800px 0px' });
    this.cur = new IntersectionObserver(es => this.onCenter(es), { root: scrollEl, rootMargin: '-45% 0px -45% 0px' });
    this.ro = new ResizeObserver(() => { if (this.fitMode !== 'custom') this.applyFit(); });
    this.ro.observe(scrollEl);
    this.hitMode = false;
    scrollEl.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });
  }

  async build() {
    const { doc } = this;
    this.pagesEl.replaceChildren(); this.pages = [];
    const sizes = [];
    for (let i = 0; i < doc.numPages; i += 40) {
      const batch = await Promise.all(Array.from({ length: Math.min(40, doc.numPages - i) }, async (_, k) => {
        const p = await doc.pdf.getPage(i + k + 1); const vp = p.getViewport({ scale: 1 });
        return [vp.width, vp.height];
      }));
      sizes.push(...batch);
    }
    sizes.forEach(([w, hh], i) => this.addShell(i, w, hh));
    this.applyFit(true);
    this.dispatchEvent(new CustomEvent('built'));
  }

  addShell(i, w, hh) {
    const mk = c => h('div.pts.' + c, { style: { width: w + 'px', height: hh + 'px' } });
    const canvas = h('canvas');
    const textEl = h('div.textLayer');
    const searchEl = mk('search-layer'), hitEl = mk('hit-layer'), annotEl = mk('annot-layer'), sigEl = mk('sig-layer');
    const el = h('div.page', { dataset: { page: i }, role: 'region', 'aria-label': `Page ${i + 1}` }, canvas, textEl, searchEl, hitEl, annotEl, sigEl);
    const info = { i, w, h: hh, el, canvas, textEl, hitEl, searchEl, annotEl, sigEl, zoomRendered: 0, task: null, visible: false };
    this.pages[i] = info; this.pagesEl.append(el);
    this.io.observe(el); this.cur.observe(el);
    return info;
  }

  get fitWidthZoom() {
    const maxW = Math.max(...this.pages.map(p => p.w));
    return clamp((this.scroll.clientWidth - 48) / maxW, 0.1, 5);
  }
  get fitPageZoom() {
    const p = this.pages[this.current] || this.pages[0]; if (!p) return 1;
    return clamp(Math.min((this.scroll.clientWidth - 48) / p.w, (this.scroll.clientHeight - 32) / p.h), 0.1, 5);
  }
  applyFit(force) {
    if (!this.pages.length) return;
    if (this.fitMode === 'width') this.setZoom(this.fitWidthZoom, { keepFit: true, force });
    else if (this.fitMode === 'page') this.setZoom(this.fitPageZoom, { keepFit: true, force });
  }

  setZoom(z, { keepFit = false, force = false } = {}) {
    z = clamp(z, 0.1, 6);
    if (!keepFit) this.fitMode = 'custom';
    if (Math.abs(z - this.zoom) < 0.0005 && !force) return;
    const ratio = this.scroll.scrollHeight > 0 ? this.scroll.scrollTop / this.scroll.scrollHeight : 0;
    this.zoom = z;
    for (const p of this.pages) {
      p.el.style.width = p.w * z + 'px'; p.el.style.height = p.h * z + 'px';
      for (const l of [p.searchEl, p.hitEl, p.annotEl, p.sigEl]) l.style.transform = `scale(${z})`;
      p.textEl.style.setProperty('--total-scale-factor', z);
    }
    this.scroll.scrollTop = ratio * this.scroll.scrollHeight;
    clearTimeout(this._zt); this._zt = setTimeout(() => this.pages.forEach(p => p.visible && this.render(p.i)), 90);
    this.dispatchEvent(new CustomEvent('zoom', { detail: z }));
  }
  setFit(mode) { this.fitMode = mode; this.applyFit(true); this.dispatchEvent(new CustomEvent('zoom', { detail: this.zoom })); }

  onIntersect(entries) {
    for (const e of entries) {
      const i = +e.target.dataset.page, p = this.pages[i]; if (!p) continue;
      p.visible = e.isIntersecting;
      if (e.isIntersecting) this.render(i);
      else this.scheduleRelease(i);
    }
  }
  onCenter(entries) {
    for (const e of entries) if (e.isIntersecting) { const i = +e.target.dataset.page; if (i !== this.current) { this.current = i; this.dispatchEvent(new CustomEvent('page', { detail: i })); } }
  }
  scheduleRelease(i) {
    const p = this.pages[i];
    clearTimeout(p._rel);
    p._rel = setTimeout(() => { if (!p.visible && Math.abs(i - this.current) > 4) this.release(i); }, 2500);
  }
  release(i) {
    const p = this.pages[i]; if (!p || !p.zoomRendered) return;
    try { p.task && p.task.cancel(); } catch {}
    p.canvas.width = p.canvas.height = 0; p.textEl.replaceChildren(); p.zoomRendered = 0;
  }

  async render(i) {
    const p = this.pages[i]; if (!p) return;
    const z = this.zoom;
    if (p.zoomRendered === z && p.rev === this.doc.rev) return;
    const token = (p.token = (p.token || 0) + 1);
    try { p.task && p.task.cancel(); } catch {}
    let page;
    try { page = await this.doc.pdf.getPage(i + 1); } catch { return; }
    if (token !== p.token) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let scale = z * dpr;
    if (p.w * p.h * scale * scale > MAX_CANVAS_PX) scale = Math.sqrt(MAX_CANVAS_PX / (p.w * p.h));
    const vp = page.getViewport({ scale });
    const off = document.createElement('canvas'); off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
    const ctx = off.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, off.width, off.height);
    const task = page.render({ canvasContext: ctx, canvas: off, viewport: vp });
    p.task = task;
    try { await task.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn('render', i, e); return; }
    if (token !== p.token) return;
    p.canvas.width = off.width; p.canvas.height = off.height;
    p.canvas.getContext('2d', { willReadFrequently: true }).drawImage(off, 0, 0);
    p.zoomRendered = z; p.rev = this.doc.rev;
    await this.renderTextLayer(i, page);
    if (this.hitMode) this.buildHitLayer(i);
    this.dispatchEvent(new CustomEvent('rendered', { detail: i }));
  }

  async renderTextLayer(i, page) {
    const p = this.pages[i];
    p.textEl.replaceChildren();
    p.textEl.style.setProperty('--total-scale-factor', this.zoom);
    p.textEl.style.width = p.w * this.zoom + 'px'; p.textEl.style.height = p.h * this.zoom + 'px';
    const ocr = this.doc.pages[i]?.ocr;
    if (ocr && ocr.words?.length) { this.renderOcrText(p, ocr); return; }
    try {
      const tl = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: p.textEl, viewport: page.getViewport({ scale: this.zoom }) });
      await tl.render();
    } catch (e) { console.warn('text layer', e); }
  }
  renderOcrText(p, ocr) {
    const z = this.zoom; const cx = document.createElement('canvas').getContext('2d');
    for (const w of ocr.words) {
      if (!w.text.trim()) continue;
      const fs = Math.max(4, w.h * 0.85) * z;
      cx.font = `${fs}px sans-serif`;
      const nat = cx.measureText(w.text).width || 1;
      const s = h('span', { style: { left: w.x * z + 'px', top: w.y * z + 'px', fontSize: fs + 'px', transform: `scaleX(${(w.w * z) / nat})`, lineHeight: w.h * z + 'px', transformOrigin: '0 0' } }, w.text);
      p.textEl.append(s);
    }
    p.textEl.classList.add('ocr');
  }

  /* ----- edit-text hit boxes ----- */
  async setHitMode(on) {
    this.hitMode = on;
    this.pagesEl.classList.toggle('hit-mode', on);
    for (const p of this.pages) { p.hitEl.replaceChildren(); if (on && p.zoomRendered) this.buildHitLayer(p.i); }
  }
  async segmentsFor(i) {
    const ocr = this.doc.pages[i]?.ocr;
    if (ocr?.lines?.length) return ocr.lines.map(l => ({ text: l.text, x: l.x, top: l.y, w: l.w, h: l.h, fs: l.h * 0.85, baseline: l.y + l.h * 0.8, family: 'sans-serif', fontName: null, ocr: true }));
    const raw = (await getPageText(this.doc.pdf, i)).segments, p = this.pages[i];
    if (p?.splitFor?.raw === raw && p.splitFor.z === p.zoomRendered) return p.splitFor.segs; // reuse until the page is re-rendered
    const segs = p?.canvas?.width ? splitAtRules(p, raw) : raw;
    if (p) p.splitFor = { raw, z: p.zoomRendered, segs };
    return segs;
  }
  async buildHitLayer(i) {
    const p = this.pages[i]; p.hitEl.replaceChildren();
    const segs = await this.segmentsFor(i);
    if (!this.hitMode) return;
    segs.forEach(s => {
      const w = s.ocr ? s.w : fitSegment(p, s).w;
      const b = h('div.hit', { style: { left: s.x - 2 + 'px', top: s.top + 'px', width: w + 4 + 'px', height: s.h + 'px' }, title: 'Click to edit this text' });
      b.addEventListener('click', e => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('edit-segment', { detail: { page: i, seg: s } })); });
      p.hitEl.append(b);
    });
  }

  invalidate(i) { const p = this.pages[i]; if (!p) return; p.zoomRendered = 0; if (p.visible) this.render(i); }

  /* ----- helpers ----- */
  scrollToPage(i, smooth = false) {
    const p = this.pages[clamp(i, 0, this.pages.length - 1)]; if (!p) return;
    this.scroll.scrollTo({ top: p.el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
  }
  scrollToRect(i, y, hh) {
    const p = this.pages[i]; if (!p) return;
    this.scroll.scrollTo({ top: p.el.offsetTop + (y - 80) * this.zoom, behavior: 'smooth' });
  }
  ptFromEvent(e, i) {
    const r = this.pages[i].el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
  }
  pageIndexAt(e) {
    const el = e.target.closest?.('.page'); return el ? +el.dataset.page : -1;
  }
  /** Re-render all pages (after the file bytes change). */
  async refresh() {
    this.doc.rev; await this.build();
  }
  destroy() { this.io.disconnect(); this.cur.disconnect(); this.ro.disconnect(); }
}
