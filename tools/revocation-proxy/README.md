# Revocation proxy (optional)

Chumi's PDF Editor checks certificate revocation from the CRL / OCSP data stored **inside** the signed PDF — the same offline check Acrobat does.
Browsers cannot download a CA's CRL themselves (plain-http servers, no CORS headers), so live checking needs this small proxy.

1. Deploy `worker.js` to Cloudflare Workers (free tier is plenty).
2. Optionally list the CA hosts you want to allow in `ALLOW_HOSTS`.
3. Put the worker URL in `js/config.js` → `REVOCATION_PROXY_URL`.
4. Users then see **Check revocation online** in the Signatures panel (off by default).

Privacy: the proxy sees which CRL address is requested (a CA's public list), never the document or its contents.
