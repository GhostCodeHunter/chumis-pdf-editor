// Working offline: the app itself, the built-in trust list and embedded revocation data are always available once the app has
// loaded; this module adds the pieces that come from a CDN (OCR engine + language data, extra fonts) via a one-click download,
// shows what is ready, and flags when the browser is offline.
import { h, icon, button, toast, dialog } from './ui.js';
import { prepareOcr } from './ocr.js';
import { entryFor, loadStyle } from './fonts.js';

const KEY = 'chumi.offline.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const mark = (k) => { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [k]: Date.now() })); } catch {} };
const FONT_IDS = ['arimo', 'tinos', 'cousine', 'carlito', 'caladea', 'roboto', 'open-sans'];   // the typefaces used to match the fonts of edited PDFs

export const isOffline = () => !navigator.onLine;

/** What is available without a network, right now. */
export async function offlineStatus() {
  let app = false, trust = false;
  try { app = !!(await caches.match('app.html')); trust = !!(await caches.match('vendor/trust/india-pki.json')); } catch {}
  const st = read();
  return { app: app || !!navigator.serviceWorker?.controller, trust, ocr: !!st.ocr, fonts: !!st.fonts, when: st };
}

export async function downloadOfflinePack({ onStep } = {}) {
  const steps = [];
  const run = async (key, label, fn) => { onStep && onStep(key, 'working', label); try { await fn(p => onStep && onStep(key, 'working', label, p)); mark(key); onStep && onStep(key, 'done', label); steps.push([key, true]); } catch (e) { console.warn('offline pack', key, e); onStep && onStep(key, 'error', e.message || String(e)); steps.push([key, false]); } };
  await run('fonts', 'Fonts for editing', async prog => {
    let n = 0, ok = 0; const total = FONT_IDS.length * 4;
    for (const id of FONT_IDS) for (const [w, st] of [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']]) { if (await loadStyle(entryFor(id), w, st)) ok++; prog && prog(++n / total); }
    if (!ok) throw new Error('The font server could not be reached.');
  });
  await run('ocr', 'Text recognition (OCR) · English + Hindi', prog => prepareOcr(['eng', 'hin'], prog));
  return steps;
}

export function offlineDialog() {
  const rows = {}, mk = (key, title, sub) => { const st = h('span.pill'), bar = h('div.off-bar', h('i')); rows[key] = { st, bar }; return h('li.off-row', h('div', h('strong', title), h('div.hint', sub)), st, bar); };
  const list = h('ul.off-list',
    mk('app', 'App, editing, merge, organize, convert, sign', 'Everything runs on your device.'),
    mk('trust', 'Signature validation', 'India’s CCA roots are built in; revocation uses the data stored in the file.'),
    mk('fonts', 'Fonts for editing', 'Matches the typefaces of edited PDFs (Arial, Times, Calibri…). Otherwise built-in fonts are used.'),
    mk('ocr', 'Text recognition (OCR)', 'English + Hindi, about 15 MB. Other languages download when first used.'));
  const set = (key, state, text) => { const r = rows[key]; if (!r) return; r.st.className = 'pill ' + (state === 'done' ? 'ok' : state === 'error' ? 'bad' : state === 'working' ? 'info' : 'warn'); r.st.textContent = text || ({ done: 'Ready offline', working: 'Downloading…', error: 'Failed', todo: 'Needs a download' }[state]); };
  const bar = (key, f) => { const i = rows[key]?.bar.firstChild; if (i) i.style.width = Math.round(f * 100) + '%'; };
  const refresh = async () => { const s = await offlineStatus(); set('app', s.app ? 'done' : 'todo', s.app ? 'Ready offline' : 'Reload once online'); set('trust', s.trust ? 'done' : 'todo', s.trust ? 'Ready offline' : 'Reload once online'); set('fonts', s.fonts ? 'done' : 'todo'); set('ocr', s.ocr ? 'done' : 'todo'); };
  const go = button({ label: 'Download for offline use', icon: 'download', kind: 'primary', onClick: async () => {
    if (isOffline()) return toast('Connect to the internet to download.', 'info');
    go.disabled = true;
    const res = await downloadOfflinePack({ onStep: (k, state, msg, p) => { set(k, state, state === 'error' ? 'Failed' : undefined); if (p != null) bar(k, p); if (state === 'done') bar(k, 1); } });
    go.disabled = false; await refresh();
    toast(res.every(x => x[1]) ? 'Ready: fonts and OCR now work offline.' : 'Some items could not be downloaded — check your connection and try again.', res.every(x => x[1]) ? 'success' : 'error', 5000);
  } });
  const d = dialog({ title: 'Work offline', width: 600, body: h('div', h('p', isOffline() ? 'You are offline. What is marked ready keeps working.' : 'After the app has loaded once, it works without a network. Download the optional parts below once, while you are online.'), list, h('p.hint', 'Files you open are never uploaded, online or offline.')), actions: [go, button({ label: 'Close', onClick: () => d.close() })] });
  refresh();
}

/** Header control: an “Offline” button, and a badge while the browser has no connection. */
export function offlineControl() {
  const badge = h('span.pill.warn.off-badge', { hidden: true, title: 'No internet connection — everything except downloads still works.' }, icon('alert-circle', 14), 'Offline');
  const btn = button({ label: 'Offline', icon: 'cloud', kind: 'ghost', title: 'Work offline: what is ready and what to download', onClick: offlineDialog });
  const upd = () => { badge.hidden = !isOffline(); };
  addEventListener('online', () => { upd(); toast('You are back online.', 'success', 2500); }); addEventListener('offline', () => { upd(); toast('You are offline. Editing, validation and printing keep working.', 'info', 4500); }); upd();
  return h('span.off-ctl', badge, btn);
}
