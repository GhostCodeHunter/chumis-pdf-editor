// Built-in trust: the bundled CCA roots are well-formed, and a signature whose chain ends at one of them is accepted automatically.
import { readFileSync } from 'node:fs';
import { parseCertFile, fingerprint } from '../js/sigcheck.js';
const j = JSON.parse(readFileSync(new URL('../vendor/trust/india-pki.json', import.meta.url)));
const dec = t => new Uint8Array(Buffer.from(t, 'base64'));
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };
const names = j.roots.map(r => r.name);
ok(names.includes('CCA India 2022') && names.includes('CCA India 2022 SPL'), 'CCA India 2022 and 2022 SPL are bundled: ' + names.join(', '));
const PIN = { 'CCA India 2022': '9a3fd3176798e842ddcb12c262f11cfacca70a8b84c6ea6fda30842a95a94cd8', 'CCA India 2022 SPL': 'b724689b79b2ef9421ef8f5cc733eb093851b170ee715177005a09f226d8c91a' };
for (const r of j.roots) { const c = parseCertFile(dec(r.der)); const fp = (await fingerprint(c.der)).replace(/:/g, '').toLowerCase(); ok(fp === r.sha256, `${r.name}: fingerprint recorded = computed`); if (PIN[r.name]) ok(fp === PIN[r.name], `${r.name}: matches the independently published fingerprint`); ok(c.selfSigned && c.isCA, `${r.name}: self-signed CA`); }
ok(j.intermediates.length > 40, j.intermediates.length + ' licensed-CA certificates bundled');
ok(j.intermediates.some(i => /e-Mudhra CA 2022/.test(i.name)), 'e-Mudhra CA 2022 is bundled');
for (const i of j.intermediates) parseCertFile(dec(i.der));
process.exit(bad ? 1 : 0);
