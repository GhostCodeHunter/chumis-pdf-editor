// Annotation editing on top of the viewer: create, select, move, resize, edit text, mark up, undo.
import { h, uid, clamp, toast, pickFiles, readBytes } from './ui.js';
import { BASELINE, CSS_FONT, LINE_HEIGHT } from './bake.js';
import { getFontInfo } from './pdfio.js';
import { isCustom, cssFamilyFor, ensureFont, isLoaded, probeBase } from './fonts.js';
import { sampleColors, fitSegment, chooseFamily, detectKeep } from './segfit.js';
export { sampleColors };

export const TOOL_GROUPS = {
  text: 'text', textedit: 'text', rect: 'shape', ellipse: 'shape', line: 'shape', arrow: 'shape', ink: 'pen',
  highlight: 'markup', underline: 'markup', strike: 'markup', whiteout: 'fill', redact: 'none', image: 'image', note: 'note', mark: 'mark',
};
const DRAW_TOOLS = new Set(['text', 'rect', 'ellipse', 'line', 'arrow', 'pen', 'highlighter', 'whiteout', 'redact', 'place', 'check', 'cross', 'dot', 'note']);
const MARKUP_TOOLS = new Set(['highlight', 'underline', 'strike']);
const ONE_SHOT = new Set(['text', 'rect', 'ellipse', 'line', 'arrow', 'place', 'check', 'cross', 'dot', 'note']);

const copyJson = o => JSON.parse(JSON.stringify(o));

export class Annots extends EventTarget {
  constructor(dv) {
    super();
    this.dv = dv; this.doc = dv.doc; this.viewer = dv.viewer;
    this.tool = 'select'; this.sel = null; this.editing = null; this.pending = null; this.clip = null;
    this.defaults = {
      text: { font: 'helv', gname: null, size: 14, bold: false, italic: false, color: '#000000', align: 'left', bg: null },
      textedit: { font: 'helv', gname: null, size: 12, bold: false, italic: false, color: '#000000' },
      shape: { stroke: '#d31510', fill: null, sw: 2, opacity: 1 },
      pen: { stroke: '#1473e6', sw: 2.5, opacity: 1 },
      highlighter: { stroke: '#ffe14d', sw: 14, opacity: 0.45 },
      highlight: { color: '#ffe14d', opacity: 0.5 }, underline: { color: '#d31510', opacity: 1 }, strike: { color: '#d31510', opacity: 1 },
      fill: { color: '#ffffff' }, note: { color: '#ffd54a' }, mark: { color: '#111111' }, image: { opacity: 1 },
    };
    const root = this.viewer.pagesEl;
    root.addEventListener('pointerdown', e => this.onPointerDown(e));
    root.addEventListener('dblclick', e => this.onDblClick(e));
    root.addEventListener('mouseup', e => this.onMouseUp(e));
    this.viewer.addEventListener('edit-segment', e => this.editSegment(e.detail.page, e.detail.seg));
    this.viewer.addEventListener('rendered', e => this.renderPage(e.detail));
    this.viewer.addEventListener('built', () => this.renderAll());
    this.doc.addEventListener('annots', () => { this.sel = null; this.renderAll(); this.emitSel(); });
  }

  get zoom() { return this.viewer.zoom; }
  emitSel() { this.dispatchEvent(new CustomEvent('selection')); }

  /* ------------------------------------------------------------ tools */
  setTool(t) {
    this.endEdit(true);
    this.tool = t;
    const root = this.viewer.pagesEl;
    root.dataset.tool = t;
    root.classList.toggle('draw-mode', DRAW_TOOLS.has(t));
    root.classList.toggle('markup-mode', MARKUP_TOOLS.has(t));
    this.viewer.setHitMode(t === 'edittext');
    if (t !== 'select') this.select(null);
    this.dispatchEvent(new CustomEvent('tool'));
  }
  revert() { if (this.tool !== 'select') this.dv.setTool('select'); }

  /** Image / signature waiting to be placed with the next click. */
  setPending(p) { this.pending = p; this.dv.setTool('place'); toast('Click on the page where you want to place it.', 'info', 3000); }
  async chooseImage() {
    const [file] = await pickFiles({ accept: 'image/*', multiple: false }); if (!file) return;
    const { bytes, mime, w, h: hh } = await normalizeImage(file);
    const assetId = this.doc.addAsset(bytes, mime);
    this.setPending({ assetId, w, h: hh, kind: 'image' });
  }

  /* ------------------------------------------------------------ rendering */
  renderAll() { this.viewer.pages.forEach(p => this.renderPage(p.i)); }
  renderPage(i) {
    const info = this.viewer.pages[i]; if (!info) return;
    const layer = info.annotEl;
    const keepEdit = this.editing && this.editing.page === i;
    for (const el of [...layer.children]) { if (keepEdit && el === this.editing.el) continue; el.remove(); }
    for (const a of this.doc.pages[i].annots) {
      if (keepEdit && this.editing.a === a) continue;
      layer.append(this.makeEl(a, i));
    }
    this.paintSelection();
  }
  findEl(a, i) { return this.viewer.pages[i]?.annotEl.querySelector(`[data-id="${a.id}"]`); }
  repaint(a, i) {
    const old = this.findEl(a, i); const el = this.makeEl(a, i);
    if (old) old.replaceWith(el); else this.viewer.pages[i].annotEl.append(el);
    if (this.sel && this.sel.id === a.id) this.paintSelection();
    return el;
  }

  makeEl(a, i) {
    const el = h('div.annot.a-' + a.type, { dataset: { id: a.id, page: i } });
    const S = el.style;
    const op = a.opacity ?? 1;
    const px = n => n + 'px';
    switch (a.type) {
      case 'text': case 'textedit': {
        S.left = px(a.x); S.top = px(a.y);
        S.fontFamily = cssFamilyFor(a); S.fontSize = px(a.size); S.lineHeight = LINE_HEIGHT; S.fontKerning = 'none'; S.fontVariantLigatures = 'none'; S.fontSynthesis = isCustom(a.font) ? 'none' : 'weight style';
        S.fontWeight = a.bold ? '700' : '400'; S.fontStyle = a.italic ? 'italic' : 'normal'; S.color = a.color; S.opacity = op;
        if (a.type === 'text') { S.width = px(a.w); S.textAlign = a.align || 'left'; if (a.bg) S.background = a.bg; }
        else {
          S.minWidth = px(a.coverW); S.height = px(a.h);
          const keep = a.keep || [];
          S.background = [...keep.map(k => `linear-gradient(${k.c},${k.c}) ${k.x - a.x}px ${k.y - a.y}px / ${k.w}px ${k.h}px no-repeat`), a.bg || '#fff'].join(',');
          S.boxShadow = keep.length ? 'none' : `0 0 0 1px ${a.bg || '#fff'}`;
        }
        el.textContent = a.text;
        if (isCustom(a.font) && !isLoaded(a)) ensureFont(a).then(r => { if (r) this.fontReady(a); });
        break;
      }
      case 'image': {
        Object.assign(S, { left: px(a.x), top: px(a.y), width: px(a.w), height: px(a.h), opacity: op });
        el.append(h('img', { src: this.doc.assets.get(a.assetId)?.url || '', draggable: false, alt: '' }));
        break;
      }
      case 'rect': case 'ellipse': case 'whiteout': case 'redact': {
        Object.assign(S, { left: px(a.x), top: px(a.y), width: px(a.w), height: px(a.h) });
        if (a.type === 'rect' || a.type === 'ellipse') {
          S.opacity = op; if (a.fill) S.background = a.fill;
          if (a.stroke) S.border = `${a.sw}px solid ${a.stroke}`;
          if (a.type === 'ellipse') S.borderRadius = '50%';
          S.boxSizing = 'border-box';
        } else if (a.type === 'whiteout') S.background = a.color || '#fff';
        break;
      }
      case 'line': case 'arrow': case 'ink': {
        const [bx, by, bw, bh] = this.bbox(a); const pad = (a.sw || 2) * 2 + 6;
        Object.assign(S, { left: px(bx - pad), top: px(by - pad), width: px(bw + pad * 2), height: px(bh + pad * 2), opacity: op });
        const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', bw + pad * 2); svg.setAttribute('height', bh + pad * 2); svg.style.overflow = 'visible';
        const path = document.createElementNS(NS, 'path');
        const P = (x, y) => `${(x - bx + pad).toFixed(2)} ${(y - by + pad).toFixed(2)}`;
        let d;
        if (a.type === 'ink') d = 'M ' + a.points.map(p => P(p[0], p[1])).join(' L ') + (a.points.length === 1 ? ' l 0.01 0' : '');
        else {
          d = `M ${P(a.x1, a.y1)} L ${P(a.x2, a.y2)}`;
          if (a.type === 'arrow') {
            const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = Math.max(9, a.sw * 4.5);
            for (const s of [-1, 1]) d += ` M ${P(a.x2, a.y2)} L ${P(a.x2 - L * Math.cos(ang + s * 0.45), a.y2 - L * Math.sin(ang + s * 0.45))}`;
          }
        }
        path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', a.stroke);
        path.setAttribute('stroke-width', a.sw); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
        if (a.hl) path.style.mixBlendMode = 'multiply';
        const hit = path.cloneNode(); hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', Math.max(a.sw, 12)); hit.style.pointerEvents = 'stroke'; svg.append(hit, path); el.append(svg); el.style.pointerEvents = 'none'; svg.style.pointerEvents = 'none'; path.style.pointerEvents = 'stroke'; path.style.strokeLinecap = 'round';
        el.classList.add('vector');
        break;
      }
      case 'highlight': case 'underline': case 'strike': {
        S.left = '0'; S.top = '0'; S.width = '0'; S.height = '0'; S.opacity = op;
        for (const [x, y, w, hh] of a.rects) {
          const r = h('i', { style: { left: px(x), top: px(y), width: px(w), height: px(hh) } });
          if (a.type === 'highlight') { r.style.background = a.color; r.style.mixBlendMode = 'multiply'; }
          else { const t = Math.max(0.8, hh * 0.07); r.style.borderBottom = `${t}px solid ${a.color}`; r.style.height = a.type === 'underline' ? px(hh * 0.9) : px(hh * 0.55); r.style.boxSizing = 'content-box'; }
          el.append(r);
        }
        break;
      }
      case 'note': {
        Object.assign(S, { left: px(a.x), top: px(a.y), width: '18px', height: '18px', background: a.color || '#ffd54a' });
        el.title = a.text || 'Empty note';
        break;
      }
      case 'mark': {
        Object.assign(S, { left: px(a.x), top: px(a.y), width: px(a.w), height: px(a.h) });
        const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('width', a.w); svg.setAttribute('height', a.h);
        const t = Math.max(1, Math.min(a.w, a.h) * 0.12) / Math.min(a.w, a.h);
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', a.kind === 'check' ? 'M .12 .55 L .38 .88 L .9 .12' : a.kind === 'cross' ? 'M .15 .15 L .85 .85 M .85 .15 L .15 .85' : 'M .5 .5 l .001 0');
        p.setAttribute('stroke', a.color); p.setAttribute('stroke-width', a.kind === 'dot' ? 0.45 : t); p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
        svg.append(p); el.append(svg);
        break;
      }
    }
    if (this.sel && this.sel.id === a.id) el.classList.add('selected');
    return el;
  }

  /** Bounding box [x, y, w, h] in points. */
  bbox(a) {
    switch (a.type) {
      case 'line': case 'arrow': { const x = Math.min(a.x1, a.x2), y = Math.min(a.y1, a.y2); return [x, y, Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1)]; }
      case 'ink': { const xs = a.points.map(p => p[0]), ys = a.points.map(p => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return [x, y, Math.max(...xs) - x, Math.max(...ys) - y]; }
      case 'highlight': case 'underline': case 'strike': {
        const x = Math.min(...a.rects.map(r => r[0])), y = Math.min(...a.rects.map(r => r[1]));
        return [x, y, Math.max(...a.rects.map(r => r[0] + r[2])) - x, Math.max(...a.rects.map(r => r[1] + r[3])) - y];
      }
      case 'note': return [a.x, a.y, 18, 18];
      case 'text': return [a.x, a.y, a.w, a.h];
      case 'textedit': { const el = this.findEl(a, this.pageOf(a)); return [a.x, a.y, Math.max(a.coverW, el ? el.offsetWidth : 0), a.h]; }
      default: return [a.x, a.y, a.w, a.h];
    }
  }
  pageOf(a) { return this.doc.pages.findIndex(p => p.annots.includes(a)); }

  /* ------------------------------------------------------------ selection */
  get selected() { if (!this.sel) return null; const a = this.doc.pages[this.sel.page]?.annots.find(x => x.id === this.sel.id); return a ? { a, page: this.sel.page } : null; }
  select(a, page) {
    if (this.editing && !(a && this.editing.a === a)) this.endEdit(true);
    this.sel = a ? { id: a.id, page } : null;
    this.viewer.pages.forEach(p => p.annotEl.querySelectorAll('.annot.selected').forEach(e => e.classList.remove('selected')));
    if (a) this.findEl(a, page)?.classList.add('selected');
    this.paintSelection(); this.emitSel();
  }
  paintSelection() {
    this.viewer.pages.forEach(p => p.annotEl.querySelectorAll('.selbox').forEach(e => e.remove()));
    const s = this.selected; if (!s || this.editing) return;
    const { a, page } = s; const [x, y, w, hh] = this.bbox(a); const pad = a.type === 'ink' || a.type === 'line' || a.type === 'arrow' ? 4 : 0;
    const box = h('div.selbox', { style: { left: x - pad + 'px', top: y - pad + 'px', width: w + pad * 2 + 'px', height: hh + pad * 2 + 'px' } });
    const z = 1 / this.zoom;
    box.style.setProperty('--hs', 9 * z + 'px'); box.style.setProperty('--bw', Math.max(1, 1.5 * z) + 'px');
    const hs = [];
    if (a.type === 'line' || a.type === 'arrow') {
      const mk = (cls, px, py) => h('div.handle.' + cls, { dataset: { h: cls }, style: { left: px - (x - pad) + 'px', top: py - (y - pad) + 'px' } });
      box.append(mk('p1', a.x1, a.y1), mk('p2', a.x2, a.y2));
    } else if (a.type === 'text') hs.push('w', 'e');
    else if (['rect', 'ellipse', 'image', 'whiteout', 'redact', 'mark'].includes(a.type)) hs.push('nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w');
    hs.forEach(k => box.append(h('div.handle.' + k, { dataset: { h: k } })));
    this.viewer.pages[page].annotEl.append(box);
  }

  /* ------------------------------------------------------------ pointer handling */
  onPointerDown(e) {
    if (e.button !== 0) return;
    const pageEl = e.target.closest('.page'); if (!pageEl) return;
    const pi = +pageEl.dataset.page;
    const handle = e.target.closest('.handle');
    if (handle) { e.preventDefault(); return this.startResize(e, pi, handle.dataset.h); }
    const annEl = e.target.closest('.annot');
    const t = this.tool;
    if (t === 'select' || t === 'edittext' || MARKUP_TOOLS.has(t)) {
      if (annEl) {
        const a = this.doc.pages[pi].annots.find(x => x.id === annEl.dataset.id); if (!a) return;
        if (this.editing && this.editing.a === a) return;
        if (MARKUP_TOOLS.has(t)) return;
        if (t === 'edittext' && a.type !== 'textedit') return;
        this.select(a, pi);
        if (a.type !== 'textedit' || t !== 'edittext') { e.preventDefault(); this.startMove(e, pi, a); }
        else this.beginEdit(a, pi);
      } else if (!e.target.closest('.hit') && !MARKUP_TOOLS.has(t)) { if (this.sel) this.select(null); this.endEdit(true); }
      return;
    }
    if (!DRAW_TOOLS.has(t)) return;
    if (!e.target.closest('.annot-layer') && !annEl) return;
    e.preventDefault(); this.endEdit(true);
    this.startCreate(e, pi, t);
  }

  startCreate(e, pi, t) {
    const info = this.viewer.pages[pi]; const p0 = this.viewer.ptFromEvent(e, pi);
    const annots = this.doc.pages[pi].annots; const D = this.defaults;
    let a;
    const base = { id: uid() };
    if (t === 'text') { a = { ...base, type: 'text', x: p0.x, y: p0.y, w: 200, h: D.text.size * LINE_HEIGHT, text: this.presetText || '', ...D.text }; this.presetText = null; }
    else if (t === 'rect' || t === 'ellipse') a = { ...base, type: t, x: p0.x, y: p0.y, w: 0, h: 0, ...D.shape };
    else if (t === 'line' || t === 'arrow') a = { ...base, type: t, x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y, stroke: D.shape.stroke, sw: D.shape.sw, opacity: D.shape.opacity };
    else if (t === 'pen' || t === 'highlighter') { const d = t === 'pen' ? D.pen : D.highlighter; a = { ...base, type: 'ink', points: [[p0.x, p0.y]], stroke: d.stroke, sw: d.sw, opacity: d.opacity, hl: t === 'highlighter' }; }
    else if (t === 'whiteout') a = { ...base, type: 'whiteout', x: p0.x, y: p0.y, w: 0, h: 0, color: D.fill.color };
    else if (t === 'redact') a = { ...base, type: 'redact', x: p0.x, y: p0.y, w: 0, h: 0 };
    else if (t === 'check' || t === 'cross' || t === 'dot') { const s = 16; a = { ...base, type: 'mark', kind: t, x: p0.x - s / 2, y: p0.y - s / 2, w: s, h: s, color: D.mark.color }; }
    else if (t === 'note') a = { ...base, type: 'note', x: p0.x, y: p0.y, text: '', color: D.note.color };
    else if (t === 'place') {
      if (!this.pending) return;
      const { assetId, w, h: hh } = this.pending; const W = Math.min(w, 180), H = W * hh / w;
      a = { ...base, type: 'image', assetId, x: p0.x - W / 2, y: p0.y - H / 2, w: W, h: H, opacity: 1, sig: this.pending.kind === 'sign' };
      this.pending = null;
    }
    annots.push(a); this.repaint(a, pi);
    const dragTool = ['rect', 'ellipse', 'line', 'arrow', 'whiteout', 'redact'].includes(t);
    if (!dragTool && t !== 'pen' && t !== 'highlighter') return this.finishCreate(a, pi, t);
    info.el.setPointerCapture?.(e.pointerId);
    const move = ev => {
      const p = this.viewer.ptFromEvent(ev, pi);
      if (t === 'pen' || t === 'highlighter') {
        const last = a.points[a.points.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) > 0.8) { a.points.push([+p.x.toFixed(2), +p.y.toFixed(2)]); this.repaint(a, pi); }
      } else if (t === 'line' || t === 'arrow') {
        let { x, y } = p; if (ev.shiftKey) { const dx = x - a.x1, dy = y - a.y1; if (Math.abs(dx) > Math.abs(dy) * 2) y = a.y1; else if (Math.abs(dy) > Math.abs(dx) * 2) x = a.x1; }
        a.x2 = x; a.y2 = y; this.repaint(a, pi);
      } else {
        let w = p.x - p0.x, hh = p.y - p0.y; if (ev.shiftKey && (t === 'rect' || t === 'ellipse')) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; }
        a.x = Math.min(p0.x, p0.x + w); a.y = Math.min(p0.y, p0.y + hh); a.w = Math.abs(w); a.h = Math.abs(hh); this.repaint(a, pi);
      }
    };
    const up = () => {
      info.el.removeEventListener('pointermove', move); info.el.removeEventListener('pointerup', up); info.el.removeEventListener('pointercancel', up);
      if (['rect', 'ellipse', 'whiteout', 'redact'].includes(t) && (a.w < 3 || a.h < 3)) { a.w = t === 'whiteout' ? 140 : 120; a.h = t === 'whiteout' ? 24 : 60; a.x = p0.x; a.y = p0.y; }
      if ((t === 'line' || t === 'arrow') && Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 4) { a.x2 = a.x1 + 100; }
      this.finishCreate(a, pi, t);
    };
    info.el.addEventListener('pointermove', move); info.el.addEventListener('pointerup', up); info.el.addEventListener('pointercancel', up);
  }

  finishCreate(a, pi, t) {
    this.repaint(a, pi);
    if (a.type === 'text') { this.select(a, pi); this.revertAfter = true; this.dv.setTool('select'); this.beginEdit(a, pi, true); return; }
    this.doc.checkpoint();
    if (a.type === 'note') { this.select(a, pi); this.dv.setTool('select'); this.dv.editNote(a, pi); return; }
    if (ONE_SHOT.has(t)) this.dv.setTool('select');
    this.select(a, pi); if (t === 'pen' || t === 'highlighter' || t === 'whiteout' || t === 'redact') this.select(null);
  }

  startMove(e, pi, a) {
    const info = this.viewer.pages[pi]; const p0 = this.viewer.ptFromEvent(e, pi);
    const orig = copyJson(a); let moved = false;
    info.el.setPointerCapture?.(e.pointerId);
    const move = ev => {
      const p = this.viewer.ptFromEvent(ev, pi); let dx = p.x - p0.x, dy = p.y - p0.y;
      if (!moved && Math.hypot(dx, dy) * this.zoom < 3) return;
      moved = true; this.applyOffset(a, orig, dx, dy); this.repaint(a, pi);
    };
    const up = () => {
      info.el.removeEventListener('pointermove', move); info.el.removeEventListener('pointerup', up); info.el.removeEventListener('pointercancel', up);
      if (moved) this.doc.checkpoint();
    };
    info.el.addEventListener('pointermove', move); info.el.addEventListener('pointerup', up); info.el.addEventListener('pointercancel', up);
  }
  applyOffset(a, o, dx, dy) {
    if (a.type === 'line' || a.type === 'arrow') { a.x1 = o.x1 + dx; a.x2 = o.x2 + dx; a.y1 = o.y1 + dy; a.y2 = o.y2 + dy; }
    else if (a.type === 'ink') a.points = o.points.map(p => [p[0] + dx, p[1] + dy]);
    else if (a.rects) a.rects = o.rects.map(r => [r[0] + dx, r[1] + dy, r[2], r[3]]);
    else { a.x = o.x + dx; a.y = o.y + dy; }
  }

  startResize(e, pi, hd) {
    const s = this.selected; if (!s) return; const a = s.a; const info = this.viewer.pages[pi];
    const orig = copyJson(a); const ratio = orig.w / orig.h; info.el.setPointerCapture?.(e.pointerId);
    const move = ev => {
      const p = this.viewer.ptFromEvent(ev, pi);
      if (hd === 'p1') { a.x1 = p.x; a.y1 = p.y; } else if (hd === 'p2') { a.x2 = p.x; a.y2 = p.y; }
      else {
        let x0 = orig.x, y0 = orig.y, x1 = orig.x + orig.w, y1 = orig.y + orig.h;
        if (hd.includes('w')) x0 = Math.min(p.x, x1 - 6); if (hd.includes('e')) x1 = Math.max(p.x, x0 + 6);
        if (hd.includes('n')) y0 = Math.min(p.y, y1 - 6); if (hd.includes('s')) y1 = Math.max(p.y, y0 + 6);
        if ((a.type === 'image' || a.type === 'mark') && hd.length === 2) {
          const w = x1 - x0; const hh = w / ratio; if (hd.includes('n')) y0 = y1 - hh; else y1 = y0 + hh;
        }
        a.x = x0; a.y = y0; a.w = x1 - x0; if (a.type !== 'text') a.h = y1 - y0;
      }
      this.repaint(a, pi);
      if (a.type === 'text') { const el = this.findEl(a, pi); a.h = el.offsetHeight; this.paintSelection(); }
    };
    const up = () => { info.el.removeEventListener('pointermove', move); info.el.removeEventListener('pointerup', up); info.el.removeEventListener('pointercancel', up); this.doc.checkpoint(); };
    info.el.addEventListener('pointermove', move); info.el.addEventListener('pointerup', up); info.el.addEventListener('pointercancel', up);
  }

  onDblClick(e) {
    const annEl = e.target.closest('.annot'); if (!annEl) return;
    const pi = +annEl.dataset.page; const a = this.doc.pages[pi].annots.find(x => x.id === annEl.dataset.id); if (!a) return;
    if (a.type === 'text' || a.type === 'textedit') { this.select(a, pi); this.beginEdit(a, pi); }
    else if (a.type === 'note') this.dv.editNote(a, pi);
  }

  /* ------------------------------------------------------------ text editing */
  beginEdit(a, pi, isNew = false, selectAll = false) {
    this.endEdit(true);
    let el = this.findEl(a, pi); if (!el) el = this.repaint(a, pi);
    el.contentEditable = 'true'; el.spellcheck = false; el.classList.add('editing'); el.dataset.isNew = isNew ? '1' : '';
    this.editing = { a, page: pi, el, orig: a.text, isNew };
    this.paintSelection();
    const onInput = () => { if (a.type === 'text') a.h = el.offsetHeight; };
    const onKey = ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.endEdit(true); }
      else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); this.endEdit(true); }
      else if (ev.key === 'Enter' && a.type === 'textedit') { ev.preventDefault(); this.endEdit(true); }
      ev.stopPropagation();
    };
    const onPaste = ev => { ev.preventDefault(); const t = (ev.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); };
    const onBlur = () => setTimeout(() => { if (this.editing && this.editing.el === el && document.activeElement !== el) this.endEdit(true); }, 0);
    el.addEventListener('input', onInput); el.addEventListener('keydown', onKey); el.addEventListener('paste', onPaste); el.addEventListener('blur', onBlur);
    this.editing.cleanup = () => { el.removeEventListener('input', onInput); el.removeEventListener('keydown', onKey); el.removeEventListener('paste', onPaste); el.removeEventListener('blur', onBlur); };
    el.focus();
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = getSelection(); sel.removeAllRanges();
    if (selectAll || (!isNew && a.text)) sel.addRange(range); else { range.collapse(false); sel.addRange(range); }
  }
  endEdit(commit) {
    const ed = this.editing; if (!ed) return;
    this.editing = null; ed.cleanup && ed.cleanup();
    const { a, page, el } = ed;
    let text = el.innerText.replace(/​/g, '').replace(/\n$/, '');
    if (!commit) text = ed.orig;
    el.contentEditable = 'false'; el.classList.remove('editing');
    if (a.type === 'text') { a.text = text; a.h = Math.max(a.size * LINE_HEIGHT, el.offsetHeight || 0); }
    else { a.text = text; }
    const annots = this.doc.pages[page].annots;
    const remove = (a.type === 'text' && !text.trim()) || (a.type === 'textedit' && text === a.orig && ed.isNew);
    if (remove) { const k = annots.indexOf(a); if (k >= 0) annots.splice(k, 1); if (this.sel?.id === a.id) this.sel = null; }
    else if (a.type === 'textedit' && text === a.orig && !ed.isNew) { /* unchanged existing edit */ }
    this.repaint && (remove ? this.renderPage(page) : this.repaint(a, page));
    this.doc.checkpoint(); this.paintSelection(); this.emitSel();
  }

  /** Click on an existing text line while "Edit text" is active. */
  async editSegment(pi, seg) {
    // already edited? reuse
    const existing = this.doc.pages[pi].annots.find(x => x.type === 'textedit' && Math.abs(x.x - seg.x) < 2 && Math.abs(x.y - (seg.baseline - BASELINE.helv * seg.fs)) < 4);
    if (existing) { this.select(existing, pi); return this.beginEdit(existing, pi); }
    const info = this.viewer.pages[pi];
    const fi = seg.fontName ? await getFontInfo(this.doc.pdf, pi, seg.fontName) : {};
    const fit = seg.ocr ? { w: seg.w, bold: false } : fitSegment(info, seg); // the real width of the text, not the width the PDF reports
    const fam = chooseFamily(seg, fi, fit);
    const size = +seg.fs.toFixed(1);
    const { bg, fg } = sampleColors(info, { ...seg, w: fit.w });
    const a = {
      id: uid(), type: 'textedit', x: seg.x, y: seg.baseline - (BASELINE[fam]) * size, coverW: +fit.w.toFixed(2), h: size * LINE_HEIGHT,
      text: seg.text, orig: seg.text, font: fam, size, bold: !!fi.bold || !!fit.bold, italic: !!fi.italic, color: fg, bg,
    };
    if (!seg.ocr) { const keep = detectKeep(info, a, bg); if (keep.length) a.keep = keep; } // table borders / rules inside the covered box stay visible
    this.doc.pages[pi].annots.push(a);
    this.repaint(a, pi); this.select(a, pi); this.beginEdit(a, pi, true, true);
  }

  /* ------------------------------------------------------------ markup from text selection */
  onMouseUp(e) {
    if (!MARKUP_TOOLS.has(this.tool)) return;
    const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const rects = [...sel.getRangeAt(0).getClientRects()].filter(r => r.width > 1 && r.height > 2);
    const byPage = new Map();
    for (const r of rects) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const info = this.viewer.pages.find(p => { const b = p.el.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
      if (!info) continue;
      const b = info.el.getBoundingClientRect(), z = this.zoom;
      const q = [(r.left - b.left) / z, (r.top - b.top) / z, r.width / z, r.height / z];
      if (!byPage.has(info.i)) byPage.set(info.i, []); byPage.get(info.i).push(q);
    }
    if (!byPage.size) return;
    const d = this.defaults[this.tool];
    for (const [pi, rs] of byPage) {
      const merged = mergeLineRects(rs);
      const a = { id: uid(), type: this.tool, rects: merged, color: d.color, opacity: d.opacity };
      this.doc.pages[pi].annots.push(a); this.repaint(a, pi);
    }
    sel.removeAllRanges(); this.doc.checkpoint();
  }

  /* ------------------------------------------------------------ fonts */
  fontReady(a) {
    const i = this.pageOf(a); if (i < 0) return; const el = this.repaint(a, i);
    if (a.type === 'text') { a.h = Math.max(a.size * LINE_HEIGHT, el.offsetHeight || 0); this.paintSelection(); }
  }
  async baseOf(a) { return isCustom(a.font) ? ((await probeBase(a)) ?? 0.95) : (BASELINE[a.font] ?? BASELINE.helv); }
  /** Changes the font of the selection (or the default for new text). */
  async setFont(font, gname) {
    const s = this.selected;
    if (s && (s.a.type === 'text' || s.a.type === 'textedit')) {
      const { a, page } = s; const old = await this.baseOf(a);
      a.font = font; a.gname = gname || null; await ensureFont(a); const nb = await this.baseOf(a);
      if (a.type === 'textedit') a.y += (old - nb) * a.size; // keep the text sitting on the same baseline
      const el = this.repaint(a, page); if (a.type === 'text') a.h = Math.max(a.size * LINE_HEIGHT, el.offsetHeight || 0);
      this.paintSelection(); this.doc.checkpoint();
    }
    const grp = this.groupOf(s ? s.a.type : this.tool);
    if (grp && this.defaults[grp]) { this.defaults[grp].font = font; this.defaults[grp].gname = gname || null; }
  }

  /* ------------------------------------------------------------ commands */
  setProp(key, value) {
    const s = this.selected;
    if (s) {
      const { a, page } = s;
      if (key === 'sw' && a.type === 'text') return;
      a[key] = value;
      if (a.type === 'text' && ['size', 'font', 'bold', 'italic', 'w'].includes(key)) { this.repaint(a, page); a.h = this.findEl(a, page).offsetHeight; }
      else if (a.type === 'textedit' && ['size', 'font'].includes(key)) { a.h = a.size * LINE_HEIGHT; this.repaint(a, page); }
      else this.repaint(a, page);
      this.paintSelection(); this.doc.checkpoint();
    }
    const grp = this.groupOf(s ? s.a.type : this.tool);
    if (grp && this.defaults[grp]) this.defaults[grp][key] = value;
  }
  groupOf(t) {
    const m = { text: 'text', textedit: 'textedit', rect: 'shape', ellipse: 'shape', line: 'shape', arrow: 'shape', ink: null, pen: 'pen', highlighter: 'highlighter', highlight: 'highlight', underline: 'underline', strike: 'strike', whiteout: 'fill', note: 'note', mark: 'mark', check: 'mark', cross: 'mark', dot: 'mark', image: 'image' };
    return m[t] ?? null;
  }
  deleteSelected() {
    const s = this.selected; if (!s) return;
    const arr = this.doc.pages[s.page].annots; arr.splice(arr.indexOf(s.a), 1);
    this.sel = null; this.renderPage(s.page); this.doc.checkpoint(); this.emitSel();
  }
  duplicateSelected() {
    const s = this.selected; if (!s) return;
    const c = copyJson(s.a); c.id = uid(); this.applyOffset(c, copyJson(s.a), 14, 14);
    this.doc.pages[s.page].annots.push(c); this.repaint(c, s.page); this.select(c, s.page); this.doc.checkpoint();
  }
  copy() { const s = this.selected; if (s) { this.clip = copyJson(s.a); toast('Copied', 'info', 1200); } }
  paste() {
    if (!this.clip) return; const pi = this.viewer.current; const c = copyJson(this.clip); c.id = uid(); this.applyOffset(c, copyJson(this.clip), 16, 16); this.clip = copyJson(c);
    if (c.type === 'image' && !this.doc.assets.has(c.assetId)) return;
    this.doc.pages[pi].annots.push(c); this.repaint(c, pi); this.select(c, pi); this.doc.checkpoint();
  }
  reorder(front) {
    const s = this.selected; if (!s) return; const arr = this.doc.pages[s.page].annots; arr.splice(arr.indexOf(s.a), 1); front ? arr.push(s.a) : arr.unshift(s.a);
    this.renderPage(s.page); this.doc.checkpoint();
  }
  nudge(dx, dy) {
    const s = this.selected; if (!s || this.editing) return;
    this.applyOffset(s.a, copyJson(s.a), dx, dy); this.repaint(s.a, s.page); this.doc.checkpoint();
  }
}

/* ---------------------------------------------------------------- helpers */
function mergeLineRects(rs) {
  rs.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - r[1]) < Math.min(last[3], r[3]) * 0.5 && r[0] <= last[0] + last[2] + 3) {
      const x1 = Math.max(last[0] + last[2], r[0] + r[2]); const y0 = Math.min(last[1], r[1]); const y1 = Math.max(last[1] + last[3], r[1] + r[3]);
      last[0] = Math.min(last[0], r[0]); last[2] = x1 - last[0]; last[1] = y0; last[3] = y1 - y0;
    } else out.push([...r]);
  }
  return out;
}

/** Converts any browser-readable image into PNG/JPEG bytes the PDF writer can embed. */
export async function normalizeImage(file) {
  const bytes0 = await readBytes(file);
  const isJpg = file.type === 'image/jpeg', isPng = file.type === 'image/png';
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be read')); i.src = url; });
    const w = img.naturalWidth, hh = img.naturalHeight;
    if (isJpg || isPng) return { bytes: bytes0, mime: file.type, w, h: hh };
    const c = document.createElement('canvas'); c.width = w; c.height = hh; c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', w, h: hh };
  } finally { URL.revokeObjectURL(url); }
}
