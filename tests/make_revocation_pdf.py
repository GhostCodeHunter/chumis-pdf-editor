"""Signed PDFs whose DSS (appended after signing, as in LTV) carries a CRL and an OCSP response.
Usage: python3 tests/make_revocation_pdf.py REVDIR OUTDIR   (REVDIR from tests/make_revocation.py)"""
import os, re, sys, tempfile, subprocess
from reportlab.pdfgen import canvas
REV, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True); tmp = tempfile.mkdtemp()
def run(*a): return subprocess.run(a, check=True, capture_output=True)
c = canvas.Canvas(os.path.join(tmp, 'base.pdf'), pagesize=(595, 842)); c.setFont('Helvetica', 12); c.drawString(72, 780, 'Revocation test document'); c.showPage(); c.save()
base = open(os.path.join(tmp, 'base.pdf'), 'rb').read()
startxref = int(re.findall(rb'startxref\s+(\d+)', base)[-1]); size = int(re.findall(rb'/Size\s+(\d+)', base)[-1])
T = rb'(?:(?!endobj).)*?'
pg = re.search(rb'\n(\d+) 0 obj\n<<(' + T + rb'/Type /Page\b' + T + rb')>>\nendobj', base, re.S); page_num, page_obj = int(pg.group(1)), pg.group(2)
rt = re.search(rb'\n(\d+) 0 obj\n<<(' + T + rb'/Type /Catalog' + T + rb')>>\nendobj', base, re.S); root_num, root_obj = int(rt.group(1)), rt.group(2)
trailer_extra = b''
def build(leaf):
    sig_num, widget_num = size, size + 1; SIGLEN = 16384
    sig = f'{sig_num} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0000000000 0000000000 0000000000] /Contents <'.encode() + b'0' * SIGLEN + b'> /M (D:20990101000000Z) /Name (Revocation test) >>\nendobj\n'
    widget = f'{widget_num} 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /V {sig_num} 0 R /Rect [60 700 330 760] /F 132 /P {page_num} 0 R >>\nendobj\n'.encode()
    page = f'{page_num} 0 obj\n<<'.encode() + page_obj.rstrip() + b' /Annots [ ' + f'{widget_num} 0 R'.encode() + b' ] >>\nendobj\n'
    root = f'{root_num} 0 obj\n<<'.encode() + root_obj.rstrip() + b' /AcroForm << /Fields [ ' + f'{widget_num} 0 R'.encode() + b' ] /SigFlags 3 >> >>\nendobj\n'
    out = base + (b'\n' if not base.endswith(b'\n') else b''); pos = {}
    for num, ob in [(sig_num, sig), (widget_num, widget), (page_num, page), (root_num, root)]: pos[num] = len(out); out += ob
    xo = len(out); xref = b'xref\n'
    for num in sorted(pos): xref += f'{num} 1\n{pos[num]:010d} 00000 n \n'.encode()
    xref += f'trailer\n<< /Size {widget_num + 1} /Root {root_num} 0 R /Prev {startxref} >>\nstartxref\n{xo}\n%%EOF\n'.encode()
    full = out + xref; i = full.index(b'/Contents <') + len(b'/Contents '); j = full.index(b'>', i) + 1
    full = full.replace(b'/ByteRange [0 0000000000 0000000000 0000000000]', f'/ByteRange [0 {i:010d} {j:010d} {len(full) - j:010d}]'.encode())
    open(os.path.join(tmp, 'content.bin'), 'wb').write(full[:i] + full[j:])
    run('openssl', 'cms', '-sign', '-binary', '-in', os.path.join(tmp, 'content.bin'), '-signer', os.path.join(REV, leaf + '.pem'), '-inkey', os.path.join(REV, leaf + '.key'), '-certfile', os.path.join(REV, 'ca.pem'), '-outform', 'DER', '-out', os.path.join(tmp, 'sig.der'), '-md', 'sha256')
    hx = open(os.path.join(tmp, 'sig.der'), 'rb').read().hex().encode(); signed = full[:i + 1] + hx + b'0' * (SIGLEN - len(hx)) + full[j - 1:]
    # LTV-style update AFTER signing: /DSS with the CRL and the OCSP response
    n = widget_num + 1; crl = open(os.path.join(REV, 'ca.crl'), 'rb').read(); ocsp = open(os.path.join(REV, leaf + '.ocsp'), 'rb').read()
    objs = [(n, f'{n} 0 obj\n<< /Length {len(crl)} >>\nstream\n'.encode() + crl + b'\nendstream\nendobj\n'), (n + 1, f'{n+1} 0 obj\n<< /Length {len(ocsp)} >>\nstream\n'.encode() + ocsp + b'\nendstream\nendobj\n'),
            (n + 2, f'{n+2} 0 obj\n<< /CRLs [ {n} 0 R ] /OCSPs [ {n+1} 0 R ] >>\nendobj\n'.encode()), (root_num, f'{root_num} 0 obj\n<<'.encode() + root_obj.rstrip() + b' /AcroForm << /Fields [ ' + f'{widget_num} 0 R'.encode() + b' ] /SigFlags 3 >> ' + f'/DSS {n+2} 0 R >>\nendobj\n'.encode())]
    m = signed + b'\n'; pos2 = {}; prev = int(re.findall(rb'startxref\s+(\d+)', signed)[-1])
    for num, ob in objs: pos2[num] = len(m); m += ob
    xo2 = len(m); x2 = b'xref\n'
    for num in sorted(pos2): x2 += f'{num} 1\n{pos2[num]:010d} 00000 n \n'.encode()
    m += x2 + f'trailer\n<< /Size {n + 3} /Root {root_num} 0 R /Prev {prev} >>\nstartxref\n{xo2}\n%%EOF\n'.encode()
    return m
for leaf in ('good', 'bad'):
    open(os.path.join(OUT, f'rev-{leaf}.pdf'), 'wb').write(build(leaf))
open(os.path.join(OUT, 'rev-root.pem'), 'wb').write(open(os.path.join(REV, 'ca.pem'), 'rb').read()); print('ok')
