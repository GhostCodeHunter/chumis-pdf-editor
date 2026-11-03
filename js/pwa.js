// Install-to-desktop (PWA) support: service worker registration + an install button that works in every browser.
import { h, icon, button, dialog } from './ui.js';
import { APP_NAME } from './config.js';

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach(f => f());

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; notify(); });
window.addEventListener('appinstalled', () => { deferred = null; notify(); });

export function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url).href).catch(e => console.warn('Service worker not registered', e));
  });
}

function manualSteps() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
  const firefox = /firefox|fxios/i.test(ua);
  if (iOS) return ['Tap the Share button in Safari.', 'Choose “Add to Home Screen”.', `Tap “Add” — ${APP_NAME} now opens like an app.`];
  if (safari) return ['In the menu bar choose File → Add to Dock… (Safari 17 or newer).', `Click “Add” — ${APP_NAME} appears in your Dock.`];
  if (firefox) return ['Firefox on desktop can’t install web apps.', 'Open this page in Chrome or Microsoft Edge, then use the install icon in the address bar.'];
  return ['Look for the install icon at the right end of the address bar (a monitor with a down arrow) and click it.', 'Or open the browser menu (⋮) and choose “Install " + APP_NAME + "…” (Chrome) / Apps → “Install this site as an app” (Edge).', 'Confirm — a desktop shortcut and a Start-menu / Applications entry are created.'];
}

export async function promptInstall() {
  if (deferred) {
    const ev = deferred; deferred = null; notify();
    ev.prompt();
    const choice = await ev.userChoice.catch(() => null);
    return choice && choice.outcome;
  }
  const steps = manualSteps().map(s => s.replace('" + APP_NAME + "', APP_NAME));
  const d = dialog({
    title: 'Install on your device',
    body: h('div', h('p', `Install ${APP_NAME} to open it from your desktop, use it in its own window, and keep working offline.`),
      h('ol.steps', steps.map(s => h('li', s))),
      h('p.hint', 'Your files never leave your device — installing only saves the app itself.')),
    actions: [button({ label: 'Got it', kind: 'primary', onClick: () => d.close() })],
    width: 460,
  });
  return 'manual';
}

/** Returns a button that installs the app; hidden once the app is installed / running standalone. */
export function installButton({ label = 'Install app', kind = 'secondary', size, cls = '' } = {}) {
  const b = button({ label, icon: 'download', kind, size, title: `Install ${APP_NAME} on this device`, onClick: () => promptInstall() });
  if (cls) b.classList.add(...cls.split(' '));
  const sync = () => { b.hidden = isStandalone(); };
  listeners.add(sync); sync();
  return b;
}
