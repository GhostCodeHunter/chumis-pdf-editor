"""A Tally-style invoice: ruled table, bold description cells, other cells in the same row, a padded text run."""
import os
from reportlab.pdfgen import canvas
OUT = os.path.join(os.path.dirname(__file__), 'fixtures'); os.makedirs(OUT, exist_ok=True)
c = canvas.Canvas(os.path.join(OUT, 'invoice-table.pdf'), pagesize=(595, 842))
cols = [40, 62, 300, 350, 400, 450, 480, 555]   # vertical rules
top, bottom = 760, 560
c.setLineWidth(0.7)
for x in cols: c.line(x, top, x, bottom)
for y in (top, 730, 700, 668, 640, bottom): c.line(cols[0], y, cols[-1], y)
c.setFont('Helvetica', 9); c.drawString(44, 735, 'Sl'); c.drawString(150, 735, 'Description of Services'); c.drawString(305, 735, 'HSN/SAC'); c.drawString(355, 735, 'Quantity'); c.drawString(405, 735, 'Rate'); c.drawString(455, 735, 'per'); c.drawString(500, 735, 'Amount')
def row(y, n, desc, hsn, qty, rate, per, amt, pad=False):
    c.setFont('Helvetica', 9); c.drawString(46, y, n)
    c.setFont('Helvetica-Bold', 10)
    if pad:   # description run followed by a very large space adjustment, as some accounting packages emit
        name = c._doc.getInternalFontName('Helvetica-Bold')
        c._code.append(f'BT /{name} 10 Tf 1 0 0 1 66 {y} Tm [({desc}) -90000 ( )] TJ ET')
    else: c.drawString(66, y, desc)
    c.setFont('Helvetica', 9); c.drawString(304, y, hsn)
    c.setFont('Helvetica-Bold', 9); c.drawString(354, y, qty)
    c.setFont('Helvetica', 9); c.drawString(404, y, rate); c.drawString(454, y, per)
    c.setFont('Helvetica-Bold', 10); c.drawRightString(552, y, amt)
row(708, '1', 'Rent & Internet Charges Receivables', '997212', '1.00 Month', '13,411.80', 'Month', '13,411.80', pad=True)
row(678, '2', 'Rent Charges (Security & Parking)', '997212', '1.00 NOS', '1,490.20', 'NOS', '1,490.20')
c.showPage(); c.save(); print('invoice ok')
