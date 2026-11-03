// Fill & Sign panel: draw / type / upload a signature, stamps, date.
import { h, icon, button, toast, dialog, field, select, pickFiles, bytesToDataUrl, dataUrlToBytes } from './ui.js';

const KEY = 'chumi.signatures.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 8))); } catch { toast('Could not save the signature on this device.', 'error'); } };

export function mountPanel(dv, el) {
  const list = h('div.sig-list');
  const draw = () => {
    list.replaceChildren();
    const sigs = load();
    if (!sigs.length) list.append(h('p.hint', 'No saved signatures yet. Create one — it is stored only in this browser.'));
    sigs.forEach(s => list.append(h('div.sig-item',
      h('button.sig-use', { type: 'button', title: 'Place this signature on the page', onclick: () => use(s) }, h('img', { src: s.url, alt: 'Saved signature' })),
      button({ icon: 'trash', kind: 'ghost', size: 'sm', title: 'Delete this signature', onClick: () => { save(load().filter(x => x.id !== s.id)); draw(); } }))));
  };
  const use = s => {
    if (!dv.editable) return dv.needUnlock();
    const bytes = dataUrlToBytes(s.url); const assetId = dv.doc.addAsset(bytes, 'image/png');
    dv.annots.setPending({ assetId, w: s.w, h: s.h, kind: 'sign' });
  };
  const today = () => new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  el.append(dv.panelHeader('Fill & Sign', 'Add your signature, ticks and dates.'),
    h('div.panel-b',
      h('div.panel-sec', h('h3', 'Signature'), button({ label: 'Create signature', icon: 'sign', kind: 'primary', onClick: () => createDialog(s => { save([s, ...load()]); draw(); use(s); }) }), list),
      h('div.panel-sec', h('h3', 'Quick marks'),
        h('div.fmt-grid',
          quick('check', 'Checkmark', () => dv.setTool('check')), quick('cross', 'Cross', () => dv.setTool('cross')), quick('dot', 'Bullet dot', () => dv.setTool('dot')),
          quick('text-add', 'Today’s date', () => { dv.annots.presetText = today(); dv.setTool('text'); toast('Click where the date should go.', 'info', 2500); }))),
      h('p.hint', 'Tip: after placing, drag to move and use the corner handles to resize.')));
  draw();
  return {};
  function quick(ic, label, fn) { return h('button.fmt', { type: 'button', onclick: () => { if (!dv.editable) return dv.needUnlock(); fn(); } }, icon(ic, 20), h('strong', label)); }
}

function createDialog(onSave) {
  let tab = 'draw'; const holder = h('div'); let getImage = () => null;
  const tabs = h('div.seg', ...[['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']].map(([id, l]) => h('button', { type: 'button', 'aria-pressed': String(id === tab), dataset: { id }, onclick: () => { tab = id; tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id))); render(); } }, l)));
  function render() {
    holder.replaceChildren();
    if (tab === 'draw') {
      const c = h('canvas.sig-canvas', { width: 960, height: 320, 'aria-label': 'Draw your signature here' }); const ctx = c.getContext('2d'); ctx.lineWidth = 7; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; let down = false, last = null, any = false;
      const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
      c.addEventListener('pointerdown', e => { down = true; last = pos(e); c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(last[0] + 0.1, last[1]); ctx.stroke(); any = true; });
      c.addEventListener('pointermove', e => { if (!down) return; const p = pos(e); const mid = [(last[0] + p[0]) / 2, (last[1] + p[1]) / 2]; ctx.beginPath(); ctx.moveTo(...last); ctx.quadraticCurveTo(last[0], last[1], mid[0], mid[1]); ctx.stroke(); last = p; });
      const up = () => { down = false; }; c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
      holder.append(h('p.hint', 'Sign with your mouse, finger or stylus.'), c, button({ label: 'Clear', kind: 'ghost', size: 'sm', onClick: () => { ctx.clearRect(0, 0, c.width, c.height); any = false; } }));
      getImage = () => any ? c : null;
    } else if (tab === 'type') {
      const fonts = ['"Brush Script MT"', '"Segoe Script"', '"Snell Roundhand"', '"Lucida Handwriting"', '"Apple Chancery"', 'cursive'];
      const name = h('input.input', { type: 'text', placeholder: 'Type your name', value: '' }); const fontSel = select(fonts.map(f => [f, f.replace(/"/g, '').replace('cursive', 'Default handwriting')]), fonts[0], () => paint());
      const c = h('canvas.sig-canvas', { width: 960, height: 320, 'aria-label': 'Signature preview' }); const ctx = c.getContext('2d');
      const paint = () => { ctx.clearRect(0, 0, c.width, c.height); ctx.fillStyle = '#111'; ctx.textBaseline = 'middle'; ctx.font = `italic 120px ${fontSel.value}, cursive`; ctx.fillText(name.value || '', 30, 170, 900); };
      name.addEventListener('input', paint);
      holder.append(field('Your name', name), field('Style', fontSel), c); getImage = () => name.value.trim() ? c : null;
    } else {
      const c = h('canvas.sig-canvas', { width: 960, height: 320 }); let have = false;
      holder.append(h('p.hint', 'Upload a photo of your signature on white paper. The background is removed automatically.'), button({ label: 'Choose image', icon: 'image-add', onClick: async () => {
        const [f] = await pickFiles({ accept: 'image/*', multiple: false }); if (!f) return;
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f); });
        const k = Math.min(c.width / img.width, c.height / img.height); const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, img.width * k, img.height * k);
        const d = ctx.getImageData(0, 0, c.width, c.height); const px = d.data;
        for (let i = 0; i < px.length; i += 4) { const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; const a = Math.max(0, Math.min(255, (225 - lum) * 4)); px[i] = px[i + 1] = px[i + 2] = Math.min(px[i], 40); px[i + 3] = Math.min(px[i + 3], a); }
        ctx.putImageData(d, 0, 0); have = true; c.classList.add('ready');
      } }), c); getImage = () => have ? c : null;
    }
  }
  render();
  const d = dialog({ title: 'Create signature', width: 560, body: h('div', tabs, holder),
    actions: [button({ label: 'Cancel', onClick: () => d.close() }), button({ label: 'Save & place', kind: 'primary', onClick: () => {
      const src = getImage(); if (!src) return toast('Add a signature first.', 'error');
      const out = trim(src); if (!out) return toast('The signature looks empty.', 'error');
      d.close(); onSave({ id: Math.random().toString(36).slice(2), url: out.url, w: out.w, h: out.h });
    } })] });
}

function trim(c) {
  const ctx = c.getContext('2d'); const { width: W, height: H } = c; const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 8; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1; out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { url: out.toDataURL('image/png'), w: out.width, h: out.height };
}
