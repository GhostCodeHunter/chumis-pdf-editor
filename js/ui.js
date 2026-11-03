// Shared UI pieces. Every screen builds its buttons, dialogs, toasts and fields from here.
import { ICON_PATHS } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny hyperscript helper: h('div.card', {onclick}, child, 'text') */
export function h(spec, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec);
  const el = document.createElement(m && m[1] ? m[1] : 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') v.split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function icon(name, size = 18) {
  const d = ICON_PATHS[name];
  if (!d) throw new Error('Unknown icon: ' + name);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

/** Buttons: kind = primary | secondary | ghost | danger. Icon-only buttons need a title (used as tooltip + aria-label). */
export function button({ label, icon: ic, kind = 'secondary', title, onClick, disabled, size, cls = '' } = {}) {
  const el = h('button.btn.btn-' + kind + (label ? '' : '.btn-icon') + (size ? '.btn-' + size : ''), { type: 'button', title: title || label || '', disabled: !!disabled });
  if (cls) cls.split(' ').filter(Boolean).forEach(c => el.classList.add(c));
  if (!label && title) el.setAttribute('aria-label', title);
  if (ic) el.append(icon(ic, size === 'sm' ? 16 : 18));
  if (label) el.append(h('span', label));
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

export function field(label, control, hint) {
  const id = 'f' + uid();
  if (control.id === '' ) control.id = id;
  return h('div.field', h('label', { for: control.id || id }, label), control, hint ? h('div.hint', hint) : null);
}

export function select(options, value, onChange) {
  const el = h('select.select', { onchange: e => onChange && onChange(e.target.value) },
    options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
  return el;
}

export function segmented(options, value, onChange) {
  const root = h('div.seg', { role: 'group' });
  const draw = v => root.querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.v === String(v)); });
  options.forEach(o => {
    const [v, l, ic] = Array.isArray(o) ? o : [o, o];
    root.append(h('button', { type: 'button', dataset: { v: String(v) }, title: l, onclick: () => { draw(v); onChange && onChange(v); } }, ic ? icon(ic, 16) : null, ic ? null : l));
  });
  draw(value);
  root.set = draw;
  return root;
}

/* ---------- toasts ---------- */
export function toast(msg, kind = 'info', ms = 4200) {
  const host = $('#toasts');
  const dismiss = () => { if (!t.isConnected || t.classList.contains('leaving')) return; t.classList.add('leaving'); setTimeout(() => t.remove(), 180); };
  const t = h('div.toast.toast-' + kind, { role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'alert-circle' : kind === 'success' ? 'check-circle' : 'info', 18), h('span', msg),
    button({ icon: 'close', kind: 'ghost', title: 'Dismiss', size: 'sm', onClick: dismiss }));
  host.append(t);
  while (host.children.length > 4) host.firstChild.remove();
  if (ms) setTimeout(dismiss, ms);
  return t;
}

/* ---------- dialogs ---------- */
let modalStack = 0;
export function dialog({ title, body, actions = [], width = 480, onClose, dismissible = true }) {
  const prevFocus = document.activeElement;
  const back = h('div.modal-back');
  const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { maxWidth: width + 'px' } },
    h('div.modal-h', h('h2', title), dismissible ? button({ icon: 'close', kind: 'ghost', title: 'Close', onClick: () => api.close(null) }) : null),
    h('div.modal-b', body),
    actions.length ? h('div.modal-f', actions) : null);
  back.append(box);
  document.body.append(back);
  modalStack++;
  let resolve; const promise = new Promise(r => resolve = r);
  const api = {
    el: box, promise,
    close(val) {
      if (!back.isConnected || back.classList.contains('leaving')) return;
      back.classList.add('leaving'); setTimeout(() => back.remove(), 170); modalStack--; document.removeEventListener('keydown', onKey, true);
      prevFocus && prevFocus.focus && prevFocus.focus();
      onClose && onClose(val); resolve(val);
    },
  };
  function onKey(e) {
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); api.close(null); }
    if (e.key === 'Tab') { // focus trap
      const f = $$('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', box).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  if (dismissible) back.addEventListener('pointerdown', e => { if (e.target === back) api.close(null); });
  setTimeout(() => { const f = box.querySelector('[autofocus], input, select, textarea, .modal-f .btn-primary, .modal-f .btn'); f && f.focus(); }, 30);
  return api;
}

export function confirmDialog({ title, message, confirmLabel = 'Continue', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise(res => {
    const d = dialog({
      title, body: h('p', message),
      actions: [button({ label: cancelLabel, onClick: () => d.close(false) }), button({ label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => d.close(true) })],
      onClose: v => res(!!v),
    });
  });
}

export function promptDialog({ title, label, value = '', type = 'text', confirmLabel = 'Save', hint }) {
  return new Promise(res => {
    const input = h('input.input', { type, value, autofocus: true });
    const submit = () => d.close(input.value);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    const d = dialog({
      title, body: field(label, input, hint),
      actions: [button({ label: 'Cancel', onClick: () => d.close(null) }), button({ label: confirmLabel, kind: 'primary', onClick: submit })],
      onClose: v => res(v),
    });
  });
}

/** Blocking progress dialog. update(fraction|null, text) */
export function progressDialog(title) {
  const bar = h('div.bar', h('i'));
  const txt = h('div.progress-text', 'Working…');
  const cancelFlag = { cancelled: false };
  const d = dialog({ title, body: h('div.progress', bar, txt), dismissible: false, width: 420 });
  return {
    update(frac, text) {
      if (text) txt.textContent = text;
      const i = bar.firstChild;
      if (frac == null) bar.classList.add('indet'); else { bar.classList.remove('indet'); i.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%'; }
    },
    close: () => d.close(null),
    cancelFlag,
  };
}

/** Run an async job behind a progress dialog; shows an error toast on failure. */
export async function withProgress(title, job) {
  const p = progressDialog(title);
  try { return await job(p); }
  catch (e) { console.error(e); toast(`${title} failed: ${e.message || e}`, 'error', 8000); return undefined; }
  finally { p.close(); }
}

/* ---------- files ---------- */
export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    inp.addEventListener('cancel', () => { res([]); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}

export function downloadBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name, style: { display: 'none' } });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export const readBytes = async file => new Uint8Array(await file.arrayBuffer());
export const baseName = n => n.replace(/\.[^.]+$/, '');
export const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

export function dataUrlToBytes(url) {
  const b64 = url.split(',')[1]; const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToDataUrl(bytes, mime) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(s)}`;
}

/** Make a floating menu anchored to a button. items: [{label, icon, onClick}] */
export function popupMenu(anchor, items) {
  document.querySelectorAll('.popmenu').forEach(m => m.remove());
  const r = anchor.getBoundingClientRect();
  const menu = h('div.popmenu', { role: 'menu', style: { left: Math.min(r.left, innerWidth - 220) + 'px', top: r.bottom + 4 + 'px' } },
    items.map(it => it === '-' ? h('hr') : h('button', { role: 'menuitem', type: 'button', onclick: () => { menu.remove(); it.onClick(); } }, it.icon ? icon(it.icon, 16) : null, h('span', it.label))));
  document.body.append(menu);
  const off = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  menu.querySelector('button')?.focus();
  menu.addEventListener('keydown', e => { if (e.key === 'Escape') menu.remove(); });
  return menu;
}

export function emptyState({ icon: ic, title, text, action }) {
  return h('div.empty', icon(ic, 40), h('h3', title), text ? h('p', text) : null, action || null);
}
