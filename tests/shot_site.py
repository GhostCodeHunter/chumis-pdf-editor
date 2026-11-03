import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, vp in [('d', {'width':1366,'height':860}), ('m', {'width':390,'height':844})]:
            pg = await (await b.new_context(viewport=vp, device_scale_factor=1)).new_page()
            pg.on('console', lambda m: print('[console]', m.type, m.text) if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: print('[pageerror]', e))
            await pg.goto('http://127.0.0.1:8765/index.html'); await pg.wait_for_timeout(2600)
            await pg.screenshot(path=f'/tmp/site_{name}_hero.png')
            h = await pg.evaluate('document.documentElement.scrollHeight')
            # scroll through to trigger reveals, then full-page shot
            for y in range(0, h, 500): await pg.evaluate(f'window.scrollTo(0,{y})'); await pg.wait_for_timeout(120)
            await pg.evaluate('window.scrollTo(0,0)'); await pg.wait_for_timeout(900)
            await pg.screenshot(path=f'/tmp/site_{name}_full.png', full_page=True)
            print(name, 'height', h, 'overflowX', await pg.evaluate('document.documentElement.scrollWidth > innerWidth'))
        await b.close()
asyncio.run(main())
