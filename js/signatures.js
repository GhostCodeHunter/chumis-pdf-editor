// Digital signatures like Acrobat: status bar, on-page badges, Validate / View signed version / Compare / Properties,
// certificate viewer and a "trusted certificates" list (e.g. the CCA India root).
import { h, icon, button, toast, dialog, popupMenu, pickFiles, readBytes, withProgress } from './ui.js';
import { inspectSignatures, parseCertFile, fingerprint, describeSigner } from './sigcheck.js';
import { openPdfJs, destroyPdf, renderToCanvas, canvasToBytes, PDFLib, pdfjsLib } from './pdfio.js';
import { pageGeom } from './bake.js';
import { renderCleanField } from './fieldmark.js';
import { trustArgs } from './trustbundle.js';

/* ------------------------------------------------------------------ trusted certificates (stored on this device only) */
const KEY = 'chumi.trust.v1';
const entries = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const b64 = bytes => { let s = ''; bytes.forEach(b => (s += String.fromCharCode(b))); return btoa(s); };
const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
export function loadTrusted() { return entries().map(e => { try { return parseCertFile(unb64(e.b64)); } catch { return null; } }).filter(Boolean); }
export function trustList() { return entries(); }
export async function addTrusted(cert) {
  const fp = await fingerprint(cert.der); const list = entries().filter(e => e.fp !== fp);
  list.push({ fp, name: cert.subject.CN || cert.subject.O || 'Certificate', issuer: cert.issuer.CN || cert.issuer.O || '', b64: b64(cert.der), added: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { toast('Could not save the trusted certificate on this device.', 'error'); }
}
export function removeTrusted(fp) { try { localStorage.setItem(KEY, JSON.stringify(entries().filter(e => e.fp !== fp))); } catch {} }
export async function isTrusted(cert) { const fp = await fingerprint(cert.der); return entries().some(e => e.fp === fp); }

/* ------------------------------------------------------------------ helpers */
const fmt = d => (d ? d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDay = d => (d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
/** Acrobat's date style: 2026/09/19 19:15:18 +04'00' */
export const acroDate = d => { if (!d) return '—'; const p = n => String(n).padStart(2, '0'), o = -d.getTimezoneOffset(), a = Math.abs(o); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${o < 0 ? '-' : '+'}${p(Math.floor(a / 60))}'${p(a % 60)}'`; };
const nameOf = s => (s?.signer ? s.signer.subject.CN || s.signer.subject.pseudonym || s.signer.subject.O || 'Unknown signer' : 'Unknown signer');
export const STATUS = {
  valid: { cls: 'ok', ic: 'check-circle', short: 'Signature valid', head: n => `Signature is VALID, signed by ${n}.` },
  unknown: { cls: 'warn', ic: 'help', short: 'Signature validity unknown', head: () => 'Signature validity is UNKNOWN.' },
  invalid: { cls: 'bad', ic: 'x-circle', short: 'Signature invalid', head: () => 'Signature is INVALID.' },
};
const statusOf = s => (s.empty ? { cls: 'info', ic: 'help', short: 'Unsigned signature field', head: () => 'This signature field has not been signed.' } : STATUS[s.status] || STATUS.unknown);

/** Plain-language findings, worded like Acrobat's "Signature Validation Status". */
export function findings(s) {
  const L = [];
  if (s.digestOk === false) L.push(['bad', 'The document has been altered or corrupted since the signature was applied.']);
  else if (s.sigOk === false) L.push(['bad', 'The document content matches what was signed, but the signature itself does not verify against the signer’s certificate, so it cannot be relied on.']);
  else if (s.sigOk === true && s.modifiedAfter) L.push(['warn', 'The signature itself is intact, but the file was changed after it was applied (later edits or another signature). Use “Compare Signed Version to Current Version” to see what changed.']);
  else if (s.sigOk === true) L.push(['ok', 'The document has not been modified since this signature was applied.']);
  else L.push(['warn', 'The signature value could not be checked.']);
  if (s.chainTrusted) L.push(['ok', s.chainBuiltin ? `The signer’s identity is valid: its certificate chain leads to ${(s.chain[s.chain.length - 1].subject.CN) || 'a trusted root'}, a root certificate built into this app (India’s Controller of Certifying Authorities).` : `The signer’s identity is valid: its certificate chain leads to a certificate you trust (${(s.chain[s.chain.length - 1].subject.CN) || 'trusted root'}).`]);
  else L.push(['warn', 'The signer’s identity is unknown because it has not been included in your list of trusted certificates and none of its parent certificates are trusted certificates.']);
  if (s.signer?.selfSigned) L.push(['warn', 'The certificate is self-signed — anyone can create one.']);
  if (s.expired) L.push(['warn', 'A certificate in the chain was outside its validity period at the time of signing.']);
  for (const p of s.chainProblems || []) if (!s.chainTrusted) L.push(['warn', p]);
  for (const p of s.problems || []) if (!/Content was added/.test(p) && !/no longer matches/.test(p) && !/does not match/.test(p)) L.push(['warn', p]);
  L.push(['info', s.signTimeFromSignature ? 'Signing time is from the clock on the signer’s computer.' : 'Signing time is from the clock on the signer’s computer (the file’s own date field).']);
  L.push(['info', `Signature was validated as of the signing time: ${acroDate(s.signTime)}.`]);
  L.push(['info', 'Certificate revocation (CRL / OCSP) is not checked — a browser can’t reach the issuing authority’s servers.']);
  return L;
}
const row = ([k, t]) => h('li.sg-line.' + k, icon(k === 'ok' ? 'check-circle' : k === 'bad' ? 'x-circle' : k === 'warn' ? 'alert-circle' : 'info', 18), h('span', t));

/* ------------------------------------------------------------------ dialogs */
export function validationDialog(dv, s) {
  const st = statusOf(s);
  const d = dialog({
    title: 'Signature Validation Status', width: 560,
    body: h('div.sg-status', h('div.sg-head.' + st.cls, icon(st.ic, 26), h('strong', st.head(nameOf(s)))), h('ul.sg-lines', findings(s).map(row)),
      !s.chainTrusted && s.chain?.length ? h('p.hint', 'If you know and trust the issuer, you can add its certificate (usually the root) to your trusted list in the certificate viewer.') : null),
    actions: [
      button({ label: 'Signature Properties…', onClick: () => { d.close(); propertiesDialog(dv, s); } }),
      button({ label: 'Close', kind: 'primary', onClick: () => d.close() })],
  });
}

/** Re-validates (with the current trusted list) and shows Acrobat's “Signature Validation Status” — what Validate Signature does. */
export async function validateAgain(dv, s) {
  try { await dv.sigApi?.revalidate(); } catch (e) { console.warn(e); }
  validationDialog(dv, dv.sigApi?.sigs.find(x => x.index === s.index) || s);
}

/** Acrobat's “Signature Properties”: validity summary, signer info, and the Show Signer's Certificate / Advanced Properties / Validate Signature buttons. */
export function propertiesDialog(dv, s) {
  const st = statusOf(s);
  const info = [['Signed by', describeSigner(s.signer) || '—'], ['Date', acroDate(s.signTime)], ['Reason', s.info?.reason || '—'], ['Location', s.info?.location || '—']];
  const d = dialog({
    title: 'Signature Properties', width: 620,
    body: h('div', h('div.sg-head.' + st.cls, icon(st.ic, 22), h('strong', st.head(nameOf(s)))),
      h('h4.sg-sub', 'Signature Validity Summary'), h('ul.sg-lines', findings(s).map(row)),
      h('h4.sg-sub', 'Signer Information'), h('dl.vf-dl', info.map(([k, v]) => [h('dt', k), h('dd', v)]))),
    actions: [
      button({ label: 'Show Signer’s Certificate…', icon: 'certificate', onClick: () => { d.close(); certificateDialog(dv, s); } }),
      button({ label: 'Advanced Properties…', onClick: () => { d.close(); advancedDialog(dv, s); } }),
      button({ label: 'Validate Signature', icon: 'check-circle', onClick: () => { d.close(); validateAgain(dv, s); } }),
      button({ label: 'Close', kind: 'primary', onClick: () => d.close() })],
  });
}

const tabStrip = (names, onPick) => { const bar = h('div.cv-tabs', { role: 'tablist' }); names.forEach((n, i) => bar.append(h('button.cv-tab', { type: 'button', role: 'tab', 'aria-selected': String(i === 0), onclick: e => { bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b === e.currentTarget))); onPick(n); } }, n))); return bar; };
const dl = rows => h('dl.vf-dl', rows.map(([k, v]) => [h('dt', k), h('dd', v)]));
const HASH_NAME = { 'SHA-1': 'SHA1', 'SHA-256': 'SHA256', 'SHA-384': 'SHA384', 'SHA-512': 'SHA512' };

/** Acrobat's “Signature Properties” → Advanced Properties (Summary / Date/Time / Legal). */
export function advancedDialog(dv, s) {
  const body = h('div.cv-body');
  const algo = (s.algorithm || '').split(' with ');
  const views = {
    'Summary': () => dl([['Signed by', describeSigner(s.signer) || '—'], ['Hash algorithm', HASH_NAME[algo[0]] || algo[0] || '—'], ['Signature algorithm', algo[1] || '—'], ['Signature type', 'Approval signature'], ['Signature format', s.format || '—'], ['Reason', s.info?.reason || '—'], ['Location', s.info?.location || '—']]),
    'Date/Time': () => dl([['Signing time', acroDate(s.signTime)], ['Source of the signing time', s.signTimeFromSignature ? 'The clock on the signer’s computer (signed attribute)' : 'The signature field’s date entry'], ['Validated as of', acroDate(s.signTime)], ['Document timestamp', 'None']]),
    'Legal': () => h('p.hint', 'No legal notice or certification restrictions were found in this signature.'),
  };
  const show = n => body.replaceChildren(views[n]());
  const d = dialog({ title: 'Signature Properties — Advanced', width: 560, body: h('div', tabStrip(Object.keys(views), show), body), actions: [button({ label: 'Close', kind: 'primary', onClick: () => d.close() })] });
  show('Summary');
}

/** Acrobat's “Import Contact Settings”: choose how a certificate is trusted. */
function trustDialog(dv, c, done) {
  const root = h('input', { type: 'checkbox', checked: true, id: 'tr-root' });
  const signed = h('input', { type: 'checkbox', checked: true, disabled: true, id: 'tr-signed' });
  const fp = h('code.hint', '…'); fingerprint(c.der, 'SHA-256').then(v => (fp.textContent = v));
  const d = dialog({
    title: 'Import Contact Settings', width: 560,
    body: h('div', dl([['Subject', describeSigner({ subject: c.subject })], ['Issuer', c.selfSigned ? 'Same as subject (self-signed)' : describeSigner({ subject: c.issuer })], ['Valid to', fmtDay(c.notAfter)], ['SHA-256 fingerprint', fp]]),
      h('h4.sg-sub', 'Trust'), h('label.cv-check', root, h('span', 'Use this certificate as a trusted root')),
      h('p.hint', 'If signature validation succeeds, trust this certificate for:'), h('label.cv-check', signed, h('span', 'Signed documents or data')),
      h('p.hint', 'Only trust a certificate whose fingerprint you have confirmed with the issuer. India’s CCA roots are already built in.')),
    actions: [button({ label: 'Cancel', onClick: () => d.close() }), button({ label: 'OK', kind: 'primary', onClick: async () => { d.close(); if (root.checked) { await addTrusted(c); toast('Certificate added to your trusted identities.', 'success'); } done && done(); } })],
  });
}

/** Acrobat's Certificate Viewer: a certificate path on the left; Summary / Details / Revocation / Trust / Policies / Legal Notice on the right. */
export async function certificateDialog(dv, s) {
  const chain = s.chain || (s.signerCert ? [s.signerCert] : []); if (!chain.length) return toast('No certificate is embedded in this signature.', 'error');
  const detail = h('div.cv-body'); const list = h('div.cert-list', { role: 'listbox' });
  let current = 0, tab = 'Summary';
  const nm = o => Object.entries(o).map(([k, v]) => `${k} = ${v}`).join(', ') || '—';
  const sigName = o => ({ '1.2.840.113549.1.1.11': 'SHA-256 with RSA', '1.2.840.113549.1.1.5': 'SHA-1 with RSA', '1.2.840.113549.1.1.12': 'SHA-384 with RSA', '1.2.840.113549.1.1.13': 'SHA-512 with RSA', '1.2.840.113549.1.1.10': 'RSASSA-PSS' }[o] || o);
  const label = c => { const n = c.subject; return `${n.CN || n.pseudonym || n.O || 'Certificate'}${n.email ? ` <${n.email}>` : ''}`; };
  const views = {
    'Summary': async c => dl([['Subject', label(c)], ['Issuer', c.selfSigned ? label(c) : (c.issuer.CN || c.issuer.O || '—')], ['Valid from', acroDate(c.notBefore)], ['Valid to', acroDate(c.notAfter)], ['Intended usage', c.keyUsage.join(', ') || '—'], ['Certificate authority', c.isCA ? 'Yes' : 'No']]),
    'Details': async c => dl([['Version', 'V' + c.version], ['Serial number', c.serial.toUpperCase()], ['Signature algorithm', sigName(c.sigAlg)], ['Issuer', c.selfSigned ? 'Same as subject (self-signed)' : nm(c.issuer)], ['Valid from', acroDate(c.notBefore)], ['Valid to', acroDate(c.notAfter)], ['Subject', nm(c.subject)], ['Public key', c.keyAlg === '1.2.840.113549.1.1.1' ? `RSA (${c.keyBits} bits)` : c.keyAlg], ['Key usage', c.keyUsage.join(', ') || '—'], ['SHA-1 digest', await fingerprint(c.der, 'SHA-1')], ['SHA-256 digest', await fingerprint(c.der, 'SHA-256')]]),
    'Revocation': async c => h('div', h('p', icon('info', 14), ' Revocation checking was not performed. A web browser cannot reach the certificate authority’s servers, so CRL and OCSP answers are not consulted.'),
      dl([['CRL distribution points', c.crlUrls.join('\n') || 'None listed'], ['OCSP responder', c.ocspUrls.join('\n') || 'None listed'], ['Issuer certificate', c.caIssuerUrls.join('\n') || 'None listed']]), h('p.hint', 'As in Acrobat, revocation is not checked on or above a trust anchor.')),
    'Trust': async c => {
      const mine = await isTrusted(c), built = !!c.builtin, i = chain.indexOf(c), anchor = s.chainTrusted && i === s.chain.length - 1;
      return h('div', h('p', icon(s.chainTrusted ? 'check-circle' : 'alert-circle', 14), ' ', s.chainTrusted ? 'The selected certificate path is valid.' : 'The selected certificate path is not valid: it does not lead to a trusted certificate.'),
        c.selfSigned ? h('p', 'This is a self-signed certificate.') : null,
        h('p.hint', `The path validation checks were done as of the signing time: ${acroDate(s.signTime)}`),
        h('h4.sg-sub', 'Trust Settings'),
        h('p', built ? 'Trusted root built into this app (India’s Controller of Certifying Authorities and licensed CAs).' : mine ? 'Trusted by you as a root, for signed documents or data.' : anchor ? 'Trusted.' : 'This certificate is not in your list of trusted identities.'),
        built ? null : button({ label: mine ? 'Remove from Trusted Identities' : 'Add to Trusted Identities…', kind: mine ? 'secondary' : 'primary', size: 'sm', onClick: async () => { if (mine) { removeTrusted(await fingerprint(c.der)); toast('Removed from your trusted identities.', 'info'); await dv.sigApi?.revalidate(); d.close(); validationDialog(dv, dv.sigApi?.sigs.find(x => x.index === s.index) || s); } else trustDialog(dv, c, async () => { await dv.sigApi?.revalidate(); d.close(); validationDialog(dv, dv.sigApi?.sigs.find(x => x.index === s.index) || s); }); } }));
    },
    'Policies': async c => c.policies.length ? dl(c.policies.map((o, k) => [`Policy ${k + 1}`, o])) : h('p.hint', 'This certificate lists no certificate policies.'),
    'Legal Notice': async () => h('p.hint', 'No legal notice is included in this certificate.'),
  };
  const show = async () => { detail.replaceChildren(await views[tab](chain[current])); };
  const pick = i => { current = i; list.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); return show(); };
  chain.forEach((c, i) => list.append(h('button.cert-item', { type: 'button', style: { paddingLeft: 10 + i * 14 + 'px' }, onclick: () => pick(i) }, icon('certificate', 16), h('span', c.subject.CN || c.subject.O || 'Certificate'))));
  const d = dialog({ title: 'Certificate Viewer', width: 820, body: h('div.cert-grid', list, h('div', tabStrip(Object.keys(views), n => { tab = n; show(); }), detail)), actions: [button({ label: 'Close', kind: 'primary', onClick: () => d.close() })] });
  await pick(0);
}

export async function viewSigned(dv, s) {
  const len = s.signedLength; if (!len) return;
  if (!s.modifiedAfter && dv.doc.bytes === dv.doc.originalBytes) return toast('This file is already exactly the signed version — nothing was added after signing.', 'info', 5000);
  const bytes = dv.doc.originalBytes.slice(0, len);
  await dv.app.openBytes(dv.doc.name.replace(/\.pdf$/i, '') + ` (signed version ${s.index}).pdf`, bytes);
}

export async function compareDialog(dv, s) {
  const cur = dv.doc.bytes;
  if (!s.modifiedAfter && cur === dv.doc.originalBytes) return toast('No changes since signing — the signed version and the current version are identical.', 'success', 5000);
  const signed = dv.doc.originalBytes.slice(0, s.signedLength);
  let A, B;
  try { A = (await openPdfJs(signed, { askPassword: false })).pdf; B = (await openPdfJs(cur, { askPassword: false })).pdf; } catch (e) { return toast('Could not open the signed version: ' + e.message, 'error'); }
  const mk = t => h('div.cmp-col', h('div.cmp-h', t), h('div.cmp-body'));
  const colA = mk('Signed version'), colB = mk('Current version'), colD = mk('Differences');
  const info = h('span.hint'); let page = 0; const max = Math.max(A.numPages, B.numPages);
  const pgLabel = h('strong'); const prev = button({ icon: 'chev-left', kind: 'ghost', title: 'Previous page', onClick: () => go(page - 1) }); const next = button({ icon: 'chev-right', kind: 'ghost', title: 'Next page', onClick: () => go(page + 1) });
  async function go(p) {
    page = Math.max(0, Math.min(max - 1, p)); pgLabel.textContent = `Page ${page + 1} of ${max}`; prev.disabled = page === 0; next.disabled = page === max - 1;
    const body = c => c.querySelector('.cmp-body');
    [colA, colB, colD].forEach(c => body(c).replaceChildren(h('span.hint', 'Rendering…')));
    const ca = page < A.numPages ? await renderToCanvas(A, page, 0.9) : null, cb = page < B.numPages ? await renderToCanvas(B, page, 0.9) : null;
    body(colA).replaceChildren(ca || h('span.hint', 'This page does not exist in the signed version.')); body(colB).replaceChildren(cb || h('span.hint', 'This page does not exist in the current version.'));
    if (ca && cb) {
      const W = Math.min(ca.width, cb.width), H = Math.min(ca.height, cb.height); const da = ca.getContext('2d').getImageData(0, 0, W, H), db = cb.getContext('2d').getImageData(0, 0, W, H);
      const out = document.createElement('canvas'); out.width = cb.width; out.height = cb.height; const ctx = out.getContext('2d'); ctx.drawImage(cb, 0, 0); ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.fillRect(0, 0, out.width, out.height);
      const ov = ctx.getImageData(0, 0, W, H); let n = 0;
      for (let i = 0; i < da.data.length; i += 4) { if (Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]) > 60) { ov.data[i] = 220; ov.data[i + 1] = 30; ov.data[i + 2] = 30; ov.data[i + 3] = 255; n++; } }
      ctx.putImageData(ov, 0, 0); body(colD).replaceChildren(out);
      info.textContent = n ? `${n.toLocaleString()} pixels differ on this page.` : 'No visible differences on this page.';
    } else { body(colD).replaceChildren(h('span.hint', 'Pages differ in number.')); info.textContent = ''; }
  }
  const d = dialog({ title: 'Compare signed version to current version', width: 1180, onClose: () => { destroyPdf(A); destroyPdf(B); },
    body: h('div', h('div.cmp-bar', prev, pgLabel, next, info), h('div.cmp-grid', colA, colB, colD)), actions: [button({ label: 'Close', kind: 'primary', onClick: () => d.close() })] });
  go(0);
}

/* ------------------------------------------------------------------ context menu (as in Acrobat) */
export function signatureMenu(dv, s, anchor) {
  popupMenu(anchor, [
    { label: 'Validate Signature', icon: 'check-circle', onClick: () => validateAgain(dv, s) },
    '-',
    { label: 'View Signed Version', icon: 'history', onClick: () => viewSigned(dv, s) },
    { label: 'Compare Signed Version to Current Version', icon: 'compare', onClick: () => compareDialog(dv, s) },
    '-',
    { label: 'Show Signature Properties…', icon: 'info', onClick: () => propertiesDialog(dv, s) },
  ]);
}

/* ------------------------------------------------------------------ on-page badges + status bar */
async function findWidgets(dv, sigs) {
  const { PDFDocument, PDFName, PDFDict } = PDFLib; const pdf = dv.doc.pdf; const widgets = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1); const vp = page.getViewport({ scale: 1 });
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== 'Widget' || a.fieldType !== 'Sig') continue;
      const [ta, tb, tc, td, te, tf] = vp.transform; const ap = (x, y) => [ta * x + tc * y + te, tb * x + td * y + tf]; const p1 = ap(a.rect[0], a.rect[1]), p2 = ap(a.rect[2], a.rect[3]);
      widgets.push({ page: i, name: a.fieldName, x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]) });
    }
  }
  try {
    const lib = await PDFDocument.load(dv.doc.originalBytes, { updateMetadata: false, ignoreEncryption: true }); // password-protected files (e-Aadhaar, e-PAN) keep the structure readable
    for (const f of lib.getForm().getFields()) {
      if (!(f instanceof PDFLib.PDFSignature)) continue;
      const v = f.acroField.dict.lookup(PDFName.of('V')); if (!(v instanceof PDFDict)) continue;
      const br = v.lookup(PDFName.of('ByteRange')); if (!br) continue; const nums = br.asArray().map(n => n.asNumber());
      const sig = sigs.find(s => s.byteRange.every((n, k) => n === nums[k])); const w = widgets.find(x => x.name === f.getName());
      if (sig && w) sig.widget = w;
    }
  } catch { /* fall back to simple pairing below */ }
  if (sigs.length === 1 && !sigs[0].widget && widgets.length === 1) sigs[0].widget = widgets[0];
}

export async function attach(dv) {
  const doc = dv.doc; if (doc.originalBytes !== doc.bytes) return;
  let sigs; try { sigs = await inspectSignatures(doc.originalBytes, await trustArgs(loadTrusted())); } catch (e) { console.warn(e); return; }
  doc.sigs = sigs;
  const api = dv.sigApi = {
    sigs,
    clear() { dv.sigBarEl.hidden = true; dv.sigBarEl.replaceChildren(); dv.viewer.pages.forEach(p => p.sigEl.replaceChildren()); dv.railEl.querySelector('[data-id=signatures]')?.classList.remove('has-badge'); doc.sigs = []; },
    async revalidate() { doc.sigs = api.sigs = await inspectSignatures(doc.originalBytes, await trustArgs(loadTrusted())); try { await findWidgets(dv, api.sigs); } catch {} render(); dv.panelApi?.refresh?.(); },
    render: () => render(),
  };
  if (!sigs.length) return;
  try { await findWidgets(dv, sigs); } catch (e) { console.warn('signature fields not located', e); }
  dv.viewer.addEventListener('built', () => render());
  dv.viewer.addEventListener('rendered', () => render());
  dv.railEl.querySelector('[data-id=signatures]')?.classList.add('has-badge');
  render();

  function overall() {
    const real = api.sigs.filter(s => !s.empty); if (!real.length) return { cls: 'info', ic: 'info', text: 'This document has an empty signature field.' };
    if (real.some(s => s.status === 'invalid')) return { cls: 'bad', ic: 'x-circle', text: 'At least one signature is invalid — the document may have been altered.' };
    if (real.every(s => s.status === 'valid' && !s.modifiedAfter)) return { cls: 'ok', ic: 'check-circle', text: 'Signed and all signatures are valid.' };
    if (real.some(s => s.modifiedAfter)) return { cls: 'warn', ic: 'alert-circle', text: 'Signed, but the file was changed after signing. Check what changed before relying on it.' };
    return { cls: 'warn', ic: 'help', text: 'Signed and not changed since signing, but the signer’s identity is unknown (the issuer is not in your trusted list).' };
  }
  function render() {
    const o = overall(); const bar = dv.sigBarEl; bar.hidden = false; bar.className = 'dv-sigbar ' + o.cls;
    bar.replaceChildren(icon(o.ic, 20), h('span', o.text), h('span.grow'), button({ label: 'Signature Panel', size: 'sm', onClick: () => dv.openPanel('signatures') }), button({ icon: 'close', size: 'sm', kind: 'ghost', title: 'Hide this bar', onClick: () => (bar.hidden = true) }));
    dv.viewer.pages.forEach(p => p.sigEl.replaceChildren());
    for (const s of api.sigs) {
      const w = s.widget; if (!w || w.w < 4 || w.h < 4) continue; const st = statusOf(s); const info = dv.viewer.pages[w.page]; if (!info) continue;
      const b = h('button.sig-badge.' + st.cls, { type: 'button', style: { left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px' }, title: `${st.short} — click to validate, right-click for more`, 'aria-label': `${st.short}. Validate signature. Context menu for more options.`, 'aria-haspopup': 'menu' },
        h('span.sig-mark', icon(st.ic, 20)));
      fieldSkin(dv, info, w, s).then(skin => { if (skin && b.isConnected) { b.classList.add('skinned'); b.replaceChildren(skin); } }).catch(e => console.warn('signature look', e));
      b.addEventListener('click', e => { e.stopPropagation(); validateAgain(dv, s); });   // like Acrobat: clicking a signature validates it; the menu is on right-click
      b.addEventListener('contextmenu', e => { e.preventDefault(); signatureMenu(dv, s, { getBoundingClientRect: () => ({ left: e.clientX, bottom: e.clientY }) }); });
      info.sigEl.append(b);
    }
  }
}


/* ------------------------------------------------------------------ Adobe-style signature appearance */
const SVGNS = 'http://www.w3.org/2000/svg';
const MARKS = { // flat colour, heavy black outline, hard black shadow to the lower right (the Acrobat look); points are in a 0–100 box
  ok: { pts: '85.6,0 40.2,74.9 32.2,74.9 9.8,49.1 0,61.7 37.9,99.4 99.4,11.4', fill: '#00b03a', label: 'Signature valid' },
  bad: { pts: '12,28 28,12 50,34 72,12 88,28 66,50 88,72 72,88 50,66 28,88 12,72 34,50', fill: '#e0231d', label: 'Signature invalid' },
  warn: { pts: '50,4 99,94 1,94', fill: '#f5b400', label: 'Valid, but changed after signing' },
};
function glyph(kind) {
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', '-4 -4 116 116'); svg.setAttribute('class', 'sig-glyph ' + kind);
  const { pts, fill } = MARKS[kind];
  const poly = (attrs, parent) => { const p = document.createElementNS(SVGNS, 'polygon'); p.setAttribute('points', pts); for (const k in attrs) p.setAttribute(k, attrs[k]); parent.append(p); };
  const sh = document.createElementNS(SVGNS, 'g'); sh.setAttribute('transform', 'translate(5.5 4.5)'); poly({ fill: '#000', stroke: '#000', 'stroke-width': 5.2, 'stroke-linejoin': 'round' }, sh); svg.append(sh);
  poly({ fill: '#000', stroke: '#000', 'stroke-width': 5.2, 'stroke-linejoin': 'round' }, svg);   // outline
  poly({ fill }, svg);                                                                               // the green shape
  if (kind === 'warn') { const r = document.createElementNS(SVGNS, 'path'); r.setAttribute('d', 'M46 38h8l-1.5 30h-5zM46.5 74h7v8h-7z'); r.setAttribute('fill', '#000'); svg.append(r); }
  return svg;
}

/**
 * Many government signers draw a fallback look inside the signature field: a "Signature Not Verified" line and a yellow “?”.
 * Acrobat replaces it with its own result. This copy of the field has the yellow “?” removed, so the result can be drawn over it.
 */
function cleanedField(info, w) {
  try {
    const c = info.canvas; if (!c || !c.width) return null;
    const sx = c.width / info.w;
    const x0 = Math.max(0, Math.floor(w.x * sx)), y0 = Math.max(0, Math.floor(w.y * sx));
    const W = Math.min(c.width - x0, Math.ceil(w.w * sx)), H = Math.min(c.height - y0, Math.ceil(w.h * sx)); if (W < 8 || H < 8) return null;
    const img = c.getContext('2d').getImageData(x0, y0, W, H), d = img.data, mask = new Uint8Array(W * H); let n = 0;
    for (let i = 0, k = 0; i < d.length; i += 4, k++) if (d[i] > 200 && d[i + 1] > 140 && d[i] - d[i + 2] > 55 && d[i + 1] - d[i + 2] > 30) { mask[k] = 1; n++; }
    if (n < 12) return null; // no fallback “?” in this field: leave the file's own look alone
    const rad = 1, out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) out[yy * W + xx] = 1; }
    const bg = [d[0], d[1], d[2]].every(v => v > 235) ? [255, 255, 255] : [d[0], d[1], d[2]];
    for (let k = 0; k < out.length; k++) if (out[k]) { d[k * 4] = bg[0]; d[k * 4 + 1] = bg[1]; d[k * 4 + 2] = bg[2]; d[k * 4 + 3] = 255; }
    const oc = document.createElement('canvas'); oc.width = W; oc.height = H; oc.getContext('2d').putImageData(img, 0, 0); return oc;
  } catch { return null; }
}
/** Acrobat-style result drawn over the signature field: its wording in the top line and a large tick / cross / warning. */
const markKind = s => (s.status === 'invalid' ? 'bad' : s.status === 'valid' ? (s.modifiedAfter ? 'warn' : 'ok') : null);
/** The field without its fallback “?”: rendered from the page itself (nothing painted over); cached per field. */
function cleanFieldFor(dv, info, w) {
  const cache = (dv.sigApi._clean ||= new Map()), key = `${w.page}|${w.x.toFixed(1)}|${w.y.toFixed(1)}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    let c = null; try { c = await renderCleanField(dv.doc.pdf, w.page, w, 4); } catch (e) { console.warn('field render', e); }
    if (!c && info?.canvas?.width) c = cleanedField(info, w);   // last resort: recolour the “?” pixels in the visible page
    return c;
  })());
  return cache.get(key);
}
async function fieldSkin(dv, info, w, s) {
  const kind = markKind(s);
  if (!kind) return null; // “unknown” keeps the file's own “?” — which is what Acrobat shows too
  const oc = await cleanFieldFor(dv, info, w); if (!oc) return null;
  const label = MARKS[kind].label, size = Math.min(w.h * 0.7, w.w * 0.3), TOP = 0.31;
  const tick = (() => { const g = glyph(kind); const side = size * 1.16; g.style.width = g.style.height = side + 'px'; g.style.left = (w.w * 0.393 - size * 0.04) + 'px'; g.style.top = (w.h * 0.178 - size * 0.04) + 'px'; return g; })();
  const view = document.createElement('canvas'); view.width = oc.width; view.height = oc.height; view.getContext('2d').drawImage(oc, 0, 0); // own copy: the cached one is reused
  const text = h('div.sig-label', { style: { fontSize: Math.max(5, w.h * 0.2) + 'px' } }, label);
  if (!oc.layered) return h('div.sig-skin', view, text, tick);       // fallback: the field came as one picture, so the tick has to go on top
  view.style.clipPath = `inset(${TOP * 100}% 0 0 0)`;                // the file's own status line (“Signature Not Verified”) is replaced by the label
  return h('div.sig-skin.layered', tick, view, text);                // white field → tick → the field's text on top → label
}

/**
 * Printing: the validation result is drawn into the copy that goes to the printer (it is never written into the saved file).
 * Acrobat's own result marks are not part of a PDF, so without this a printout only shows the file's “Signature Not Verified”.
 */
export async function stampForPrint(dv, bytes) {
  try {
    const sigs = (dv.sigApi?.sigs || []).filter(x => x.widget && markKind(x)); if (!sigs.length) return bytes;
    const hex = c => { const n = parseInt(c.slice(1), 16); return PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
    const pdf = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    for (const s of sigs) {
      const w = s.widget, page = pdf.getPages()[w.page]; if (!page) continue;
      const kind = dv.doc.hasEdits() && s.status === 'valid' ? 'warn' : markKind(s);   // a printout that includes edits is not the signed document
      const oc = await cleanFieldFor(dv, dv.viewer.pages[w.page], w); if (!oc) continue;  // no fallback look in this field: print it as it is
      try { const form = pdf.getForm(), f = form.getFields().find(x => x instanceof PDFLib.PDFSignature && x.getName() === w.name); if (f) form.removeField(f); } catch {} // viewers draw a field's own look above the page, so it has to go for the marks to show
      const img = await pdf.embedPng(await canvasToBytes(oc, 'image/png'));
      const g = pageGeom(page), Y = y => g.H - y, M = MARKS[kind];
      page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(...g.m));
      const size = Math.min(w.h * 0.7, w.w * 0.3), k = size / 100, ox = w.x + w.w * 0.393, oy = w.y + w.h * 0.178, path = 'M' + M.pts.split(' ').join(' L') + ' Z';
      const drawTick = () => {
        page.drawSvgPath(path, { x: ox + 5.5 * k, y: Y(oy + 4.5 * k), scale: k, color: PDFLib.rgb(0, 0, 0), borderColor: PDFLib.rgb(0, 0, 0), borderWidth: 5.2 * k, borderLineJoin: PDFLib.LineJoinStyle.Round });
        page.drawSvgPath(path, { x: ox, y: Y(oy), scale: k, color: PDFLib.rgb(0, 0, 0), borderColor: PDFLib.rgb(0, 0, 0), borderWidth: 5.2 * k, borderLineJoin: PDFLib.LineJoinStyle.Round });
        page.drawSvgPath(path, { x: ox, y: Y(oy), scale: k, color: hex(M.fill) });
        if (kind === 'warn') { page.drawRectangle({ x: ox + 46 * k, y: Y(oy + 68 * k), width: 8 * k, height: 30 * k, color: PDFLib.rgb(0, 0, 0) }); page.drawRectangle({ x: ox + 46.5 * k, y: Y(oy + 82 * k), width: 7 * k, height: 8 * k, color: PDFLib.rgb(0, 0, 0) }); }
      };
      const fs = w.h * 0.2, drawLabel = () => page.drawText(M.label, { x: w.x + w.w * 0.016, y: Y(w.y + w.h * 0.155) - fs * 0.35, size: fs, font, color: PDFLib.rgb(0, 0, 0) });
      page.drawRectangle({ x: w.x, y: Y(w.y + w.h), width: w.w, height: w.h, color: PDFLib.rgb(1, 1, 1) }); // the field's own look is covered
      if (oc.layered) {   // white → tick → the field's text above it → label
        drawTick();
        page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.rectangle(w.x, Y(w.y + w.h), w.w, w.h * 0.69), PDFLib.clip(), PDFLib.endPath());   // only below the label line
        page.drawImage(img, { x: w.x, y: Y(w.y + w.h), width: w.w, height: w.h }); page.pushOperators(PDFLib.popGraphicsState());
        drawLabel();
      } else { page.drawImage(img, { x: w.x, y: Y(w.y + w.h), width: w.w, height: w.h }); page.drawRectangle({ x: w.x, y: Y(w.y + w.h * 0.31), width: w.w, height: w.h * 0.31, color: PDFLib.rgb(1, 1, 1) }); drawLabel(); drawTick(); }
      page.pushOperators(PDFLib.popGraphicsState());
    }
    return await pdf.save({ useObjectStreams: true });
  } catch (e) { console.warn('Could not add the validation marks to the print copy', e); return bytes; }
}

/* ------------------------------------------------------------------ panel */
export function mountPanel(dv, el) {
  const list = h('div.sg-list'); const trust = h('div.sg-trust-list');
  const draw = () => {
    const sigs = dv.doc.sigs || []; list.replaceChildren();
    if (!sigs.length) list.append(h('div.note-box', icon('info', 16), h('span', dv.doc.originalBytes !== dv.doc.bytes ? 'The file has been changed in this session, so the signatures of the original file are no longer shown. Reopen the original file to validate them.' : 'This document has no digital signatures.')));
    sigs.forEach(s => {
      const st = statusOf(s);
      list.append(h('div.vf-card.sg-card', h('div.vf-card-h', icon(st.ic, 20), h('strong', `Signature ${s.index}`), h('span.pill.' + st.cls, st.short)),
        h('div.sg-who', nameOf(s)), h('div.hint', `${fmt(s.signTime)}${s.info?.reason ? ' · ' + s.info.reason : ''}`),
        s.modifiedAfter ? h('div.hint', icon('alert', 12), ' Changed after signing') : null,
        h('div.vf-actions',
          button({ label: 'Validate', icon: 'check-circle', size: 'sm', kind: 'primary', onClick: () => validateAgain(dv, s) }),
          button({ label: 'Properties', size: 'sm', onClick: () => propertiesDialog(dv, s) }),
          button({ label: 'View signed version', size: 'sm', onClick: () => viewSigned(dv, s) }),
          button({ label: 'Compare', size: 'sm', onClick: () => compareDialog(dv, s) }),
          s.page != null || s.widget ? button({ label: 'Go to signature', size: 'sm', kind: 'ghost', onClick: () => dv.viewer.scrollToRect(s.widget.page, s.widget.y, s.widget.h) }) : null)));
    });
    trust.replaceChildren();
    const t = trustList();
    trust.append(h('div.sg-trusted', icon('certificate', 18), h('div', h('strong', 'Built in: India’s Root CA (CCA India 2022 and earlier roots)'), h('div.hint', 'and the licensed CAs under them (e-Mudhra, (n)Code, NIC, Capricorn, …). Signatures chaining to these are valid automatically.'))));
    if (!t.length) trust.append(h('p.hint', 'Nothing added by you. Use “Import certificate” for any other authority you trust.'));
    t.forEach(e => trust.append(h('div.sg-trusted', icon('certificate', 18), h('div', h('strong', e.name), h('div.hint', e.fp.slice(0, 29) + '…')), button({ icon: 'trash', kind: 'ghost', size: 'sm', title: `Remove ${e.name} from trusted certificates`, onClick: async () => { removeTrusted(e.fp); await dv.sigApi?.revalidate(); draw(); } }))));
  };
  const importBtn = button({ label: 'Import certificate…', icon: 'import', size: 'sm', onClick: async () => {
    const [f] = await pickFiles({ accept: '.cer,.crt,.der,.pem', multiple: false }); if (!f) return;
    try { const c = parseCertFile(await readBytes(f)); const fp = await fingerprint(c.der); const ok = await new Promise(res => { const d = dialog({ title: 'Trust this certificate?', width: 520, body: h('div', h('p', `You are about to treat “${c.subject.CN || c.subject.O}” as trusted. Signatures that chain to it will show as valid.`), h('dl.vf-dl', [['Issuer', c.selfSigned ? 'Self-signed root' : c.issuer.CN || c.issuer.O || '—'], ['Valid to', fmtDay(c.notAfter)], ['SHA-256', fp]].map(([k, v]) => [h('dt', k), h('dd.mono', v)])), h('p.hint', 'Confirm this fingerprint with the issuer before trusting it.')), actions: [button({ label: 'Cancel', onClick: () => d.close(false) }), button({ label: 'Trust certificate', kind: 'primary', onClick: () => d.close(true) })], onClose: v => res(!!v) }); });
      if (ok) { await addTrusted(c); await dv.sigApi?.revalidate(); draw(); toast('Certificate added to your trusted list.', 'success'); } }
    catch (e) { toast('That file is not a readable certificate (.cer, .crt, .der or .pem).', 'error', 6000); }
  } });
  el.append(dv.panelHeader('Digital signatures', 'Validate who signed this document and whether it changed.'),
    h('div.panel-b', list,
      h('div.panel-sec', h('h3', 'Trusted certificates'), h('p.hint', 'Like Acrobat, a signature is “valid” only when its certificate chain leads to a certificate that is trusted. India’s CCA roots are built in; add any other authority yourself. Indian signatures chain to the Root CA of India (CCA); download its root certificate from cca.gov.in and import it here once.'), trust, importBtn,
        h('a.btn.btn-ghost.btn-sm', { href: 'https://cca.gov.in/root_certificate.html', target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), h('span', 'CCA India root certificates'))),
      h('div.note-box', icon('lock', 16), h('span', 'Trusted certificates are saved only in this browser. Validation happens on your device; revocation lists are not consulted.'))));
  draw();
  return { refresh: draw };
}
