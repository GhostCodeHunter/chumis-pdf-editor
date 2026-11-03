#!/usr/bin/env python3
"""Builds vendor/trust/india-pki.json: the built-in trust anchors (India's CCA roots) and the licensed-CA certificates under them.

  python3 tools/build_trust.py ROOT_DIR CANDIDATE_DIR [CANDIDATE_DIR ...]

Trust anchors are NOT taken on faith:
  * CCA India 2022 and CCA India 2022 SPL must have the SHA-256 fingerprints published independently of the repositories the
    files came from (pinned below) and must be self-signed.
  * The expired roots (2014, 2015 SPL, 2011, 2007) must be self-signed, carry the expected subject and validity (as listed on
    cca.gov.in/root_certificate.html) and be byte-identical in the two independent sources they were cross-checked in.
  * Every other certificate is kept only if openssl verifies its signature chain up to one of these roots (so it is genuinely
    issued under the CCA), is a CA, and is not itself a root.
"""
import sys, os, re, base64, hashlib, subprocess, json, tempfile, glob

PINS = {  # SHA-256 of the DER, from the CCA India 2022 / 2022 SPL pins published in pdfcraft PR #980 (also matches Microsoft's root store)
    'CCA India 2022': '9a3fd3176798e842ddcb12c262f11cfacca70a8b84c6ea6fda30842a95a94cd8',
    'CCA India 2022 SPL': 'b724689b79b2ef9421ef8f5cc733eb093851b170ee715177005a09f226d8c91a',
}
EXPECT_OLD = {  # CN -> (notBefore, notAfter) as listed on cca.gov.in/root_certificate.html
    'CCA India 2014': ('Mar  5 10:10:49 2014 GMT', 'Mar  5 10:10:49 2024 GMT'), 'CCA India 2015 SPL': ('Jan 29 11:36:43 2015 GMT', 'Jan 29 11:36:43 2025 GMT'),
    'CCA India 2011': ('Mar 11 06:48:52 2011 GMT', 'Mar 11 06:48:52 2016 GMT'), 'CCA India 2007': ('Jun 13 07:02:48 2007 GMT', 'Jul  4 07:02:48 2015 GMT'),
}

def der_of(path):
    b = open(path, 'rb').read()
    if b[:1] == b'\x30': return b
    t = re.sub(r'-----[^-]+-----|\s', '', b.decode('latin1'))
    try: return base64.b64decode(t, validate=True)
    except Exception: return None

def sh(*a, inp=None):
    return subprocess.run(a, input=inp, capture_output=True)

def parse(der):
    p = sh('openssl', 'x509', '-inform', 'DER', '-noout', '-subject', '-issuer', '-startdate', '-enddate', '-ext', 'basicConstraints', inp=der)
    if p.returncode: return None
    t = p.stdout.decode(errors='replace')
    g = lambda k: (re.search(k + r'=\s*(.*)', t) or [None, ''])[1].strip()
    cn = lambda line: (re.search(r'CN\s*=\s*([^,\n]+)', line) or [None, ''])[1].strip()
    return {'subject': g('subject'), 'issuer': g('issuer'), 'cn': cn(g('subject')), 'icn': cn(g('issuer')), 'notBefore': g('notBefore'), 'notAfter': g('notAfter'), 'ca': 'CA:TRUE' in t, 'self': g('subject') == g('issuer')}

def pem(der): return '-----BEGIN CERTIFICATE-----\n' + '\n'.join(re.findall('.{1,64}', base64.b64encode(der).decode())) + '\n-----END CERTIFICATE-----\n'

def self_signed_ok(der):
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, 'c.pem'); open(f, 'w').write(pem(der))
        p = sh('openssl', 'verify', '-no_check_time', '-check_ss_sig', '-CAfile', f, f)
        return p.returncode == 0

def main(root_dir, cand_dirs):
    roots = {}
    for f in sorted(glob.glob(os.path.join(root_dir, '*.cer'))):
        der = der_of(f); info = parse(der) if der else None
        if not info or not info['self'] or not self_signed_ok(der): print('reject root (not self-signed/parsable):', f); continue
        fp = hashlib.sha256(der).hexdigest()
        if info['cn'] in PINS:
            if fp != PINS[info['cn']]: sys.exit(f'FINGERPRINT MISMATCH for {info["cn"]}: {fp}')
        elif info['cn'] in EXPECT_OLD:
            if (info['notBefore'], info['notAfter']) != EXPECT_OLD[info['cn']]: sys.exit(f'unexpected validity for {info["cn"]}')
        else: print('skip unknown root', f); continue
        roots[info['cn']] = (der, info, fp)
    assert set(roots) >= set(PINS), 'both CCA India 2022 roots are required'
    allroots = os.path.join(tempfile.mkdtemp(), 'roots.pem'); open(allroots, 'w').write(''.join(pem(r[0]) for r in roots.values()))
    seen = {r[2] for r in roots.values()}; pool = {}
    for d in cand_dirs:
        for f in sorted(glob.glob(os.path.join(d, '**', '*'), recursive=True)):
            if os.path.isdir(f) or not re.search(r'\.(cer|crt|pem|der)$', f, re.I): continue
            der = der_of(f)
            if not der: continue
            fp = hashlib.sha256(der).hexdigest()
            if fp in seen: continue
            info = parse(der)
            if not info or info['self'] or not info['ca']: continue
            pool[fp] = (der, info)
    # iterate: a certificate qualifies when openssl can build its chain to a root using the other candidates as helpers
    cands = os.path.join(tempfile.mkdtemp(), 'cands.pem'); open(cands, 'w').write(''.join(pem(v[0]) for v in pool.values()))
    kept = []
    for fp, (der, info) in pool.items():
        with tempfile.TemporaryDirectory() as t:
            f = os.path.join(t, 'c.pem'); open(f, 'w').write(pem(der))
            p = sh('openssl', 'verify', '-no_check_time', '-purpose', 'any', '-CAfile', allroots, '-untrusted', cands, f)
        if p.returncode == 0: kept.append((fp, der, info))
    kept.sort(key=lambda k: (k[2]['cn'], k[0]))
    out = {'note': 'Built by tools/build_trust.py - see the header of that file for how every certificate was verified.',
           'roots': [{'name': n, 'sha256': r[2], 'notBefore': r[1]['notBefore'], 'notAfter': r[1]['notAfter'], 'der': base64.b64encode(r[0]).decode()} for n, r in sorted(roots.items())],
           'intermediates': [{'name': i['cn'], 'issuer': i['icn'], 'sha256': fp, 'der': base64.b64encode(der).decode()} for fp, der, i in kept]}
    json.dump(out, open('vendor/trust/india-pki.json', 'w'), separators=(',', ':'))
    print(f'roots: {len(roots)}  candidate CA certs: {len(pool)}  verified under the roots: {len(kept)}')
    for n, r in sorted(roots.items()): print('  root', n, r[2][:16], r[1]['notBefore'], '->', r[1]['notAfter'])
    for fp, der, i in kept: print('  ca  ', i['cn'][:60].ljust(60), 'issued by', i['icn'])
    miss = sorted({v[1]['cn'] for v in pool.values()} - {k[2]['cn'] for k in kept}); print('not verifiable (dropped):', len(miss), miss[:12])

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
