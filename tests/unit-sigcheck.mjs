// Runs js/sigcheck.js over every PDF in a folder and prints the verdict for each.  node tests/unit-sigcheck.mjs DIR
import { readFileSync, readdirSync } from 'node:fs';
import { inspectSignatures, parseCertFile } from '../js/sigcheck.js';
const dir = process.argv[2]; const trusted = readdirSync(dir).filter(f => /Root-CA\.pem$/.test(f)).map(f => parseCertFile(new Uint8Array(readFileSync(dir + '/' + f))));
let bad = 0;
const pool = readdirSync(dir).filter(f => /Sub-CA\.pem$/.test(f)).map(f => parseCertFile(new Uint8Array(readFileSync(dir + '/' + f)))); pool.forEach(c => (c.builtin = true));
for (const f of readdirSync(dir).filter(f => f.endsWith('.pdf')).sort()) {
  const s = (await inspectSignatures(new Uint8Array(readFileSync(dir + '/' + f)), { trusted, pool }))[0];
  const want = /tampered/.test(f) ? 'invalid' : /certified/.test(f) ? 'unknown' : 'valid'; if (s.status !== want) bad++;
  console.log((s.status === want ? 'PASS ' : 'FAIL ') + f.padEnd(26), String(s.status).padEnd(8), 'digest', String(s.digestOk).padEnd(5), 'sig', String(s.sigOk).padEnd(5), 'chain', String(s.chainTrusted).padEnd(5), s.algorithm || '', s.problems.length ? '| ' + s.problems.join(' / ') : '');
}
{ // a certification signature needs a signer trusted for certifying; built-in roots are, user-added ones only when ticked
  const raw = new Uint8Array(readFileSync(dir + '/certified-p2.pdf'));
  const mine = trusted.map(c => Object.assign(c, { builtin: true })); const a = (await inspectSignatures(raw, { trusted: mine, pool }))[0]; mine.forEach(c => Object.assign(c, { builtin: false, trustCertified: false }));
  const b = (await inspectSignatures(raw, { trusted: mine, pool }))[0]; mine.forEach(c => (c.trustCertified = true)); const c2 = (await inspectSignatures(raw, { trusted: mine, pool }))[0];
  const t = (cond, m) => { console.log((cond ? 'PASS ' : 'FAIL ') + m); if (!cond) bad++; };
  t(a.certification?.p === 2, 'DocMDP: certification level P=2 detected'); t(a.status === 'valid', 'certified, signer under a built-in root → valid');
  t(b.status === 'unknown' && b.certTrustProblem, 'certified, signer only trusted for signing → unknown (not trusted for certified documents)'); t(c2.status === 'valid', 'certified, trusted for certified documents → valid');
}
console.log(bad ? `\n${bad} FAILED` : '\nall signature variants behave as expected'); process.exit(bad ? 1 : 0);
