// Built-in trust anchors: India's Root CA (CCA India 2022 and the earlier roots) and the licensed CAs under them, so that
// signatures on Indian government documents (GST, e-Aadhaar, e-Mudhra, …) validate on their own, as they do in Acrobat on a PC
// that trusts the CCA root. The list is vendor/trust/india-pki.json, built and checked by tools/build_trust.py.
import { parseCertFile } from './sigcheck.js';

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
