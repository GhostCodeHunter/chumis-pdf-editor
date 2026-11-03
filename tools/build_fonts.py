#!/usr/bin/env python3
"""Builds the bundled Google Font (Poppins, Latin subset, static TTF) in vendor/fonts/ from locally installed OFL fonts.
Only fonts WITHOUT a Reserved Font Name may be subset and redistributed this way (Poppins qualifies).
Needs fontTools. Run:  python3 tools/build_fonts.py"""
import pathlib, io
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib import instancer

OUT = pathlib.Path(__file__).resolve().parent.parent / 'vendor' / 'fonts'
SRC = pathlib.Path('/usr/share/fonts/truetype/google-fonts')
UNICODES = [*range(0x20, 0x7F), *range(0xA0, 0x100), 0x131, 0x152, 0x153, 0x2C6, 0x2DA, 0x2DC, 0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203A, 0x20AC, 0x20B9, 0x2122, 0x2212]

def write(font, name):
    opts = subset.Options(); opts.layout_features = ['kern', 'liga']; opts.hinting = False; opts.notdef_outline = True; opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]; opts.drop_tables += ['DSIG']
    s = subset.Subsetter(opts); s.populate(unicodes=UNICODES); s.subset(font)
    font.flavor = None; p = OUT / name; font.save(p); print(f'{name}: {p.stat().st_size/1024:.1f} KB, glyphs={len(font.getGlyphOrder())}')

for style, f in [('400', 'Poppins-Regular'), ('700', 'Poppins-Bold'), ('400i', 'Poppins-Italic'), ('700i', 'Poppins-BoldItalic')]:
    write(TTFont(SRC / f'{f}.ttf'), f'poppins-{style}.ttf')
# licence texts + copyright lines taken from the fonts themselves
for fam, fn in [('Poppins', 'poppins-400.ttf')]:
    t = TTFont(OUT / fn); cr = t['name'].getDebugName(0); lic = t['name'].getDebugName(13); print(fam, '|', cr, '|', (lic or '')[:60])
