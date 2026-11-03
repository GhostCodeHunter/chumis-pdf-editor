"""A registration-certificate style page: grey diagonal watermark behind a ruled table, tinted cell, text over all of it."""
import os
from reportlab.pdfgen import canvas
OUT = os.path.join(os.path.dirname(__file__), 'fixtures')
c = canvas.Canvas(os.path.join(OUT, 'watermarked-table.pdf'), pagesize=(595, 842))
c.saveState(); c.translate(180, 670); c.rotate(8); c.setFillGray(0.84); c.setFont('Helvetica-Bold', 44); c.drawCentredString(0, 0, 'Goods and Services Tax'); c.restoreState()
c.setFillColorRGB(0.93, 0.95, 1.0); c.rect(62, 640, 238, 30, stroke=0, fill=1)     # tinted cell
c.setStrokeGray(0); c.setLineWidth(0.7)
for x in (40, 62, 300, 555): c.line(x, 760, x, 560)
for y in (760, 730, 700, 670, 640, 600, 560): c.line(40, y, 555, y)
c.setFillColorRGB(0, 0, 0.6)
c.setFont('Helvetica-Bold', 9); c.drawString(66, 708, 'Legal Name'); c.drawString(66, 678, 'Address of Principal Place of Business'); c.drawString(66, 648, 'RAVICHANDRAN SHIVASHANKAR')
c.setFont('Helvetica', 9); c.drawString(304, 708, 'NESTONGARMENTS PRIVATE LIMITED'); c.drawString(304, 678, 'Floor No.: 2nd floor, Bhuvaneshwari Nagar'); c.drawString(304, 648, 'Karnataka')
c.showPage(); c.save(); print('watermark fixture ok')
