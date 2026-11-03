#!/usr/bin/env python3
"""Stamps sw.js with the list of files to cache for offline use and a build id.
Run after changing any file:  python3 tools/build_sw.py   (the GitHub Actions workflow does this automatically)"""
import hashlib, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parent.parent
INCLUDE = ['js', 'css', 'vendor', 'assets']
FILES = ['app.html', 'index.html', 'privacy.html', 'terms.html', 'disclaimer.html', 'licenses.html', '404.html', 'manifest.webmanifest']
paths = list(FILES)
for d in INCLUDE:
    for p in sorted((ROOT / d).rglob('*')):
        if p.is_file() and not p.name.endswith('.map') and p.name != 'maskable.svg':
            paths.append(p.relative_to(ROOT).as_posix())
paths = [p for p in paths if (ROOT / p).exists()]
h = hashlib.sha256()
for p in paths: h.update(p.encode()); h.update((ROOT / p).read_bytes())
build = h.hexdigest()[:12]
sw = (ROOT / 'sw.js').read_text()
sw = re.sub(r"const VERSION = '.*?';", f"const VERSION = '{build}';", sw)
sw = re.sub(r"const PRECACHE = .*?;\n", "const PRECACHE = " + __import__('json').dumps(paths) + ";\n", sw, count=1, flags=re.S)
(ROOT / 'sw.js').write_text(sw)
print(f'sw.js: {len(paths)} files, build {build}')
