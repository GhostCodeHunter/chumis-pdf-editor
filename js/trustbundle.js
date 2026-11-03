// Built-in trust anchors: India's Root CA (CCA India 2022 and the earlier roots) and the licensed CAs under them, so that
// signatures on Indian government documents (GST, e-Aadhaar, e-Mudhra, …) validate on their own, as they do in Acrobat on a PC
// that trusts the CCA root. The list is vendor/trust/india-pki.json, built and checked by tools/build_trust.py.
import { parseCertFile, parseCert, inspectSignatures } from './sigcheck.js';
import { evaluateRevocation } from './revocation.js';
import { REVOCATION_PROXY_URL } from './config.js';

let loaded = null;
export function builtinTrust() {
  if (loaded) return loaded;
  loaded = (async () => {
    try {
      const r = await fetch(new URL('../vendor/trust/india-pki.json', import.meta.url)); if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); const dec = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
      const make = x => { const c = parseCertFile(dec(x.der)); c.builtin = true; return c; };
      return { roots: j.roots.map(make), pool: j.intermediates.map(make) };
    } catch (e) { loaded = null; console.warn('Built-in trust list unavailable', e); return { roots: [], pool: [] }; }
  })();
  return loaded;
}
/** Options for inspectSignatures: the user's own trusted certificates plus the built-in roots, and the helper CA certificates. */
export async function trustArgs(userTrusted = []) { const b = await builtinTrust(); return { trusted: [...userTrusted, ...b.roots], pool: b.pool }; }

/* ---- revocation: information inside the file, and (optionally) the CA's CRL through a revocation proxy ---- */
const ONLINE_KEY = 'chumi.revocation.online';
export const onlineRevocationAvailable = () => !!REVOCATION_PROXY_URL;
export const onlineRevocationOn = () => !!REVOCATION_PROXY_URL && localStorage.getItem(ONLINE_KEY) === '1';
export function setOnlineRevocation(on) { try { localStorage.setItem(ONLINE_KEY, on ? '1' : '0'); } catch {} }
const crlCache = new Map();
async function liveCrls(cert) {
  const out = [];
  for (const u of cert.crlUrls.slice(0, 2)) {
    if (!crlCache.has(u)) crlCache.set(u, (async () => { const r = await fetch(`${REVOCATION_PROXY_URL}?url=${encodeURIComponent(u)}`); if (!r.ok) throw new Error('HTTP ' + r.status); const b = new Uint8Array(await r.arrayBuffer()); if (b[0] === 0x2d) { const t = new TextDecoder().decode(b).replace(/-----[^-]+-----|\s/g, ''); return Uint8Array.from(atob(t), c => c.charCodeAt(0)); } return b; })());
    out.push(await crlCache.get(u));
  }
  return out;
}
/** Revocation information stored in the PDF itself (its /DSS dictionary: CRLs and OCSP responses). */
async function dssRevocation(bytes) {
  const out = { crls: [], ocsps: [] };
  try {
    if (!new TextDecoder('latin1').decode(bytes).includes('/DSS')) return out;
    const { PDFDocument, PDFName, PDFDict, PDFArray, decodePDFRawStream } = window.PDFLib;
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }), dss = doc.catalog.lookup(PDFName.of('DSS'));
    if (dss instanceof PDFDict) for (const [key, list] of [['CRLs', out.crls], ['OCSPs', out.ocsps]]) { const arr = dss.lookup(PDFName.of(key)); if (arr instanceof PDFArray) for (let i = 0; i < arr.size(); i++) { try { list.push(decodePDFRawStream(arr.lookup(i)).decode()); } catch {} } }
  } catch {}
  return out;
}
/** Validates every signature of a file: signature + trust (built-in CCA roots + the user's) + revocation. */
export async function validateSignatures(bytes, userTrusted = []) {
  const sigs = await inspectSignatures(bytes, await trustArgs(userTrusted));
  const dss = sigs.some(x => x.chain) ? await dssRevocation(bytes) : { crls: [], ocsps: [] }, live = onlineRevocationOn() ? liveCrls : null;
  for (const r of sigs) {
    if (!r.chain || r.empty) continue;
    const info = { crls: [...(r.embeddedRevocation?.crls || []), ...dss.crls], ocsps: [...(r.embeddedRevocation?.ocsps || []), ...dss.ocsps] };
    try {
      r.revocation = await evaluateRevocation(r.chain, r.chainTrusted ? r.chain.length - 1 : -1, info, r.signTime, { parseCertNode: parseCert, live });
      r.revocation.embedded = info.crls.length + info.ocsps.length; r.revocation.online = !!live;
      if (r.revocation.state === 'revoked' && r.revocation.revokedBeforeSigning && r.status !== 'invalid') { r.status = 'invalid'; r.revoked = true; }
    } catch (e) { console.warn('revocation check', e); }
  }
  return sigs;
}
