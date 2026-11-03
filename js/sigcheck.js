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
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

export function parseCert(n) {
  const tbs = n.children[0]; let i = 0; if (tbs.children[0].tag === 0xa0) i = 1;
  const serial = valOf(tbs.children[i]); const sigAlg = oidOf(tbs.children[i + 1].children[0]);
  const issuer = tbs.children[i + 2]; const val = tbs.children[i + 3]; const subject = tbs.children[i + 4]; const spki = tbs.children[i + 5];
  const keyAlg = oidOf(spki.children[0].children[0]); let keyBits = 0;
  try { if (keyAlg === '1.2.840.113549.1.1.1') { const inner = parse(valOf(spki.children[1]).subarray(1), 0); const mod = valOf(inner.children[0]); keyBits = (mod.length - (mod[0] === 0 ? 1 : 0)) * 8; } } catch {}
  const sigBits = valOf(n.children[2]);
  return { der: rawOf(n), tbsRaw: rawOf(tbs), sigValue: sigBits.subarray(1), serial: hex(serial), serialBytes: serial, issuerRaw: rawOf(issuer), subjectRaw: rawOf(subject), issuer: nameOf(issuer), subject: nameOf(subject), notBefore: timeOf(val.children[0]), notAfter: timeOf(val.children[1]), spki: rawOf(spki), sigAlg, keyAlg, keyBits, selfSigned: eq(rawOf(issuer), rawOf(subject)) };
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
    for (const c of embedded) if (c !== cur && eq(c.subjectRaw, cur.issuerRaw) && await certSignedBy(cur, c) !== false) { issuer = c; from = 'file'; break; }
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

export async function inspectSignatures(bytes, { trusted = [] } = {}) {
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
      await finishTrust(r, trusted);
    } catch (e) { r.problems.push('Could not read this signature: ' + (e.message || e)); r.status = 'invalid'; }
    out.push(r);
  }
  return out;
}

async function verifyCms(der, bytes, [b0, b1, b2, b3], r) {
  const root = parse(der, 0);
  const ci = root.children; if (oidOf(ci[0]) !== '1.2.840.113549.1.7.2') throw new Error('Not a CMS SignedData signature');
  const sd = ci[1].children[0].children; // SignedData
  let k = 3; const certs = []; let signerInfos = null;
  for (; k < sd.length; k++) { const n = sd[k]; if (n.tag === 0xa0) n.children.forEach(c => { try { certs.push(parseCert(c)); } catch {} }); else if (n.tag === 0x31) signerInfos = n; }
  if (!signerInfos || !signerInfos.children.length) throw new Error('No signer found');
  const si = signerInfos.children[0].children; let p = 1; const sid = si[p++];
  const digestOid = oidOf(si[p++].children[0]); let attrs = null; if (si[p].tag === 0xa0) attrs = si[p++];
  const sigAlgOid = oidOf(si[p++].children[0]); const signature = valOf(si[p++]);
  r.algorithm = `${HASHES[digestOid] || digestOid} with ${sigAlgOid.startsWith('1.2.840.113549.1.1') ? 'RSA' : sigAlgOid}`;
  // signer certificate
  let cert = null;
  if (sid.tag === 0x30) { const ser = valOf(sid.children[1]); const iss = rawOf(sid.children[0]); cert = certs.find(c => eq(c.serialBytes, ser) && eq(c.issuerRaw, iss)); }
  cert = cert || certs[0];
  r.certs = certs; r.signerCert = cert;
  if (cert) r.signer = { subject: cert.subject, issuer: cert.issuer, notBefore: cert.notBefore, notAfter: cert.notAfter, serial: cert.serial, selfSigned: cert.selfSigned, chainLength: certs.length };
  else r.problems.push('The signer certificate is not embedded in the file.');
  // signing time
  if (attrs) for (const a of attrs.children) if (oidOf(a.children[0]) === '1.2.840.113549.1.9.5') r.signTime = timeOf(a.children[1].children[0]);
  r.signTime = r.signTime || r.info.when || null;
  // digest of the signed bytes
  const hashName = HASHES[digestOid]; if (!hashName) { r.problems.push('Unsupported hash algorithm.'); return; }
  const content = new Uint8Array(b1 + b3); content.set(bytes.subarray(b0, b0 + b1), 0); content.set(bytes.subarray(b2, b2 + b3), b1);
  const digest = new Uint8Array(await crypto.subtle.digest(hashName, content));
  let signedData = content;
  if (attrs) {
    let md = null; for (const a of attrs.children) if (oidOf(a.children[0]) === '1.2.840.113549.1.9.4') md = valOf(a.children[1].children[0]);
    r.digestOk = !!md && eq(md, digest);
    if (!r.digestOk) r.problems.push('The document content no longer matches the signed fingerprint — it was changed after signing.');
    signedData = new Uint8Array(rawOf(attrs)); signedData[0] = 0x31;
  } else r.digestOk = null;
  // signature value
  if (!cert) return;
  if (!sigAlgOid.startsWith('1.2.840.113549.1.1') || sigAlgOid === '1.2.840.113549.1.1.10') { r.problems.push('This signature uses an algorithm this checker does not support (only RSA PKCS#1 v1.5).'); return; }
  try {
    const key = await crypto.subtle.importKey('spki', cert.spki, { name: 'RSASSA-PKCS1-v1_5', hash: hashName }, false, ['verify']);
    r.sigOk = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
    if (!r.sigOk) r.problems.push('The cryptographic signature does not match — the signature or the document has been altered.');
  } catch (e) { r.problems.push('Signature check failed: ' + (e.message || e)); }
  if (r.signTime && cert.notBefore && cert.notAfter && (r.signTime < cert.notBefore || r.signTime > cert.notAfter)) r.problems.push('The signing time is outside the certificate’s validity period.');
}

export function describeSigner(s) { if (!s) return ''; const n = s.subject; return [n.CN || n.pseudonym || n.O || '', n.O && n.CN ? n.O : '', n.C || ''].filter(Boolean).join(' · '); }


/** Computes the Acrobat-style status: valid / unknown / invalid, using the certificate chain and the user's trusted list. */
async function finishTrust(r, trusted) {
  r.integrityOk = r.digestOk !== false && r.sigOk === true && !r.problems.some(p => /does not match|altered|invalid|unsupported|could not|not embedded|empty/i.test(p) && !/outside the certificate/i.test(p));
  if (!r.signerCert) { r.status = r.sigOk === false || r.digestOk === false ? 'invalid' : 'unknown'; return; }
  const when = r.signTime || new Date();
  const ch = await buildChain(r.signerCert, r.certs, trusted); r.chain = ch.chain; r.chainTrusted = ch.trustedAt >= 0; r.chainProblems = ch.problems;
  r.expired = ch.chain.slice(0, ch.trustedAt >= 0 ? ch.trustedAt + 1 : ch.chain.length).some(c => (c.notBefore && when < c.notBefore) || (c.notAfter && when > c.notAfter));
  if (r.digestOk === false || r.sigOk === false) r.status = 'invalid';
  else if (r.sigOk !== true) r.status = 'unknown';
  else if (r.chainTrusted && !r.expired) r.status = 'valid';
  else r.status = 'unknown';
  r.modifiedAfter = r.coversWholeFile === false;
}
