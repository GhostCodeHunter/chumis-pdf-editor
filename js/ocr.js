// Scan & OCR: recognise text on scanned pages (Tesseract.js, loaded on first use) → searchable + editable text.
import { h, icon, button, toast, field, select, withProgress, downloadBlob, baseName, progressDialog } from './ui.js';
import { renderToCanvas, parseRanges } from './pdfio.js';
import { TESSERACT_SRC, TESSERACT_LANG_PATH } from './config.js';

export const LANGS = [
  ['eng', 'English'], ['hin', 'Hindi (हिन्दी)'], ['mal', 'Malayalam (മലയാളം)'], ['tam', 'Tamil (தமிழ்)'], ['tel', 'Telugu (తెలుగు)'], ['kan', 'Kannada (ಕನ್ನಡ)'],
  ['ben', 'Bengali (বাংলা)'], ['mar', 'Marathi (मराठी)'], ['guj', 'Gujarati (ગુજરાતી)'], ['pan', 'Punjabi (ਪੰਜਾਬੀ)'], ['urd', 'Urdu (اردو)'], ['ara', 'Arabic (العربية)'],
  ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['por', 'Portuguese'], ['ita', 'Italian'], ['rus', 'Russian'], ['chi_sim', 'Chinese (Simplified)'], ['jpn', 'Japanese'], ['kor', 'Korean'],
];

let tesseractPromise = null;
export function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractPromise) {
    tesseractPromise = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = TESSERACT_SRC; s.crossOrigin = 'anonymous';
      s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error('OCR engine did not start')));
      s.onerror = () => { tesseractPromise = null; rej(new Error(navigator.onLine ? 'Could not download the OCR engine. Check your internet connection and try again.' : 'You are offline. OCR needs a one-time download: while online, open Offline → “Download for offline use”.')); };
      document.head.append(s);
    });
  }
  return tesseractPromise;
}

/** Downloads everything OCR needs (engine, core, language data) by running a tiny recognition once — all of it is then kept for offline use. */
export async function prepareOcr(langs = ['eng', 'hin'], onProgress) {
  const T = await loadTesseract();
  const worker = await T.createWorker(langs.join('+'), 1, { logger: m => { if (onProgress && m && typeof m.progress === 'number') onProgress(m.progress, labelFor(m.status)); } });
  try {
    const c = document.createElement('canvas'); c.width = 240; c.height = 70; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 240, 70); x.fillStyle = '#000'; x.font = '34px Arial'; x.fillText('Chumi 2026', 10, 48);
    await worker.recognize(c);
  } finally { await worker.terminate().catch(() => {}); }
}

/** Collect words/lines from a Tesseract result (works for v5 flat arrays and nested blocks). */
function collect(data) {
  let words = data.words, lines = data.lines;
  if ((!words || !words.length) && data.blocks) {
    words = []; lines = [];
    for (const b of data.blocks) for (const p of b.paragraphs || []) for (const l of p.lines || []) { lines.push(l); for (const w of l.words || []) words.push(w); }
  }
  return { words: words || [], lines: lines || [] };
}

/**
 * Runs OCR on the given pages of a document and stores the result in doc.pages[i].ocr.
 * onProgress(fraction, text)
 */
export async function runOcr(doc, pageIdxs, { langs = ['eng'], scale = 3, onProgress, shouldCancel } = {}) {
  onProgress && onProgress(0, 'Loading the OCR engine…');
  const T = await loadTesseract();
  let page = 0;
  const worker = await T.createWorker(langs.join('+'), 1, {
    ...(TESSERACT_LANG_PATH ? { langPath: TESSERACT_LANG_PATH } : {}),
    logger: m => { if (onProgress && m && typeof m.progress === 'number') onProgress((page + m.progress) / pageIdxs.length, `${labelFor(m.status)} (page ${pageIdxs[Math.min(page, pageIdxs.length - 1)] + 1})`); },
  });
  try {
    for (let k = 0; k < pageIdxs.length; k++) {
      if (shouldCancel && shouldCancel()) break;
      page = k; const i = pageIdxs[k];
      onProgress && onProgress(k / pageIdxs.length, `Preparing page ${i + 1}…`);
      const canvas = await renderToCanvas(doc.pdf, i, scale);
      const { data } = await worker.recognize(canvas);
      const { words, lines } = collect(data);
      const S = scale; const box = b => b ? { x: b.x0 / S, y: b.y0 / S, w: (b.x1 - b.x0) / S, h: (b.y1 - b.y0) / S } : null;
      const W = words.filter(w => w.text && w.text.trim() && w.bbox && (w.confidence == null || w.confidence > 10)).map(w => ({ text: w.text, conf: w.confidence, ...box(w.bbox) }));
      const L = lines.filter(l => l.text && l.text.trim() && l.bbox).map(l => ({ text: l.text.replace(/\s+$/, ''), ...box(l.bbox) }));
      doc.pages[i].ocr = { words: W, lines: L, text: (data.text || '').trim(), searchable: true, langs };
      canvas.width = canvas.height = 0;
    }
  } finally { await worker.terminate().catch(() => {}); }
  doc.dirty = true;
}
const labelFor = s => ({ 'loading tesseract core': 'Loading engine', 'initializing tesseract': 'Starting', 'loading language traineddata': 'Downloading language data', 'initializing api': 'Starting', 'recognizing text': 'Reading text' }[s] || 'Working');

/* ------------------------------------------------------------------ panel */
export function mountPanel(dv, el) {
  const doc = dv.doc;
  const chosen = new Set(['eng']);
  const langBox = h('div.lang-box', LANGS.map(([code, name]) => h('label.check', h('input', { type: 'checkbox', checked: code === 'eng', onchange: e => { e.target.checked ? chosen.add(code) : chosen.delete(code); } }), name)));
  const scope = select([['all', 'All pages'], ['current', 'Current page only'], ['range', 'Page range…']], 'all', v => { rangeIn.hidden = v !== 'range'; });
  const rangeIn = h('input.input', { type: 'text', placeholder: 'e.g. 1-3, 5', hidden: true });
  const quality = select([[2, 'Fast (144 dpi)'], [3, 'Balanced (216 dpi)'], [4, 'Best (288 dpi)']], 3);
  const searchable = h('input', { type: 'checkbox', checked: true, onchange: e => { doc.pages.forEach(p => { if (p.ocr) p.ocr.searchable = e.target.checked; }); } });
  const results = h('div.ocr-results');

  const start = button({ label: 'Start OCR', icon: 'ocr', kind: 'primary', onClick: async () => {
    if (!chosen.size) return toast('Choose at least one language.', 'error');
    let idx;
    try { idx = scope.value === 'all' ? [...Array(doc.numPages).keys()] : scope.value === 'current' ? [dv.viewer.current] : parseRanges(rangeIn.value, doc.numPages); } catch (e) { return toast(e.message, 'error'); }
    const p = progressDialog('Recognising text'); let cancelled = false;
    try {
      await runOcr(doc, idx, { langs: [...chosen], scale: +quality.value, onProgress: (f, t) => p.update(f, t), shouldCancel: () => cancelled });
      idx.forEach(i => dv.viewer.invalidate(i)); doc.emit('history'); showResults();
      toast(`Text recognised on ${idx.length} page${idx.length === 1 ? '' : 's'}. Use “Edit text” to correct any line.`, 'success', 6000);
    } catch (e) { console.error(e); toast(e.message || 'OCR failed', 'error', 9000); }
    finally { p.close(); }
  } });

  function showResults() {
    results.replaceChildren();
    const done = doc.pages.map((p, i) => [p, i]).filter(([p]) => p.ocr);
    if (!done.length) return;
    const all = done.map(([p, i]) => `— Page ${i + 1} —\n${p.ocr.text}`).join('\n\n');
    const ta = h('textarea.textarea.mono', { rows: 10, value: all, 'aria-label': 'Recognised text' });
    results.append(h('div.panel-sec', h('h3', `Recognised text · ${done.length} page${done.length === 1 ? '' : 's'}`),
      h('div.hero-actions',
        button({ label: 'Edit text on page', icon: 'edit-text', kind: 'primary', size: 'sm', onClick: () => dv.setTool('edittext') }),
        button({ label: 'Copy', icon: 'copy', size: 'sm', onClick: async () => { await navigator.clipboard.writeText(ta.value); toast('Text copied', 'success', 1500); } }),
        button({ label: 'Download .txt', icon: 'download', size: 'sm', onClick: () => downloadBlob(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }), baseName(doc.name) + '-ocr.txt') }),
        button({ label: 'Clear', kind: 'ghost', size: 'sm', onClick: () => { doc.pages.forEach((p, i) => { if (p.ocr) { p.ocr = null; dv.viewer.invalidate(i); } }); showResults(); } })),
      ta, h('p.hint', 'Corrections made here are for copying/exporting. To fix text inside the PDF, choose “Edit text on page” and click a line.')));
  }

  el.append(dv.panelHeader('Scan & OCR', 'Make scanned pages searchable and editable.'),
    h('div.panel-b',
      h('div.note-box', icon('info', 16), h('span', 'The OCR engine (about 3 MB, plus language data) downloads the first time you run this, then is cached by your browser. Your pages are processed on this device.')),
      field('Pages', scope), rangeIn, field('Accuracy', quality),
      h('div.field', h('label', 'Languages in the document'), langBox, h('div.hint', 'Pick every language that appears — e.g. English + Hindi for Aadhaar cards.')),
      h('label.check', searchable, ' Add a hidden text layer when saving (searchable PDF)'),
      start, results));
  showResults();
  return { refresh: showResults };
}
