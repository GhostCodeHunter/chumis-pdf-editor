// Verify documents panel: identifiers, checksums, consistency and digital-signature integrity — all on this device.
import { h, icon, button, toast, dialog, field, select, confirmDialog, progressDialog, downloadBlob, baseName, uid } from './ui.js';
import { getPageText } from './pdfio.js';
import { pageLines } from './extract.js';
import { scanText, aadhaarMaskBoxes, TYPES, PORTALS, DOC_LABELS, clean } from './validators.js';
import { inspectSignatures, describeSigner } from './sigcheck.js';
import { loadTrusted, validationDialog, STATUS } from './signatures.js';
import { trustArgs } from './trustbundle.js';
import { VERIFY_PROXY_URL } from './config.js';

const fmtDate = d => (d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—');
const pretty = (type, v) => (type === 'aadhaar' && /^\d{12}$/.test(v) ? v.replace(/(\d{4})(?=\d)/g, '$1 ') : v);
const maskA = v => 'XXXX XXXX ' + String(v).replace(/\D/g, '').slice(-4);

export function mountPanel(dv, el) {
  const doc = dv.doc; const out = h('div.vf-out'); let last = null;

  const scanBtn = button({ label: 'Scan this document', icon: 'shield-check', kind: 'primary', onClick: () => scan() });

  async function gatherText(p) {
    const pages = [];
    for (let i = 0; i < doc.numPages; i++) {
      p.update(i / doc.numPages, `Reading page ${i + 1}…`);
      const lines = await pageLines(doc, i); pages.push(lines.join('\n'));
    }
    return pages;
  }

  async function scan() {
    out.replaceChildren(); const p = progressDialog('Scanning document');
    let pages, sigs;
    try {
      pages = await gatherText(p);
      if (pages.join('').replace(/\s/g, '').length < 40) {
        p.close();
        const go = await confirmDialog({ title: 'This looks like a scanned picture', message: 'No readable text was found, so the numbers can’t be checked yet. Run OCR (English + Hindi) now? It needs an internet connection the first time and takes a few seconds per page.', confirmLabel: 'Run OCR' });
        if (!go) return;
        const p2 = progressDialog('Recognising text');
        try { const { runOcr } = await import('./ocr.js'); await runOcr(doc, [...Array(Math.min(doc.numPages, 6)).keys()], { langs: ['eng', 'hin'], scale: 3, onProgress: (f, t) => p2.update(f, t) }); doc.pages.forEach((_, i) => dv.viewer.invalidate(i)); pages = await gatherText(p2); }
        catch (e) { toast(e.message || 'OCR failed', 'error', 8000); return; } finally { p2.close(); }
      }
      sigs = await inspectSignatures(doc.originalBytes, await trustArgs(loadTrusted()));
    } catch (e) { console.error(e); toast('Scan failed: ' + e.message, 'error'); return; }
    finally { try { p.close(); } catch {} }
    last = { scan: scanText(pages), sigs, pages }; render();
  }

  /* ---------------------------------------------------------------- rendering */
  function pill(kind, text, ic) { return h('span.pill.' + kind, ic ? icon(ic, 12) : null, text); }
  function checkRow(c) { return h('li.vf-check' + (c.ok ? '.ok' : c.warn ? '.warn' : '.bad'), icon(c.ok ? 'check' : c.warn ? 'alert' : 'cross', 14), h('span', c.label, c.note ? h('em', ' — ' + c.note) : null)); }

  function findingCard(f) {
    const T = TYPES[f.type]; const reveal = { on: !(f.type === 'aadhaar') };
    const val = h('code.vf-val'); const paint = () => { val.textContent = f.masked ? f.value : reveal.on ? pretty(f.type, f.value) : maskA(f.value); };
    paint();
    const r = f.result; const status = f.masked ? pill('info', 'Masked', 'eye-off') : r.ok ? pill('ok', 'Format & checksum OK', 'check') : pill('bad', 'Failed checks', 'cross');
    const actions = h('div.vf-actions');
    if (f.type === 'aadhaar' && !f.masked) {
      actions.append(button({ label: reveal.on ? 'Hide' : 'Show', icon: reveal.on ? 'eye-off' : 'eye', size: 'sm', kind: 'ghost', onClick: e => { reveal.on = !reveal.on; paint(); e.currentTarget.querySelector('span').textContent = reveal.on ? 'Hide' : 'Show'; } }),
        button({ label: 'Mask on page', icon: 'redact', size: 'sm', title: 'Cover the first 8 digits with a permanent black box', onClick: () => maskOnPage(f) }));
    }
    const portal = PORTALS[f.type];
    if (portal) actions.append(h('a.btn.btn-secondary.btn-sm', { href: portal.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), h('span', 'Check on official site')));
    if (VERIFY_PROXY_URL) actions.append(button({ label: 'Check live', size: 'sm', kind: 'secondary', onClick: () => liveCheck(f) }));
    const LBL = { state: 'State', pan: 'PAN', entity: 'Entity no.', panType: 'PAN holder type', holder: 'Holder type', listed: 'Status', nic: 'Industry (NIC) code', year: 'Year of incorporation', ownership: 'Ownership', regNo: 'Registration no.' };
    const details = Object.entries(r.details || {}).filter(([k, v]) => v && k !== 'masked' && k !== 'initial').map(([k, v]) => `${LBL[k] || k}: ${v}`).join(' · ');
    return h('div.vf-card', h('div.vf-card-h', h('strong', T.label), status, f.possible ? pill('warn', 'Possible') : null, f.page != null ? h('span.hint', `p.${f.page + 1}`) : null), val,
      details ? h('div.hint', details) : null,
      h('details.vf-more', h('summary', 'See checks'), h('ul.vf-checks', r.checks.map(checkRow)), portal ? h('p.hint', portal.note) : null), actions);
  }

  function sigCard(s) {
    const st = s.empty ? { cls: 'info', short: 'Empty signature field' } : STATUS[s.status] || STATUS.unknown;
    const head = pill(st.cls, st.short, st.cls === 'ok' ? 'check' : st.cls === 'bad' ? 'cross' : 'alert');
    const rows = [];
    if (s.signer) rows.push(['Signed by', describeSigner(s.signer) || '—'], ['Issued by', describeSigner({ subject: s.signer.issuer }) || '—'], ['Certificate valid', `${fmtDate(s.signer.notBefore).split(' ').slice(0, 3).join(' ')} → ${fmtDate(s.signer.notAfter).split(' ').slice(0, 3).join(' ')}`], ['Signed on', fmtDate(s.signTime)], ['Method', s.algorithm || '—']);
    if (s.info?.reason) rows.push(['Reason', s.info.reason]); if (s.info?.location) rows.push(['Location', s.info.location]);
    const hard = s.problems.filter(t => /no longer matches|does not match|invalid|Content was added/i.test(t));
    return h('div.vf-card', h('div.vf-card-h', h('strong', `Signature ${s.index}`), head),
      rows.length ? h('dl.vf-dl', rows.map(([k, v]) => [h('dt', k), h('dd', v)])) : null,
      hard.length ? h('ul.vf-checks', hard.map(t => h('li.vf-check.bad', icon('cross', 14), h('span', t)))) : null,
      s.signer?.selfSigned ? h('p.hint', icon('alert', 12), ' This certificate is self-signed — anyone can create one. Treat it as unverified.') : null,
      !s.empty && !s.chainTrusted ? h('p.hint', 'The content check passed, but the signer’s identity is unknown until you trust the issuer’s certificate (see the Signatures panel).') : null,
      !s.empty ? h('div.vf-actions', button({ label: 'Validate Signature', icon: 'check-circle', size: 'sm', onClick: () => validationDialog(dv, s) })) : null);
  }

  function render() {
    const { scan: S, sigs } = last; out.replaceChildren();
    const types = S.docTypes.map(t => DOC_LABELS[t]).filter(Boolean);
    const anyBad = S.findings.some(f => !f.result.ok && !f.possible) || sigs.some(s => s.status === 'invalid') || S.crossChecks.some(c => !c.ok);
    out.append(h('div.vf-summary' + (anyBad ? '.warn' : ''), icon(anyBad ? 'alert-circle' : 'shield-check', 22), h('div', h('strong', types.length ? `Looks like: ${types.join(', ')}` : 'Document type not recognised'), h('span', `${S.findings.length} identifier${S.findings.length === 1 ? '' : 's'} · ${sigs.filter(s => !s.empty).length} signature${sigs.length === 1 ? '' : 's'}`), anyBad ? h('span', 'Some checks need your attention — see below.') : h('span', 'No problems found by the offline checks.'))));
    out.append(h('div.note-box', icon('info', 16), h('span', 'These are offline checks: they catch typos, impossible numbers and edited files. They cannot confirm that a number was really issued — use the official-site buttons for that.')));
    // identifiers
    const sec = (t, ...kids) => h('div.panel-sec', h('h3', t), ...kids);
    out.append(sec('Identifiers', ...(S.findings.length ? S.findings.map(findingCard) : [h('p.hint', 'No Aadhaar, PAN, GSTIN, CIN or similar numbers were found in the text of this document.')])));
    if (S.vid) out.append(h('p.hint', icon('info', 12), ' A 16-digit Virtual ID (VID) is printed on this document. Only UIDAI can validate a VID.'));
    const fe = Object.entries(S.fields);
    if (fe.length) out.append(sec('Details read from the document', h('dl.vf-dl', fe.map(([k, v]) => [h('dt', k), h('dd', v)])), h('p.hint', 'Read from the page text; scanned documents may contain recognition errors.')));
    if (S.crossChecks.length) out.append(sec('Consistency checks', h('ul.vf-checks', S.crossChecks.map(c => h('li.vf-check' + (c.neutral ? '.ok' : c.ok ? '.ok' : '.warn'), icon(c.neutral || c.ok ? 'check' : 'alert', 14), h('span', c.label, !c.ok && c.note ? h('em', ' — ' + c.note) : null))))));
    out.append(sec('Digital signatures', ...(sigs.length ? sigs.map(sigCard) : [h('div.vf-card', pill('warn', 'No digital signature'), h('p.hint', 'Genuine downloads of e-Aadhaar, GST registration certificates and MCA certificates are normally digitally signed by the issuing authority. An unsigned copy (for example a screenshot or a re-saved file) can’t be proven authentic — check it on the official site.'))])));
    out.append(h('div.hero-actions', button({ label: 'Copy report', icon: 'copy', size: 'sm', onClick: async () => { await navigator.clipboard.writeText(reportText()); toast('Report copied', 'success', 1500); } }),
      button({ label: 'Download report', icon: 'download', size: 'sm', onClick: () => downloadBlob(new Blob([reportText()], { type: 'text/plain;charset=utf-8' }), baseName(doc.name) + '-verification.txt') })));
    out.append(h('p.hint', 'The report hides all but the last 4 digits of Aadhaar numbers.'));
  }

  function reportText() {
    const { scan: S, sigs } = last; const L = [`Verification report — ${doc.name}`, `Created: ${new Date().toLocaleString()} (offline checks only)`, ''];
    L.push('IDENTIFIERS'); S.findings.forEach(f => { L.push(`- ${TYPES[f.type].label}: ${f.type === 'aadhaar' ? maskA(f.value) : f.value} → ${f.result.ok ? 'format/checksum OK' : 'FAILED'}`); f.result.checks.filter(c => !c.ok && !c.warn).forEach(c => L.push(`    ✗ ${c.label}${c.note ? ' — ' + c.note : ''}`)); });
    if (!S.findings.length) L.push('- none found');
    L.push('', 'DETAILS'); Object.entries(S.fields).forEach(([k, v]) => L.push(`- ${k}: ${v}`));
    L.push('', 'CONSISTENCY'); S.crossChecks.forEach(c => L.push(`- ${c.ok ? '✓' : '⚠'} ${c.label}`));
    L.push('', 'SIGNATURES'); sigs.forEach(s => L.push(`- #${s.index}: ${s.empty ? 'empty field' : (s.status || 'unknown').toUpperCase() + (s.status === 'invalid' ? ' — ' + s.problems.join(' ') : s.chainTrusted ? ' (chain trusted by user)' : ' (content intact; signer identity unverified)')}${s.signer ? ' · signer: ' + describeSigner(s.signer) : ''}`)); if (!sigs.length) L.push('- no digital signature');
    L.push('', 'This report covers format, checksum and signature-integrity checks only. It is not proof that any document or number is genuine; confirm on the official portals.');
    return L.join('\n');
  }

  async function maskOnPage(f) {
    if (!dv.editable) return dv.needUnlock();
    const digits = clean(f.value); let added = 0;
    for (let i = 0; i < doc.numPages; i++) {
      let boxes = [];
      const ocr = doc.pages[i].ocr;
      if (ocr?.words?.length) {
        const w = ocr.words; for (let k = 0; k + 2 < w.length; k++) { if (/^\d{4}$/.test(w[k].text) && /^\d{4}$/.test(w[k + 1].text) && /^\d{4}$/.test(w[k + 2].text) && w[k].text + w[k + 1].text + w[k + 2].text === digits) boxes.push({ x: w[k].x - 2, y: Math.min(w[k].y, w[k + 1].y) - 2, w: w[k + 1].x + w[k + 1].w - w[k].x + 4, h: Math.max(w[k].h, w[k + 1].h) + 4 }); }
      } else {
        const t = await getPageText(doc.pdf, i); boxes = aadhaarMaskBoxes(t.items).filter(b => b.value === digits);
      }
      for (const b of boxes) { doc.pages[i].annots.push({ id: uid(), type: 'redact', x: b.x, y: b.y, w: b.w, h: b.h }); added++; }
      if (boxes.length) dv.annots.renderPage(i);
    }
    if (!added) return toast('Couldn’t locate that number on the page. Use the Redact tool to draw a box over it.', 'error', 7000);
    doc.checkpoint(); toast(`Added ${added} redaction box${added === 1 ? '' : 'es'} over the first 8 digits. Check them, then download — redaction is permanent once saved.`, 'success', 8000);
  }

  async function liveCheck(f) {
    try {
      const res = await fetch(VERIFY_PROXY_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: f.type, value: clean(f.value) }) });
      const j = await res.json(); dialog({ title: 'Live check result', body: h('div', h('p', j.message || (j.ok ? 'Verified.' : 'Not verified.')), j.details ? h('pre.mono', JSON.stringify(j.details, null, 2)) : null), actions: [] });
    } catch (e) { toast('The live check service did not respond: ' + e.message, 'error', 7000); }
  }

  /* ---------------------------------------------------------------- manual check */
  const typeSel = select(Object.entries(TYPES).map(([k, v]) => [k, v.label]), 'aadhaar', () => { inp.placeholder = TYPES[typeSel.value].example; }); const inp = h('input.input', { type: 'text', placeholder: TYPES.aadhaar.example, autocomplete: 'off', spellcheck: false });
  const manualOut = h('div');
  const doManual = () => { const r = TYPES[typeSel.value].fn(inp.value); manualOut.replaceChildren(h('div.vf-card', h('div.vf-card-h', h('strong', TYPES[typeSel.value].label), r.ok ? pill('ok', 'Format & checksum OK', 'check') : pill('bad', 'Failed checks', 'cross')), h('ul.vf-checks', r.checks.map(checkRow)), PORTALS[typeSel.value] ? h('a.btn.btn-secondary.btn-sm', { href: PORTALS[typeSel.value].url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), h('span', 'Check on official site')) : null)); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') doManual(); });

  el.append(dv.panelHeader('Verify documents', 'Aadhaar · PAN · GST · Certificate of Incorporation and more'),
    h('div.panel-b',
      h('p.hint', 'Reads the numbers in this PDF, validates their format and checksum, cross-checks them against each other, and checks whether a digital signature is intact. Nothing leaves your device.'),
      scanBtn, out,
      h('details.acc', h('summary', icon('search', 18), 'Check a number you type'), h('div', field('Type', typeSel), field('Number', inp), button({ label: 'Check number', kind: 'primary', onClick: doManual }), manualOut)),
      h('div.note-box', icon('lock', 16), h('span', 'Aadhaar numbers are sensitive. Share them only when necessary and prefer a masked copy.'))));
  return {};
}
