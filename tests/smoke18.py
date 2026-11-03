# "Download for offline use": fonts (mock CDN) + OCR warm-up (stand-in engine) -> both marked ready.
import asyncio, os, re
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'
async def route_fonts(route):
    u = route.request.url; m = re.search(r'/fontsource/fonts/([a-z0-9-]+)@latest/latin-(\d+-(?:normal|italic))\.woff$', u)
    f = f'/tmp/gf/roboto-{m.group(2)}.woff' if m else None
    if f and os.path.exists(f): await route.fulfill(status=200, content_type='font/woff', headers={'access-control-allow-origin':'*'}, body=open(f,'rb').read())
    else: await route.fulfill(status=404, body='nope', headers={'access-control-allow-origin':'*'})
STUB = "window.Tesseract = { createWorker: async (langs, oem, o) => { o && o.logger && o.logger({ status: 'loading language traineddata', progress: 1 }); window.__warm = (window.__warm||0)+1; return { recognize: async () => ({ data: { text: 'Chumi', words: [], lines: [] } }), terminate: async () => {} }; } };"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1366,'height':900}); pg = await ctx.new_page()
        await pg.add_init_script(STUB); await pg.route(re.compile(r'https://cdn\.jsdelivr\.net/(fontsource|npm/@fontsource)/.*'), route_fonts)
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') and '404' not in m.text else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_selector('.off-ctl button'); await pg.click('.off-ctl button'); await pg.wait_for_selector('.off-list'); await pg.wait_for_timeout(500)
        print('before:', (await pg.inner_text('.modal .off-list')).count('Needs a download'), 'items need a download')
        await pg.click('.modal button:has-text("Download for offline use")'); await pg.wait_for_selector('.modal .off-row:nth-child(4) .pill.ok', timeout=60000); await pg.wait_for_timeout(500)
        print('after:', (await pg.inner_text('.modal .off-list')).count('Ready offline'), 'items ready | OCR warm-up calls:', await pg.evaluate('window.__warm'), '| flags:', await pg.evaluate("localStorage.getItem('chumi.offline.v1')"))
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
