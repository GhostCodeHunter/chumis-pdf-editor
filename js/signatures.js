// Digital signatures like Acrobat: status bar, on-page badges, Validate / View signed version / Compare / Properties,
// certificate viewer and a "trusted certificates" list (e.g. the CCA India root).
import { h, icon, button, toast, dialog, popupMenu, pickFiles, readBytes, withProgress } from './ui.js';
import { inspectSignatures, parseCertFile, fingerprint, describeSigner } from './sigcheck.js';
import { openPdfJs, destroyPdf, renderToCanvas, PDFLib, pdfjsLib } from './pdfio.js';

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
  if (s.chainTrusted) L.push(['ok', `The signer’s identity is valid: its certificate chain leads to a certificate you trust (${(s.chain[s.chain.length - 1].subject.CN) || 'trusted root'}).`]);
  else L.push(['warn', 'The signer’s identity is unknown because it has not been included in your list of trusted certificates and none of its parent certificates are trusted certificates.']);
  if (s.signer?.selfSigned) L.push(['warn', 'The certificate is self-signed — anyone can create one.']);
  if (s.expired) L.push(['warn', 'A certificate in the chain was outside its validity period at the time of signing.']);
  for (const p of s.chainProblems || []) if (!s.chainTrusted) L.push(['warn', p]);
  for (const p of s.problems || []) if (!/Content was added/.test(p) && !/no longer matches/.test(p) && !/does not match/.test(p)) L.push(['warn', p]);
  L.push(['info', `Signing time is taken from the signature: ${fmt(s.signTime)}.`]);
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

export function propertiesDialog(dv, s) {
  const st = statusOf(s);
  const rows = [['Status', st.short], ['Signed by', describeSigner(s.signer) || '—'], ['Date', fmt(s.signTime)], ['Reason', s.info?.reason || '—'], ['Location', s.info?.location || '—'],
    ['Method', s.algorithm || '—'], ['Format', s.format || '—'], ['Document fingerprint', s.digestOk === true ? 'Matches the signed fingerprint' : s.digestOk === false ? 'Does not match' : s.sigOk ? 'Covered by the signature value' : '—'], ['Signature value', s.sigOk === true ? 'Verified with the signer’s certificate' : s.sigOk === false ? 'Does not verify' : '—'], ['Signed part of file', s.signedLength ? `${s.signedLength.toLocaleString()} of ${s.fileLength.toLocaleString()} bytes` : '—'], ['Document changed since', s.modifiedAfter ? 'Yes' : s.sigOk ? 'No' : '—']];
  const d = dialog({
    title: 'Signature Properties', width: 560,
    body: h('div', h('div.sg-head.' + st.cls, icon(st.ic, 22), h('strong', st.head(nameOf(s)))), h('dl.vf-dl', rows.map(([k, v]) => [h('dt', k), h('dd', v)])), h('ul.sg-lines', findings(s).filter(x => x[0] !== 'info').map(row))),
    actions: [
      button({ label: 'Show Signer’s Certificate…', icon: 'certificate', onClick: () => { d.close(); certificateDialog(dv, s); } }),
      button({ label: 'View Signed Version', onClick: () => { d.close(); viewSigned(dv, s); } }),
      button({ label: 'Close', kind: 'primary', onClick: () => d.close() })],
  });
}

export async function certificateDialog(dv, s) {
  const chain = s.chain || (s.signerCert ? [s.signerCert] : []); if (!chain.length) return toast('No certificate is embedded in this signature.', 'error');
  const detail = h('div.cert-detail'); const list = h('div.cert-list', { role: 'listbox' });
  let current = 0;
  async function show(i) {
    current = i; list.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    const c = chain[i]; const trusted = await isTrusted(c); const [f1, f256] = [await fingerprint(c.der, 'SHA-1'), await fingerprint(c.der, 'SHA-256')];
    const nm = o => Object.entries(o).map(([k, v]) => `${k} = ${v}`).join(', ') || '—';
    const sigName = { '1.2.840.113549.1.1.11': 'SHA-256 with RSA', '1.2.840.113549.1.1.5': 'SHA-1 with RSA', '1.2.840.113549.1.1.12': 'SHA-384 with RSA', '1.2.840.113549.1.1.13': 'SHA-512 with RSA' }[c.sigAlg] || c.sigAlg;
    detail.replaceChildren(
      h('dl.vf-dl', [['Subject', nm(c.subject)], ['Issuer', c.selfSigned ? 'Same as subject (self-signed)' : nm(c.issuer)], ['Serial number', c.serial.toUpperCase()], ['Valid from', fmtDay(c.notBefore)], ['Valid to', fmtDay(c.notAfter)], ['Signature algorithm', sigName], ['Public key', c.keyBits ? `RSA ${c.keyBits}-bit` : c.keyAlg], ['SHA-1 fingerprint', f1], ['SHA-256 fingerprint', f256]].map(([k, v]) => [h('dt', k), h('dd.mono', v)])),
      h('div.sg-trust', trusted ? h('span.pill.ok', icon('check', 12), 'Trusted by you') : h('span.pill.warn', 'Not in your trusted list'),
        button({ label: trusted ? 'Remove trust' : 'Trust this certificate', size: 'sm', kind: trusted ? 'secondary' : 'primary', onClick: async () => { trusted ? removeTrusted(await fingerprint(c.der)) : await addTrusted(c); toast(trusted ? 'Removed from your trusted certificates.' : 'Added. Re-validating signatures…', 'success', 2500); await show(current); if (dv.sigApi) await dv.sigApi.revalidate(); } })),
      !trusted ? h('p.hint', 'Only trust a certificate whose fingerprint you have confirmed with the issuer — for Indian digital signatures, the CCA India root from cca.gov.in (it publishes a way to confirm the thumbprint).') : null);
  }
  chain.forEach((c, i) => list.append(h('button.cert-item', { type: 'button', style: { paddingLeft: 10 + i * 14 + 'px' }, onclick: () => show(i) }, icon('certificate', 16), h('span', c.subject.CN || c.subject.O || 'Certificate'))));
  const d = dialog({ title: 'Certificate Viewer', width: 760, body: h('div.cert-grid', list, detail), actions: [button({ label: 'Close', kind: 'primary', onClick: () => d.close() })] });
  await show(0);
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
    { label: 'Validate Signature', icon: 'check-circle', onClick: () => validationDialog(dv, s) },
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
    const lib = await PDFDocument.load(dv.doc.originalBytes, { updateMetadata: false });
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
  let sigs; try { sigs = await inspectSignatures(doc.originalBytes, { trusted: loadTrusted() }); } catch (e) { console.warn(e); return; }
  doc.sigs = sigs;
  const api = dv.sigApi = {
    sigs,
    clear() { dv.sigBarEl.hidden = true; dv.sigBarEl.replaceChildren(); dv.viewer.pages.forEach(p => p.sigEl.replaceChildren()); dv.railEl.querySelector('[data-id=signatures]')?.classList.remove('has-badge'); doc.sigs = []; },
    async revalidate() { doc.sigs = api.sigs = await inspectSignatures(doc.originalBytes, { trusted: loadTrusted() }); try { await findWidgets(dv, api.sigs); } catch {} render(); dv.panelApi?.refresh?.(); },
    render: () => render(),
  };
  if (!sigs.length) return;
  try { await findWidgets(dv, sigs); } catch (e) { console.warn('signature fields not located', e); }
  dv.viewer.addEventListener('built', () => render());
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
      const b = h('button.sig-badge.' + st.cls, { type: 'button', style: { left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px' }, title: `${st.short} — click for options`, 'aria-label': `${st.short}. Open signature options.`, 'aria-haspopup': 'menu' },
        h('span.sig-mark', icon(st.ic, 20)));
      b.addEventListener('click', e => { e.stopPropagation(); signatureMenu(dv, s, b); });
      b.addEventListener('contextmenu', e => { e.preventDefault(); signatureMenu(dv, s, { getBoundingClientRect: () => ({ left: e.clientX, bottom: e.clientY }) }); });
      info.sigEl.append(b);
    }
  }
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
          button({ label: 'Validate', icon: 'check-circle', size: 'sm', kind: 'primary', onClick: () => validationDialog(dv, s) }),
          button({ label: 'Properties', size: 'sm', onClick: () => propertiesDialog(dv, s) }),
          button({ label: 'View signed version', size: 'sm', onClick: () => viewSigned(dv, s) }),
          button({ label: 'Compare', size: 'sm', onClick: () => compareDialog(dv, s) }),
          s.page != null || s.widget ? button({ label: 'Go to signature', size: 'sm', kind: 'ghost', onClick: () => dv.viewer.scrollToRect(s.widget.page, s.widget.y, s.widget.h) }) : null)));
    });
    trust.replaceChildren();
    const t = trustList();
    if (!t.length) trust.append(h('p.hint', 'None yet. Signatures from Indian authorities show as “unknown” until you add the CCA India root certificate.'));
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
      h('div.panel-sec', h('h3', 'Trusted certificates'), h('p.hint', 'Like Acrobat, a signature is “valid” only when its certificate chain leads to a certificate you trust. Indian signatures chain to the Root CA of India (CCA); download its root certificate from cca.gov.in and import it here once.'), trust, importBtn,
        h('a.btn.btn-ghost.btn-sm', { href: 'https://cca.gov.in/root_certificate.html', target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), h('span', 'CCA India root certificates'))),
      h('div.note-box', icon('lock', 16), h('span', 'Trusted certificates are saved only in this browser. Validation happens on your device; revocation lists are not consulted.'))));
  draw();
  return { refresh: draw };
}
