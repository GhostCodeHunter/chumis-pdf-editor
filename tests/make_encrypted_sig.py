"""A password-protected (RC4-128) PDF that is then signed - the way e-Aadhaar / e-PAN files are (the signature covers the encrypted bytes).
Usage: python3 tests/make_encrypted_sig.py OUTDIR      -> OUTDIR/encrypted-signed.pdf (user password: secret), OUTDIR/enc-root.pem"""
import os, re, sys, struct, hashlib, subprocess, tempfile
from reportlab.pdfgen import canvas
from reportlab.lib.pdfencrypt import StandardEncryption
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True); tmp = tempfile.mkdtemp(); P = lambda n: os.path.join(tmp, n)
def run(*a, **k): return subprocess.run(a, check=True, capture_output=True, **k)
enc = StandardEncryption('secret', 'owner-secret', canPrint=1, canModify=0, canCopy=1, canAnnotate=0, strength=128)
c = canvas.Canvas(P('base.pdf'), pagesize=(595, 842), encrypt=enc); c.setFont('Helvetica-Bold', 14); c.drawString(72, 780, 'Government of India - Unique Identification Authority'); c.setFont('Helvetica', 11); c.drawString(72, 750, 'Aadhaar letter (test document, not a real one)'); c.showPage(); c.save()
base = open(P('base.pdf'), 'rb').read()
key = bytes.fromhex(re.search(r'(?i)encryption key = ([0-9a-f]+)', run('qpdf', '--password=secret', '--show-encryption', '--show-encryption-key', P('base.pdf')).stdout.decode()).group(1))
def rc4(k, d):
    S = list(range(256)); j = 0
    for i in range(256): j = (j + S[i] + k[i % len(k)]) % 256; S[i], S[j] = S[j], S[i]
    i = j = 0; o = bytearray()
    for b in d: i = (i + 1) % 256; j = (j + S[i]) % 256; S[i], S[j] = S[j], S[i]; o.append(b ^ S[(S[i] + S[j]) % 256])
    return bytes(o)
ek = lambda num: hashlib.md5(key + struct.pack('<I', num)[:3] + struct.pack('<I', 0)[:2]).digest()[:min(len(key) + 5, 16)]
hexstr = lambda num, s: '<' + rc4(ek(num), s.encode('latin1')).hex() + '>'
startxref = int(re.findall(rb'startxref\s+(\d+)', base)[-1]); size = int(re.findall(rb'/Size\s+(\d+)', base)[-1])
tr = base[base.rindex(b'trailer'):]; encref = re.search(rb'/Encrypt (\d+ 0 R)', tr).group(1); fid = re.search(rb'/ID\s*(\[[^\]]*\])', tr).group(1)
T = rb'(?:(?!endobj).)*?'
pg = re.search(rb'\n(\d+) 0 obj\n<<(' + T + rb'/Type /Page\b' + T + rb')>>\nendobj', base, re.S); page_num, page_obj = int(pg.group(1)), pg.group(2)
rt = re.search(rb'\n(\d+) 0 obj\n<<(' + T + rb'/Type /Catalog' + T + rb')>>\nendobj', base, re.S); root_num, root_obj = int(rt.group(1)), rt.group(2)
sig_num, widget_num, ap_num = size, size + 1, size + 2
SIGLEN = 16384
ap = b'q 1 1 1 rg 0 0 270 80 re f Q BT /F1 9 Tf 4 66 Td 0 g (Signature Not Verified) Tj ET BT /F2 46 Tf 110 14 Td 1 0.82 0 rg (?) Tj ET BT /F1 8 Tf 4 44 Td 0 g (Digitally signed by DS UIDAI TEST) Tj 0 -10 Td (Unique Identification Authority of India) Tj 0 -10 Td (Date: 2026.09.19 19:15:18 IST) Tj ET'
apenc = rc4(ek(ap_num), ap)
sig = f'{sig_num} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0000000000 0000000000 0000000000] /Contents <'.encode() + b'0' * SIGLEN + f'> /M {hexstr(sig_num, "D:20260919174500Z")} /Name {hexstr(sig_num, "DS UIDAI TEST")} >>\nendobj\n'.encode()
widget = f'{widget_num} 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Sig /T {hexstr(widget_num, "Signature1")} /V {sig_num} 0 R /Rect [60 560 330 640] /F 132 /P {page_num} 0 R /AP << /N {ap_num} 0 R >> >>\nendobj\n'.encode()
apobj = f'{ap_num} 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 270 80] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Length {len(apenc)} >>\nstream\n'.encode() + apenc + b'\nendstream\nendobj\n'
page = f'{page_num} 0 obj\n<<'.encode() + page_obj.rstrip() + b' /Annots [ ' + f'{widget_num} 0 R'.encode() + b' ] >>\nendobj\n'
root = f'{root_num} 0 obj\n<<'.encode() + root_obj.rstrip() + b' /AcroForm << /Fields [ ' + f'{widget_num} 0 R'.encode() + b' ] /SigFlags 3 >> >>\nendobj\n'
out = base + (b'\n' if not base.endswith(b'\n') else b''); pos = {}
for num, ob in [(sig_num, sig), (widget_num, widget), (ap_num, apobj), (page_num, page), (root_num, root)]: pos[num] = len(out); out += ob
xo = len(out); xref = b'xref\n'
for num in sorted(pos): xref += f'{num} 1\n{pos[num]:010d} 00000 n \n'.encode()
xref += f'trailer\n<< /Size {ap_num + 1} /Root {root_num} 0 R /Encrypt '.encode() + encref + b' /ID ' + fid + f' /Prev {startxref} >>\nstartxref\n{xo}\n%%EOF\n'.encode()
full = out + xref
i = full.index(b'/Contents <') + len(b'/Contents '); j = full.index(b'>', i) + 1
full = full.replace(b'/ByteRange [0 0000000000 0000000000 0000000000]', f'/ByteRange [0 {i:010d} {j:010d} {len(full) - j:010d}]'.encode())
# keys / chain
def mk(cn, issuer=None, ca=False):
    k, cr, cs, ext = P(cn + '.key'), P(cn + '.pem'), P(cn + '.csr'), P(cn + '.ext')
    run('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', k, '-out', cs, '-subj', f'/CN={cn}/O=Chumi Test/C=IN'); open(ext, 'w').write('basicConstraints=CA:%s\nkeyUsage=%s\nsubjectKeyIdentifier=hash\n' % ('TRUE' if ca else 'FALSE', 'keyCertSign,cRLSign' if ca else 'digitalSignature,nonRepudiation'))
    if issuer is None: run('openssl', 'x509', '-req', '-in', cs, '-signkey', k, '-out', cr, '-days', '3650', '-sha256', '-extfile', ext)
    else: run('openssl', 'x509', '-req', '-in', cs, '-CA', P(issuer + '.pem'), '-CAkey', P(issuer + '.key'), '-CAcreateserial', '-out', cr, '-days', '3650', '-sha256', '-extfile', ext)
mk('Enc Root CA', ca=True); mk('Enc Sub CA', 'Enc Root CA', ca=True); mk('DS UIDAI TEST', 'Enc Sub CA')
open(P('chain.pem'), 'wb').write(open(P('Enc Sub CA.pem'), 'rb').read() + open(P('Enc Root CA.pem'), 'rb').read())
open(P('content.bin'), 'wb').write(full[:i] + full[j:])
run('openssl', 'cms', '-sign', '-binary', '-in', P('content.bin'), '-signer', P('DS UIDAI TEST.pem'), '-inkey', P('DS UIDAI TEST.key'), '-certfile', P('chain.pem'), '-outform', 'DER', '-out', P('sig.der'), '-md', 'sha256')
hx = open(P('sig.der'), 'rb').read().hex().encode(); assert len(hx) <= SIGLEN
signed = full[:i + 1] + hx + b'0' * (SIGLEN - len(hx)) + full[j - 1:]; assert len(signed) == len(full)
open(os.path.join(OUT, 'encrypted-signed.pdf'), 'wb').write(signed); open(os.path.join(OUT, 'enc-root.pem'), 'wb').write(open(P('Enc Root CA.pem'), 'rb').read())
print('ok', len(signed))
