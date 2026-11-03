"""Builds PDFs signed in the different ways real-world signing software produces them, to exercise js/sigcheck.js.
Usage: python3 tests/make_sig_variants.py OUTDIR"""
import subprocess, os, re, sys, tempfile, hashlib
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
FIX = os.path.join(os.path.dirname(__file__), 'fixtures')
base = open(os.path.join(FIX, 'gst-unsigned.pdf'), 'rb').read()
startxref = int(re.findall(rb'startxref\s+(\d+)', base)[-1]); size = int(re.findall(rb'/Size\s+(\d+)', base)[-1])
sig_num, widget_num = size, size + 1
page_obj = re.search(rb'\n4 0 obj\n<<(.*?)>>\nendobj', base, re.S).group(1)
root_obj = re.search(rb'\n5 0 obj\n<<(.*?)>>\nendobj', base, re.S).group(1)
def run(*a, **k): return subprocess.run(a, check=True, capture_output=True, **k)
tmp = tempfile.mkdtemp()
P = lambda n: os.path.join(tmp, n)

def pdf_with_placeholder(siglen, subfilter='adbe.pkcs7.detached', extra=b''):
    body = base + (b'\n' if not base.endswith(b'\n') else b'')
    sig = (f'{sig_num} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /{subfilter} /ByteRange [0 0000000000 0000000000 0000000000] /Contents <').encode() + b'0' * siglen + b'> /M (D:20260919174500+05\'30\') /Name (DS Test) /Reason (Testing) >>\nendobj\n'
    widget = f'{widget_num} 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /V {sig_num} 0 R /Rect [60 560 330 640] /F 132 /P 4 0 R >>\nendobj\n'.encode()
    page = b'4 0 obj\n<<' + page_obj.rstrip() + b' /Annots [ ' + f'{widget_num} 0 R'.encode() + b' ] >>\nendobj\n'
    root = b'5 0 obj\n<<' + root_obj.rstrip() + b' /AcroForm << /Fields [ ' + f'{widget_num} 0 R'.encode() + b' ] /SigFlags 3 >> >>\nendobj\n'
    pos = {}; out = body
    for num, ob in [(sig_num, sig), (widget_num, widget), (4, page), (5, root)]:
        pos[num] = len(out); out += ob
    xo = len(out); xref = b'xref\n'
    for num in sorted(pos): xref += f'{num} 1\n{pos[num]:010d} 00000 n \n'.encode()
    xref += f'trailer\n<< /Size {widget_num+1} /Root 5 0 R /Prev {startxref} >>\nstartxref\n{xo}\n%%EOF\n'.encode() + extra
    full = out + xref
    i = full.index(b'/Contents <') + len(b'/Contents '); j = full.index(b'>', i) + 1
    br = f'/ByteRange [0 {i:010d} {j:010d} {len(full)-j:010d}]'.encode()
    return full.replace(b'/ByteRange [0 0000000000 0000000000 0000000000]', br), i, j

# keys: root CA -> sub CA -> leaf (like e-Mudhra), plus a plain self-signed one
def mk(cn, issuer=None, ca=False):
    k, c, csr = P(cn+'.key'), P(cn+'.pem'), P(cn+'.csr')
    run('openssl','req','-newkey','rsa:2048','-nodes','-keyout',k,'-out',csr,'-subj',f'/CN={cn}/O=Chumi Test/C=IN')
    ext = P(cn+'.ext'); open(ext,'w').write('basicConstraints=CA:%s\nkeyUsage=%s\nsubjectKeyIdentifier=hash\n' % ('TRUE' if ca else 'FALSE', 'keyCertSign,cRLSign' if ca else 'digitalSignature,nonRepudiation'))
    if issuer is None: run('openssl','x509','-req','-in',csr,'-signkey',k,'-out',c,'-days','3650','-sha256','-extfile',ext)
    else: run('openssl','x509','-req','-in',csr,'-CA',P(issuer+'.pem'),'-CAkey',P(issuer+'.key'),'-CAcreateserial','-out',c,'-days','3650','-sha256','-extfile',ext)
    return k, c
mk('Test Root CA', ca=True); mk('Test Sub CA', 'Test Root CA', ca=True); lk, lc = mk('Test Leaf Signer', 'Test Sub CA')
chain = P('chain.pem'); open(chain,'wb').write(open(P('Test Sub CA.pem'),'rb').read() + open(P('Test Root CA.pem'),'rb').read())
for n in ('Test Root CA', 'Test Sub CA'): open(os.path.join(OUT, n.replace(' ','-')+'.pem'),'wb').write(open(P(n+'.pem'),'rb').read())

def cms(content_path, *flags):
    run('openssl','cms','-sign','-binary','-in',content_path,'-signer',lc,'-inkey',lk,'-certfile',chain,'-outform','DER','-out',P('sig.der'),*flags)
    return open(P('sig.der'),'rb').read()

def emit(name, subfilter, builder, siglen=16384):
    full, i, j = pdf_with_placeholder(siglen, subfilter)
    content = full[:i] + full[j:]; open(P('content.bin'),'wb').write(content)
    der = builder(content); hx = der.hex().encode(); assert len(hx) <= siglen - 2, (name, len(hx))
    signed = full[:i+1] + hx + b'0' * (siglen - len(hx)) + full[j-1:]; assert len(signed) == len(full)
    open(os.path.join(OUT, name + '.pdf'), 'wb').write(signed)

emit('detached-sha256',  'adbe.pkcs7.detached', lambda c: cms(P('content.bin'), '-md', 'sha256'))
emit('detached-sha1',    'adbe.pkcs7.detached', lambda c: cms(P('content.bin'), '-md', 'sha1'))
emit('detached-sha512',  'adbe.pkcs7.detached', lambda c: cms(P('content.bin'), '-md', 'sha512'))
emit('stream-ber',       'adbe.pkcs7.detached', lambda c: cms(P('content.bin'), '-md', 'sha256', '-stream'))
emit('keyid',            'adbe.pkcs7.detached', lambda c: cms(P('content.bin'), '-md', 'sha256', '-keyid'))
emit('noattr',           'adbe.pkcs7.detached', lambda c: cms(P('content.bin'), '-md', 'sha256', '-noattr'))
emit('pss',              'adbe.pkcs7.detached', lambda c: cms(P('content.bin'), '-md', 'sha256', '-keyopt', 'rsa_padding_mode:pss'))
def sha1style(c):  # adbe.pkcs7.sha1: the SHA-1 digest of the byte range is the encapsulated content
    open(P('digest.bin'),'wb').write(hashlib.sha1(c).digest())
    return cms(P('digest.bin'), '-md', 'sha1', '-nodetach')
emit('pkcs7-sha1',       'adbe.pkcs7.sha1', sha1style)
emit('pkcs7-sha1-sha256', 'adbe.pkcs7.sha1', lambda c: (open(P('digest.bin'),'wb').write(hashlib.sha1(c).digest()), cms(P('digest.bin'), '-md', 'sha256', '-nodetach'))[1])
# signer certificate placed LAST in the certificate list (real files often list the CA certificates first)
allc = P('all.pem'); open(allc,'wb').write(open(chain,'rb').read() + open(lc,'rb').read())
def ordered(c, *extra):
    run('openssl','cms','-sign','-binary','-in',P('content.bin'),'-signer',lc,'-inkey',lk,'-certfile',allc,'-nocerts','-outform','DER','-out',P('sig.der'),'-md','sha256',*extra); return open(P('sig.der'),'rb').read()
emit('cert-last',        'adbe.pkcs7.detached', lambda c: ordered(c))
emit('cert-last-keyid',  'adbe.pkcs7.detached', lambda c: ordered(c, '-keyid'))
# tampered after signing (must be INVALID)
emit('detached-sha256-tampered', 'adbe.pkcs7.detached', lambda c: cms(P('content.bin'), '-md', 'sha256'))
tp = os.path.join(OUT, 'detached-sha256-tampered.pdf'); raw = open(tp,'rb').read(); open(tp,'wb').write(raw.replace(b'/Reason (Testing)', b'/Reason (Testinh)', 1))
# x509.rsa_sha1: Contents = raw PKCS#1 v1.5 signature over SHA-1 of the byte range; certificate is in /Cert
print('ok', sorted(os.listdir(OUT)))
