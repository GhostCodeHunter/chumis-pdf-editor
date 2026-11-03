// A tiny Cloudflare Worker that lets Chumi's PDF Editor fetch a CA's certificate revocation list (CRL).
// A browser cannot do this itself: CA servers are plain http and send no CORS headers.
// Deploy:  npx wrangler deploy tools/revocation-proxy/worker.js --name chumi-crl-proxy   (or paste it into the Cloudflare dashboard)
// Then set REVOCATION_PROXY_URL in js/config.js to the worker's URL.
// It only ever fetches CRLs (never your documents), caps the size, and can be limited to the hosts you list below.
const ALLOW_HOSTS = [];                       // e.g. ['cca.gov.in', 'emudhra.com', 'ncodesolutions.com'] — empty = any host
const MAX_BYTES = 20 * 1024 * 1024;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' };
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const target = new URL(request.url).searchParams.get('url');
    let u; try { u = new URL(target); } catch { return new Response('bad url', { status: 400, headers: CORS }); }
    if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port))) return new Response('not allowed', { status: 403, headers: CORS });
    if (ALLOW_HOSTS.length && !ALLOW_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) return new Response('host not allowed', { status: 403, headers: CORS });
    const r = await fetch(u.href, { cf: { cacheTtl: 3600, cacheEverything: true } });
    const len = Number(r.headers.get('content-length') || 0); if (len > MAX_BYTES) return new Response('too large', { status: 413, headers: CORS });
    const buf = await r.arrayBuffer(); if (buf.byteLength > MAX_BYTES) return new Response('too large', { status: 413, headers: CORS });
    const b = new Uint8Array(buf, 0, 2); if (!(b[0] === 0x30 || b[0] === 0x2d)) return new Response('not a CRL', { status: 415, headers: CORS }); // DER (0x30) or PEM ('-')
    return new Response(buf, { headers: { ...CORS, 'content-type': 'application/pkix-crl', 'cache-control': 'public, max-age=3600' } });
  },
};
