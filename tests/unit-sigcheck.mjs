// Runs js/sigcheck.js over every PDF in a folder and prints the verdict for each.  node tests/unit-sigcheck.mjs DIR
import { readFileSync, readdirSync } from 'node:fs';
import { inspectSignatures, parseCertFile } from '../js/sigcheck.js';
const dir = process.argv[2]; const trusted = readdirSync(dir).filter(f => /Root-CA\.pem$/.test(f)).map(f => parseCertFile(new Uint8Array(readFileSync(dir + '/' + f))));
let bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.pdf')).sort()) {
  const s = (await inspectSignatures(new Uint8Array(readFileSync(dir + '/' + f)), { trusted }))[0];
  const want = /tampered/.test(f) ? 'invalid' : 'valid'; if (s.status !== want) bad++;
  console.log((s.status === want ? 'PASS ' : 'FAIL ') + f.padEnd(26), String(s.status).padEnd(8), 'digest', String(s.digestOk).padEnd(5), 'sig', String(s.sigOk).padEnd(5), 'chain', String(s.chainTrusted).padEnd(5), s.algorithm || '', s.problems.length ? '| ' + s.problems.join(' / ') : '');
}
console.log(bad ? `\n${bad} FAILED` : '\nall signature variants behave as expected'); process.exit(bad ? 1 : 0);
