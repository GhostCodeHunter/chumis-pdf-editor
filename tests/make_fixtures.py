import subprocess, os, re, random, tempfile
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
OUT = os.path.join(os.path.dirname(__file__), 'fixtures'); os.makedirs(OUT, exist_ok=True)

# --- Verhoeff
d=[[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
p=[[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
inv=[0,4,3,2,1,5,6,7,8,9]
def vdigit(s):
    c=0
    for i,ch in enumerate(reversed(s)): c=d[c][p[(i+1)%8][int(ch)]]
    return str(inv[c])
aad = '23456789012'; aad += vdigit(aad)
open(os.path.join(OUT,'aadhaar-number.txt'),'w').write(aad)

# --- Aadhaar-like card (text PDF)
c = canvas.Canvas(os.path.join(OUT,'aadhaar-like.pdf'), pagesize=(595,420))
c.setFont('Helvetica-Bold',16); c.drawString(40,380,'GOVERNMENT OF INDIA'); c.setFont('Helvetica',11); c.drawString(40,360,'Unique Identification Authority of India  -  Aadhaar')
c.setFont('Helvetica-Bold',14); c.drawString(40,310,'Chumi Test Customer'); c.setFont('Helvetica',12); c.drawString(40,290,'DOB: 12/03/1990'); c.drawString(40,272,'MALE')
c.setFont('Helvetica-Bold',22); c.drawString(40,210,' '.join([aad[:4],aad[4:8],aad[8:]]))
c.setFont('Helvetica',10); c.drawString(40,150,'Aadhaar - Aam Aadmi ka Adhikar'); c.showPage(); c.save()

# --- GST-like certificate (text PDF) then sign it
gst = '27AAPFU0939F1ZV'
c = canvas.Canvas(os.path.join(OUT,'gst-unsigned.pdf'), pagesize=A4); W,H=A4
c.setFont('Helvetica-Bold',16); c.drawString(72,H-80,'Government of India'); c.drawString(72,H-102,'Form GST REG-06 - Registration Certificate')
c.setFont('Helvetica',12)
for i,(k,v) in enumerate([('Registration Number',gst),('Legal Name','UPPAL FASHIONS (FIRM)'),('Trade Name','Uppal Fashions'),('Constitution of Business','Partnership'),('Date of Liability','01/07/2017'),('PAN','AAPFU0939F')]): c.drawString(72,H-150-i*22,f'{k}: {v}')
c.showPage(); c.save()

def run(*a, **k): return subprocess.run(a, check=True, capture_output=True, **k)
tmp = tempfile.mkdtemp()
key, crt = os.path.join(tmp,'k.pem'), os.path.join(tmp,'c.pem')
run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',crt,'-days','3650','-subj','/CN=Test Signer for Chumi/O=Chumi Test Org/C=IN','-sha256')
base = open(os.path.join(OUT,'gst-unsigned.pdf'),'rb').read()
startxref = int(re.findall(rb'startxref\s+(\d+)', base)[-1]); size = int(re.findall(rb'/Size\s+(\d+)', base)[-1])
SIGLEN = 8192
sig_num, widget_num = size, size + 1
page_obj = re.search(rb'\n4 0 obj\n<<(.*?)>>\nendobj', base, re.S).group(1)
root_obj = re.search(rb'\n5 0 obj\n<<(.*?)>>\nendobj', base, re.S).group(1)

def incremental(prev, with_sig_hex, extra_text=None):
    """Append: signature value, widget, new page (with /Annots), new catalog (with /AcroForm)."""
    body = prev + (b'\n' if not prev.endswith(b'\n') else b'')
    objs = []  # (num, bytes)
    sig = (f'{sig_num} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0000000000 0000000000 0000000000] /Contents <').encode() + with_sig_hex + b'> /M (D:20260301120000Z) /Name (Test Signer) /Reason (Approved for GST registration) /Location (Kollam) >>\nendobj\n'
    widget = f'{widget_num} 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /V {sig_num} 0 R /Rect [60 560 330 640] /F 132 /P 4 0 R >>\nendobj\n'.encode()
    page = b'4 0 obj\n<<' + page_obj.rstrip() + b' /Annots [ ' + f'{widget_num} 0 R'.encode() + b' ] >>\nendobj\n'
    root = b'5 0 obj\n<<' + root_obj.rstrip() + b' /AcroForm << /Fields [ ' + f'{widget_num} 0 R'.encode() + b' ] /SigFlags 3 >> >>\nendobj\n'
    pos = {}; out = body
    for num, ob in [(sig_num, sig), (widget_num, widget), (4, page), (5, root)]:
        pos[num] = len(out); out += ob
    xref_off = len(out)
    xref = b'xref\n0 0\n' if False else b'xref\n'
    for num in sorted(pos): xref += f'{num} 1\n{pos[num]:010d} 00000 n \n'.encode()
    xref += f'trailer\n<< /Size {widget_num+1} /Root 5 0 R /Prev {startxref} >>\nstartxref\n{xref_off}\n%%EOF\n'.encode()
    full = out + xref
    i = full.index(b'/Contents <') + len(b'/Contents '); j = full.index(b'>', i) + 1
    br = f'/ByteRange [0 {i:010d} {j:010d} {len(full)-j:010d}]'.encode()
    full = full.replace(b'/ByteRange [0 0000000000 0000000000 0000000000]', br)
    return full, i, j

full, i, j = incremental(base, b'0'*SIGLEN)
open(os.path.join(tmp,'content.bin'),'wb').write(full[:i] + full[j:])
run('openssl','cms','-sign','-binary','-in',os.path.join(tmp,'content.bin'),'-signer',crt,'-inkey',key,'-outform','DER','-out',os.path.join(tmp,'sig.der'),'-md','sha256')
sig = open(os.path.join(tmp,'sig.der'),'rb').read().hex().encode(); assert len(sig) <= SIGLEN
signed = full[:i+1] + sig + b'0'*(SIGLEN-len(sig)) + full[j-1:]; assert len(signed)==len(full)
open(os.path.join(OUT,'gst-signed.pdf'),'wb').write(signed)
open(os.path.join(OUT,'gst-signed-tampered.pdf'),'wb').write(signed.replace(b'Approved for GST registration', b'Approved for GST registratioz',1))
# modified AFTER signing: append an incremental update that adds a text annotation to page 1 (signature stays intact for its revision)
prev_x = int(re.findall(rb'startxref\s+(\d+)', signed)[-1]); nobj = widget_num + 1
note = f'{nobj} 0 obj\n<< /Type /Annot /Subtype /FreeText /Rect [60 500 330 530] /Contents (Edited after signing) /DA (0 0 0 rg /Helv 12 Tf) /F 4 /P 4 0 R >>\nendobj\n'.encode()
page2 = b'4 0 obj\n<<' + page_obj.rstrip() + b' /Annots [ ' + f'{widget_num} 0 R {nobj} 0 R'.encode() + b' ] >>\nendobj\n'
m = signed + b'\n'; o1 = len(m); m += note; o2 = len(m); m += page2; xo = len(m)
m += f'xref\n{nobj} 1\n{o1:010d} 00000 n \n4 1\n{o2:010d} 00000 n \ntrailer\n<< /Size {nobj+1} /Root 5 0 R /Prev {prev_x} >>\nstartxref\n{xo}\n%%EOF\n'.encode()
open(os.path.join(OUT,'gst-signed-then-edited.pdf'),'wb').write(m)
import shutil; shutil.copy(crt, os.path.join(OUT,'test-signer.pem'))
print('fixtures ok', aad)
