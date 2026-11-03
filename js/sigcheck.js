// Digital-signature inspection for PDFs: finds signatures, reads the signer certificate and checks that the
// signed bytes were not changed (digest + RSA signature). Certificate-chain trust is NOT evaluated.

/* ---------------------------------------------------------------- minimal DER/BER reader */
function parse(buf, off = 0, limit = buf.length) {
  const tag = buf[off]; let len = buf[off + 1]; let p = off + 2; let indefinite = false;
  if (len === 0x80) { indefinite = true; len = 0; }
  else if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[p + i]; p += n; }
  const node = { tag, cls: tag >> 6, constructed: !!(tag & 0x20), type: tag & 0x1f, start: off, valStart: p };
  if (node.constructed) {
    node.children = []; let q = p; const stop = indefinite ? limit : p + len;
    while (q < stop) { if (indefinite && buf[q] === 0 && buf[q + 1] === 0) { q += 2; break; } const c = parse(buf, q, stop); node.children.push(c); q = c.end; }
    node.valEnd = indefinite ? q - 2 : p + len; node.end = indefinite ? q : p + len;
  } else { node.valEnd = p + len; node.end = p + len; }
  node.buf = buf; return node;
}
const rawOf = n => n.buf.subarray(n.start, n.end);
const valOf = n => n.buf.subarray(n.valStart, n.valEnd);
function oidOf(n) {
  const v = valOf(n); if (!v.length) return ''; const out = [Math.floor(v[0] / 40), v[0] % 40]; let x = 0;
  for (let i = 1; i < v.length; i++) { x = x * 128 + (v[i] & 0x7f); if (!(v[i] & 0x80)) { out.push(x); x = 0; } }
  return out.join('.');
}
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function strOf(n) {
  const v = valOf(n);
  if (n.tag === 0x1e) { let s = ''; for (let i = 0; i + 1 < v.length; i += 2) s += String.fromCharCode(v[i] << 8 | v[i + 1]); return s; }
  try { return new TextDecoder(n.tag === 0x0c ? 'utf-8' : 'latin1').decode(v); } catch { return ''; }
}
function timeOf(n) {
  const s = new TextDecoder().decode(valOf(n)); let m;
  if (n.tag === 0x17 && (m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?/.exec(s))) { const y = +m[1]; return new Date(Date.UTC(y < 50 ? 2000 + y : 1900 + y, m[2] - 1, m[3], m[4], m[5], m[6] || 0)); }
  if (n.tag === 0x18 && (m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/.exec(s))) return new Date(Date.UTC(+m[1], m[2] - 1, m[3], m[4], m[5], m[6] || 0));
  return null;
}
const ATTR = { '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C', '2.5.4.5': 'serialNumber', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.4': 'SN', '2.5.4.42': 'GN', '1.2.840.113549.1.9.1': 'email', '2.5.4.65': 'pseudonym' };
function nameOf(n) { const o = {}; for (const rdn of n.children) for (const atv of rdn.children) { const k = ATTR[oidOf(atv.children[0])]; if (k && !o[k]) o[k] = strOf(atv.children[1]); } return o; }
const HASHES = { '1.3.14.3.2.26': 'SHA-1', '2.16.840.1.101.3.4.2.1': 'SHA-256', '2.16.840.1.101.3.4.2.2': 'SHA-384', '2.16.840.1.101.3.4.2.3': 'SHA-512' };
// A name reduced to a comparable form, so the same name matches even when two tools encode it with different string types.
const canonName = n => n.children.map(rdn => rdn.children.map(atv => oidOf(atv.children[0]) + '=' + strOf(atv.children[1]).trim().replace(/\s+/g, ' ').toLowerCase()).sort().join('+')).join(',');
const stripZ = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; return b.subarray(i); };
const octetsOf = n => { if (!n) return null; if (!n.constructed) return valOf(n); const parts = n.children.map(octetsOf); const out = new Uint8Array(parts.reduce((a, q) => a + q.length, 0)); let o = 0; for (const q of parts) { out.set(q, o); o += q.length; } return out; };
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

export function parseCert(n) {
  const tbs = n.children[0]; let i = 0; if (tbs.children[0].tag === 0xa0) i = 1;
  const serial = valOf(tbs.children[i]); const sigAlg = oidOf(tbs.children[i + 1].children[0]);
  const issuer = tbs.children[i + 2]; const val = tbs.children[i + 3]; const subject = tbs.children[i + 4]; const spki = tbs.children[i + 5];
  const keyAlg = oidOf(spki.children[0].children[0]); let keyBits = 0;
  try { if (keyAlg === '1.2.840.113549.1.1.1') { const inner = parse(valOf(spki.children[1]).subarray(1), 0); const mod = valOf(inner.children[0]); keyBits = (mod.length - (mod[0] === 0 ? 1 : 0)) * 8; } } catch {}
  const sigBits = valOf(n.children[2]);
  let ski = null, isCA = false; const keyUsage = [], policies = [], crlUrls = [], ocspUrls = [], caIssuerUrls = [];
  try {
    const ext = tbs.children.find(c => c.tag === 0xa3);
    if (ext) for (const e of ext.children[0].children) {
      const id = oidOf(e.children[0]); const inner = parse(valOf(e.children[e.children.length - 1]), 0);
      if (id === '2.5.29.14') ski = valOf(inner);
      if (id === '2.5.29.19') isCA = !!inner.children[0] && inner.children[0].tag === 0x01 && valOf(inner.children[0])[0] !== 0;
      if (id === '2.5.29.15') { const v = valOf(inner), bits = v.subarray(1), names = ['Digital Signature', 'Non-Repudiation', 'Key Encipherment', 'Data Encipherment', 'Key Agreement', 'Certificate Signing', 'CRL Signing', 'Encipher Only', 'Decipher Only']; names.forEach((nme, i) => { if (bits[i >> 3] & (0x80 >> (i & 7))) keyUsage.push(nme); }); }
      if (id === '2.5.29.32') for (const pi of inner.children) { try { policies.push(oidOf(pi.children[0])); } catch {} }
      if (id === '2.5.29.31') for (const m of latin(valOf(e.children[e.children.length - 1])).matchAll(/https?:\/\/[\x21-\x7e]+/g)) crlUrls.push(m[0]);
      if (id === '1.3.6.1.5.5.7.1.1') for (const ad of inner.children) { try { const how = oidOf(ad.children[0]), uri = latin(valOf(ad.children[1])); (how === '1.3.6.1.5.5.7.48.1' ? ocspUrls : caIssuerUrls).push(uri); } catch {} }
    }
  } catch {}
  return { ski, isCA, keyUsage, policies, crlUrls, ocspUrls, caIssuerUrls, version: tbs.children[0].tag === 0xa0 ? valOf(tbs.children[0].children[0])[0] + 1 : 1, issuerKey: canonName(issuer), subjectKey: canonName(subject), der: rawOf(n), tbsRaw: rawOf(tbs), sigValue: sigBits.subarray(1), serial: hex(serial), serialBytes: serial, issuerRaw: rawOf(issuer), subjectRaw: rawOf(subject), issuer: nameOf(issuer), subject: nameOf(subject), notBefore: timeOf(val.children[0]), notAfter: timeOf(val.children[1]), spki: rawOf(spki), sigAlg, keyAlg, keyBits, selfSigned: eq(rawOf(issuer), rawOf(subject)) };
}

/** Parses a certificate file (DER or PEM). */
export function parseCertFile(bytes) {
  let der = bytes; const txt = latin(bytes.subarray(0, Math.min(bytes.length, 64)));
  if (txt.includes('-----BEGIN')) { const b64 = latin(bytes).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''); const bin = atob(b64); der = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i); }
  const c = parseCert(parse(der, 0)); return c;
}
export async function fingerprint(der, alg = 'SHA-256') { const d = new Uint8Array(await crypto.subtle.digest(alg, der)); return [...d].map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase(); }

const SIGHASH = { '1.2.840.113549.1.1.5': 'SHA-1', '1.2.840.113549.1.1.11': 'SHA-256', '1.2.840.113549.1.1.12': 'SHA-384', '1.2.840.113549.1.1.13': 'SHA-512' };
async function certSignedBy(cert, issuer) {
  const hash = SIGHASH[cert.sigAlg]; if (!hash || issuer.keyAlg !== '1.2.840.113549.1.1.1') return null;
  try { const key = await crypto.subtle.importKey('spki', issuer.spki, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']); return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, cert.sigValue, cert.tbsRaw); } catch { return null; }
}

/** Builds the certificate chain from the signer up to a certificate the user trusts (or as far as the file allows). */
export async function buildChain(signer, embedded, trusted) {
  const fp = async c => (c._fp ||= await fingerprint(c.der));
  const trustedFps = new Set(await Promise.all(trusted.map(fp)));
  const chain = [signer]; const problems = []; let cur = signer; let trustedAt = -1; let complete = false;
  for (let depth = 0; depth < 8; depth++) {
    if (trustedFps.has(await fp(cur))) { trustedAt = chain.length - 1; complete = true; break; }
    if (cur.selfSigned) { const ok = await certSignedBy(cur, cur); if (ok === false) problems.push(`The root certificate “${cur.subject.CN || cur.subject.O}” has an invalid self-signature.`); complete = true; break; }
    let issuer = null, from = '';
    for (const c of embedded) if (c !== cur && c.isCA && eq(c.subjectRaw, cur.issuerRaw) && await certSignedBy(cur, c) !== false) { issuer = c; from = 'file'; break; } // only a CA certificate may vouch for another
    if (!issuer) for (const c of trusted) if (eq(c.subjectRaw, cur.issuerRaw) && await certSignedBy(cur, c) !== false) { issuer = c; from = 'trust'; break; }
    if (!issuer) { problems.push(`The issuer of “${cur.subject.CN || cur.subject.O || 'a certificate'}” (${cur.issuer.CN || cur.issuer.O || 'unknown'}) is not in the file or your trusted list.`); break; }
    chain.push(issuer); cur = issuer;
    if (from === 'trust') { trustedAt = chain.length - 1; complete = true; break; }
  }
  return { chain, trustedAt, complete, problems };
}

/* ---------------------------------------------------------------- PDF signature discovery */
export const latin = bytes => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return s; };
function pdfString(txt, key) {
  const m = new RegExp('/' + key + '\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)').exec(txt); if (!m) return '';
  const v = m[1];
  if (v[0] === '(') return v.slice(1, -1).replace(/\\([()\\])/g, '$1');
  const h = v.slice(1, -1).replace(/\s/g, ''); const b = new Uint8Array(h.length / 2 | 0).map((_, k) => parseInt(h.substr(k * 2, 2), 16));
  if (b[0] === 0xfe && b[1] === 0xff) { let s = ''; for (let k = 2; k + 1 < b.length; k += 2) s += String.fromCharCode(b[k] << 8 | b[k + 1]); return s; }
  return latin(b);
}
function pdfDate(s) { const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/.exec(s || ''); if (!m) return null; const off = m[7] === '+' ? -1 : m[7] === '-' ? 1 : 0; return new Date(Date.UTC(+m[1], (m[2] || 1) - 1, m[3] || 1, +(m[4] || 0) + off * +(m[8] || 0), +(m[5] || 0) + off * +(m[9] || 0), m[6] || 0)); }

export async function inspectSignatures(bytes, { trusted = [], pool = [] } = {}) {
  const text = latin(bytes); const out = []; const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g; let m, idx = 0;
  while ((m = re.exec(text))) {
    const [b0, b1, b2, b3] = m.slice(1, 5).map(Number); const r = { index: ++idx, byteRange: [b0, b1, b2, b3], problems: [], info: {} };
    try {
      const win = text.slice(Math.max(0, m.index - 2500), m.index + 2500);
      r.info = { name: pdfString(win, 'Name'), reason: pdfString(win, 'Reason'), location: pdfString(win, 'Location'), contact: pdfString(win, 'ContactInfo'), filter: (/\/SubFilter\s*\/([\w.]+)/.exec(win) || [])[1] || '' };
      r.info.when = pdfDate(pdfString(win, 'M'));
      if (b0 !== 0 || b1 <= 0 || b2 < b1 || b2 + b3 > bytes.length + 2) { r.problems.push('The signed byte range is invalid.'); out.push(r); continue; }
      r.coversWholeFile = bytes.length - (b2 + b3) <= 2 || eq(bytes.subarray(b2 + b3), new Uint8Array(bytes.length - b2 - b3).fill(10)) ;
      if (!r.coversWholeFile) r.problems.push('Content was added to the file after this signature was applied (e.g. a later signature or an edit).');
      const gap = latin(bytes.subarray(b1, b2)); const hm = /<([0-9A-Fa-f\s]+)>/.exec(gap); if (!hm) { r.problems.push('The signature data could not be found.'); out.push(r); continue; }
      const hs = hm[1].replace(/\s/g, ''); const der = new Uint8Array(hs.length / 2 | 0); for (let k = 0; k < der.length; k++) der[k] = parseInt(hs.substr(k * 2, 2), 16);
      if (!der.some(x => x)) { r.problems.push('This is an empty signature field (not signed yet).'); r.empty = true; out.push(r); continue; }
      r.signedLength = b2 + b3; r.fileLength = bytes.length;
      await verifyCms(der, bytes, [b0, b1, b2, b3], r);
      await finishTrust(r, trusted, pool);
    } catch (e) { r.problems.push('Could not read this signature: ' + (e.message || e)); r.status = 'invalid'; }
    out.push(r);
  }
  return out;
}

/** RSASSA-PSS parameters (hash and salt length) from a signature AlgorithmIdentifier. */
function pssParams(algNode) {
  let hash = 'SHA-1', salt = 20;
  const prm = algNode.children[1];
  if (prm && prm.children) for (const c of prm.children) {
    if (c.tag === 0xa0 && c.children[0]) hash = HASHES[oidOf(c.children[0].children[0])] || hash;
    if (c.tag === 0xa2 && c.children[0]) { salt = 0; for (const x of valOf(c.children[0])) salt = salt * 256 + x; }
  }
  return { hash, salt };
}

/** The certificates that could belong to the signer, most likely first: the one the signature names, then end-entity certificates, then the rest. */
function signerCandidates(sid, certs) {
  let matched = [];
  if (sid.tag === 0x30) { const ser = stripZ(valOf(sid.children[1])); const iss = rawOf(sid.children[0]); const ik = canonName(sid.children[0]); matched = certs.filter(c => eq(stripZ(c.serialBytes), ser) && (eq(c.issuerRaw, iss) || c.issuerKey === ik)); }
  else if (sid.tag === 0x80) { const ski = valOf(sid); matched = certs.filter(c => c.ski && eq(c.ski, ski)); }
  const leafLike = certs.filter(c => !matched.includes(c) && !certs.some(o => o !== c && eq(o.issuerRaw, c.subjectRaw)));
  return [...matched, ...leafLike, ...certs.filter(c => !matched.includes(c) && !leafLike.includes(c))];
}

async function verifyWith(cert, scheme, signature, data) {
  if (cert.keyAlg !== '1.2.840.113549.1.1.1' && cert.keyAlg !== '1.2.840.113549.1.1.10') return false;
  try {
    if (scheme.pss) { const key = await crypto.subtle.importKey('spki', cert.spki, { name: 'RSA-PSS', hash: scheme.hash }, false, ['verify']); return await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: scheme.salt }, key, signature, data); }
    const key = await crypto.subtle.importKey('spki', cert.spki, { name: 'RSASSA-PKCS1-v1_5', hash: scheme.hash }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  } catch { return false; }
}

async function verifyCms(der, bytes, [b0, b1, b2, b3], r) {
  const root = parse(der, 0);
  const ci = root.children; if (oidOf(ci[0]) !== '1.2.840.113549.1.7.2') throw new Error('Not a CMS SignedData signature');
  const sd = ci[1].children[0].children; // SignedData
  let k = 3; const certs = []; let signerInfos = null;
  for (; k < sd.length; k++) { const n = sd[k]; if (n.tag === 0xa0) n.children.forEach(c => { try { certs.push(parseCert(c)); } catch {} }); else if (n.tag === 0x31) signerInfos = n; }
  if (!signerInfos || !signerInfos.children.length) throw new Error('No signer found');
  // Content carried inside the signature itself (the old adbe.pkcs7.sha1 style stores the document's digest here).
  let eContent = null; try { const ec = sd[2].children[1]; if (ec && ec.children && ec.children[0]) eContent = octetsOf(ec.children[0]); } catch {}
  const si = signerInfos.children[0].children; let p = 1; const sid = si[p++];
  const digestOid = oidOf(si[p++].children[0]); let attrs = null; if (si[p].tag === 0xa0) attrs = si[p++];
  const sigAlgNode = si[p++]; const sigAlgOid = sigAlgNode.children[0] ? oidOf(sigAlgNode.children[0]) : ''; const signature = valOf(si[p++]);
  const pss = sigAlgOid === '1.2.840.113549.1.1.10';
  const hashName = pss ? pssParams(sigAlgNode).hash : HASHES[digestOid];
  r.algorithm = `${HASHES[digestOid] || digestOid} with ${sigAlgOid.startsWith('1.2.840.113549.1.1') ? (pss ? 'RSA-PSS' : 'RSA') : sigAlgOid}`;
  r.format = r.info.filter || ''; r.certs = certs;
  // signing time
  if (attrs) for (const a of attrs.children) if (oidOf(a.children[0]) === '1.2.840.113549.1.9.5') r.signTime = timeOf(a.children[1].children[0]);
  r.signTimeFromSignature = !!r.signTime;
  r.signTime = r.signTime || r.info.when || null;
  // digest of the signed bytes
  const digestName = HASHES[digestOid]; if (!digestName || !hashName) { r.problems.push('Unsupported hash algorithm.'); r.signerCert = signerCandidates(sid, certs)[0] || null; return; }
  const content = new Uint8Array(b1 + b3); content.set(bytes.subarray(b0, b0 + b1), 0); content.set(bytes.subarray(b2, b2 + b3), b1);
  let target = content; // what the signature's own digest is computed over
  if (eContent) {
    let same = eq(eContent, content); // the whole signed content embedded in the signature
    if (!same) for (const h of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) { const d = new Uint8Array(await crypto.subtle.digest(h, content)); if (eq(d, eContent)) { same = true; break; } }
    r.contentDigestOk = same; target = eContent;
  }
  const digest = new Uint8Array(await crypto.subtle.digest(digestName, target));
  let signedData = target;
  if (attrs) {
    let md = null; for (const a of attrs.children) if (oidOf(a.children[0]) === '1.2.840.113549.1.9.4') md = valOf(a.children[1].children[0]);
    r.digestOk = !!md && eq(md, digest) && r.contentDigestOk !== false;
    signedData = new Uint8Array(rawOf(attrs)); signedData[0] = 0x31;
  } else r.digestOk = eContent ? r.contentDigestOk : null;
  if (r.digestOk === false) r.problems.push('The document content no longer matches the signed fingerprint — it was changed after signing.');
  // signer certificate and signature value: try the certificate the signature names first, then any other embedded one
  const cands = signerCandidates(sid, certs);
  if (!cands.length) { r.problems.push('The signer certificate is not embedded in the file.'); return; }
  if (!sigAlgOid.startsWith('1.2.840.113549.1.1')) { r.signerCert = cands[0]; r.problems.push('This signature uses an algorithm this checker does not support (only RSA).'); }
  else {
    const scheme = pss ? { pss: true, hash: hashName, salt: pssParams(sigAlgNode).salt } : { hash: hashName };
    let found = null; for (const c of cands) if (await verifyWith(c, scheme, signature, signedData)) { found = c; break; }
    r.sigOk = !!found; r.signerCert = found || cands[0];
    if (!found) r.problems.push('The cryptographic signature does not match — the signature or the document has been altered.');
  }
  const cert = r.signerCert;
  r.signer = { subject: cert.subject, issuer: cert.issuer, notBefore: cert.notBefore, notAfter: cert.notAfter, serial: cert.serial, selfSigned: cert.selfSigned, chainLength: certs.length };
  if (r.signTime && cert.notBefore && cert.notAfter && (r.signTime < cert.notBefore || r.signTime > cert.notAfter)) r.problems.push('The signing time is outside the certificate’s validity period.');
}

export function describeSigner(s) { if (!s) return ''; const n = s.subject; return [n.CN || n.pseudonym || n.O || '', n.O && n.CN ? n.O : '', n.C || ''].filter(Boolean).join(' · '); }


/** Computes the Acrobat-style status: valid / unknown / invalid, using the certificate chain and the user's trusted list. */
async function finishTrust(r, trusted, pool = []) {
  r.integrityOk = r.digestOk !== false && r.sigOk === true && !r.problems.some(p => /does not match|altered|invalid|unsupported|could not|not embedded|empty/i.test(p) && !/outside the certificate/i.test(p));
  if (!r.signerCert) { r.status = r.sigOk === false || r.digestOk === false ? 'invalid' : 'unknown'; return; }
  const when = r.signTime || new Date();
  const ch = await buildChain(r.signerCert, [...r.certs, ...pool], trusted); r.chain = ch.chain; r.chainTrusted = ch.trustedAt >= 0; r.chainProblems = ch.problems; r.chainBuiltin = ch.trustedAt >= 0 && !!ch.chain[ch.trustedAt].builtin;
  r.expired = ch.chain.slice(0, ch.trustedAt >= 0 ? ch.trustedAt + 1 : ch.chain.length).some(c => (c.notBefore && when < c.notBefore) || (c.notAfter && when > c.notAfter));
  if (r.digestOk === false || r.sigOk === false) r.status = 'invalid';
  else if (r.sigOk !== true) r.status = 'unknown';
  else if (r.chainTrusted && !r.expired) r.status = 'valid';
  else r.status = 'unknown';
  r.modifiedAfter = r.coversWholeFile === false;
}
