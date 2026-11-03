// Certificate revocation, the way Acrobat does it for signed PDFs:
//   1. revocation information carried inside the file (CRLs and OCSP responses archived by the signer, or in the PDF's DSS) is checked offline;
//   2. optionally, a revocation proxy (see tools/revocation-proxy) lets the app fetch the CA's CRL, which a browser cannot do on its own.
// As in Acrobat, revocation is not checked on or above a trust anchor.
import { asn1 } from './sigcheck.js';
const { parse, rawOf, valOf, oidOf, timeOf, eq, HASHES } = asn1;

const SIGHASH = { '1.2.840.113549.1.1.5': 'SHA-1', '1.2.840.113549.1.1.11': 'SHA-256', '1.2.840.113549.1.1.12': 'SHA-384', '1.2.840.113549.1.1.13': 'SHA-512' };
const hexOf = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const stripZ = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; return b.subarray(i); };
const serialHex = c => hexOf(stripZ(c.serialBytes));

async function rsaVerify(issuer, algOid, signature, data) {
  const hash = SIGHASH[algOid]; if (!hash || issuer.keyAlg !== '1.2.840.113549.1.1.1') return null; // other algorithms: cannot say
  try { const key = await crypto.subtle.importKey('spki', issuer.spki, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']); return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data); } catch { return null; }
}

/** A Certificate Revocation List: who issued it, when it is valid, and which serial numbers it revokes. */
export function parseCrl(der) {
  const root = parse(der, 0), tbs = root.children[0]; let i = 0;
  if (tbs.children[0].tag === 0x02) i = 1;                                  // optional version
  const sigAlg = oidOf(tbs.children[i].children[0]); const issuer = tbs.children[i + 1];
  const thisUpdate = timeOf(tbs.children[i + 2]); let nextUpdate = null, k = i + 3;
  if (tbs.children[k] && (tbs.children[k].tag === 0x17 || tbs.children[k].tag === 0x18)) nextUpdate = timeOf(tbs.children[k++]);
  const revoked = new Map();
  if (tbs.children[k] && tbs.children[k].tag === 0x30) for (const e of tbs.children[k].children) revoked.set(hexOf(stripZ(valOf(e.children[0]))), timeOf(e.children[1]));
  return { issuerRaw: rawOf(issuer), thisUpdate, nextUpdate, revoked, tbsRaw: rawOf(tbs), sigAlg: oidOf(root.children[1].children[0]) || sigAlg, sigValue: valOf(root.children[2]).subarray(1) };
}

/** Checks one certificate against one CRL. Returns { status: 'good' | 'revoked' | 'unknown', reason, … }. */
export async function checkCrl(cert, issuer, crlDer, when) {
  let crl; try { crl = parseCrl(crlDer); } catch { return { status: 'unknown', reason: 'The CRL could not be read.' }; }
  if (!eq(crl.issuerRaw, issuer.subjectRaw)) return { status: 'unknown', reason: 'The CRL was issued by a different authority.' };
  const ok = await rsaVerify(issuer, crl.sigAlg, crl.sigValue, crl.tbsRaw);
  if (ok === false) return { status: 'unknown', reason: 'The CRL’s signature is not valid.' };
  if (ok === null) return { status: 'unknown', reason: 'The CRL uses a signature algorithm this checker does not support.' };
  const at = when || new Date();
  if (crl.thisUpdate && at < crl.thisUpdate) return { status: 'unknown', reason: 'The CRL is newer than the time being checked.', thisUpdate: crl.thisUpdate, nextUpdate: crl.nextUpdate };
  if (crl.nextUpdate && at > crl.nextUpdate) return { status: 'unknown', reason: 'The CRL had expired at the time being checked.', thisUpdate: crl.thisUpdate, nextUpdate: crl.nextUpdate };
  const date = crl.revoked.get(serialHex(cert));
  return date !== undefined ? { status: 'revoked', source: 'CRL', revokedAt: date, thisUpdate: crl.thisUpdate, nextUpdate: crl.nextUpdate } : { status: 'good', source: 'CRL', thisUpdate: crl.thisUpdate, nextUpdate: crl.nextUpdate };
}

/** An OCSP response: the status of individual certificates, signed by the CA or its delegated responder. */
export function parseOcsp(der) {
  const root = parse(der, 0);
  if (valOf(root.children[0])[0] !== 0) throw new Error('OCSP: not successful');
  const basic = parse(valOf(root.children[1].children[0].children[1]), 0), tbs = basic.children[0];
  let i = 0; if (tbs.children[0].tag === 0xa0) i = 1;
  const producedAt = timeOf(tbs.children[i + 1]), certs = [];
  for (const x of (basic.children[3]?.children || [])) certs.push(x);
  const responses = tbs.children[i + 2].children.map(sr => {
    const id = sr.children[0], st = sr.children[1];
    const rev = st.tag === 0xa1 ? timeOf(st.children[0]) : null;
    const nextN = sr.children.find(c => c.tag === 0xa0);
    return { hashOid: oidOf(id.children[0].children[0]), nameHash: valOf(id.children[1]), keyHash: valOf(id.children[2]), serial: hexOf(stripZ(valOf(id.children[3]))), state: st.tag === 0x80 ? 'good' : st.tag === 0xa1 ? 'revoked' : 'unknown', revokedAt: rev, thisUpdate: timeOf(sr.children[2]), nextUpdate: nextN ? timeOf(nextN.children[0]) : null };
  });
  return { tbsRaw: rawOf(tbs), sigAlg: oidOf(basic.children[1].children[0]), sigValue: valOf(basic.children[2]).subarray(1), producedAt, responses, certNodes: certs };
}

export async function checkOcsp(cert, issuer, ocspDer, when, parseCertNode) {
  let o; try { o = parseOcsp(ocspDer); } catch { return { status: 'unknown', reason: 'The OCSP response could not be read.' }; }
  const sr = o.responses.find(x => x.serial === serialHex(cert)); if (!sr) return null; // not about this certificate
  // who signed it: the issuing CA itself, or a responder certificate issued by that CA
  let signer = issuer;
  let ok = await rsaVerify(issuer, o.sigAlg, o.sigValue, o.tbsRaw);
  if (ok !== true && parseCertNode) for (const n of o.certNodes) { try { const rc = parseCertNode(n); if (await rsaVerify(rc, o.sigAlg, o.sigValue, o.tbsRaw) === true && await rsaVerify(issuer, rc.sigAlg, rc.sigValue, rc.tbsRaw) === true) { ok = true; signer = rc; break; } } catch {} }
  if (ok !== true) return { status: 'unknown', reason: ok === false ? 'The OCSP response’s signature is not valid.' : 'The OCSP response could not be verified.' };
  const at = when || new Date();
  if (sr.thisUpdate && at < new Date(sr.thisUpdate.getTime() - 5 * 60e3)) return { status: 'unknown', reason: 'The OCSP response is newer than the time being checked.' };
  if (sr.nextUpdate && at > sr.nextUpdate) return { status: 'unknown', reason: 'The OCSP response had expired at the time being checked.' };
  if (sr.state === 'revoked') return { status: 'revoked', source: 'OCSP', revokedAt: sr.revokedAt, thisUpdate: sr.thisUpdate, nextUpdate: sr.nextUpdate };
  if (sr.state === 'good') return { status: 'good', source: 'OCSP', thisUpdate: sr.thisUpdate, nextUpdate: sr.nextUpdate };
  return { status: 'unknown', reason: 'The responder does not know this certificate.' };
}

/**
 * Checks every certificate of the signer's chain below the trust anchor.
 *  info: { crls: Uint8Array[], ocsps: Uint8Array[] } carried in the file;  live: optional async (cert, issuer) => Uint8Array[] of CRLs fetched through the proxy.
 * Returns { state: 'good' | 'revoked' | 'unchecked', items: [{ name, status, source, … }], revokedBeforeSigning }.
 */
export async function evaluateRevocation(chain, trustedAt, info, when, { parseCertNode, live } = {}) {
  const items = []; const upto = trustedAt >= 0 ? trustedAt : chain.length;
  for (let i = 0; i < upto; i++) {
    const cert = chain[i], issuer = chain[i + 1]; if (!issuer || cert.selfSigned) continue;
    const name = cert.subject.CN || cert.subject.O || 'Certificate'; let res = null;
    for (const o of info?.ocsps || []) { const r = await checkOcsp(cert, issuer, o, when, parseCertNode); if (r && r.status !== 'unknown') { res = r; break; } if (r && !res) res = r; }
    if (!res || res.status === 'unknown') for (const c of info?.crls || []) { const r = await checkCrl(cert, issuer, c, when); if (r.status !== 'unknown') { res = r; break; } if (!res || !res.reason) res = res || r; }
    if ((!res || res.status === 'unknown') && live) { try { for (const c of await live(cert, issuer)) { const r = await checkCrl(cert, issuer, c, null); if (r.status !== 'unknown') { res = { ...r, source: 'CRL (online)' }; break; } res = res || r; } } catch (e) { res = res || { status: 'unknown', reason: 'The online revocation check failed: ' + (e.message || e) }; } }
    items.push({ name, ...(res || { status: 'unknown', reason: 'No revocation information was available for this certificate.' }) });
  }
  const bad = items.find(x => x.status === 'revoked');
  const state = bad ? 'revoked' : items.length && items.every(x => x.status === 'good') ? 'good' : 'unchecked';
  return { state, items, revokedBeforeSigning: !!bad && (!when || !bad.revokedAt || bad.revokedAt <= when) };
}
