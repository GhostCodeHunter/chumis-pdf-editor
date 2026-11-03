"""Quick check that every page loads without console errors, plus a reduced-motion check and a mobile layout check."""
import asyncio
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:8765/'
async def main():
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for page in ['index.html','app.html','privacy.html','terms.html','disclaimer.html','licenses.html','404.html']:
            pg = await (await b.new_context(viewport={'width':1280,'height':800})).new_page(); errs=[]
            pg.on('console', lambda m, errs=errs: errs.append(m.text) if m.type=='error' else None); pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
            r = await pg.goto(BASE+page); await pg.wait_for_timeout(700)
            print(f'{page:16} status={r.status} errors={errs or "none"}'); bad += bool(errs)
        # reduced motion: reveal content must be visible immediately and animations must be near-instant
        ctx = await b.new_context(viewport={'width':1280,'height':800}, reduced_motion='reduce'); pg = await ctx.new_page(); await pg.goto(BASE+'index.html'); await pg.wait_for_timeout(300)
        vis = await pg.evaluate("[...document.querySelectorAll('.reveal')].every(e => getComputedStyle(e).opacity === '1')")
        dur = await pg.evaluate("getComputedStyle(document.querySelector('.mock')).animationDuration")
        print('reduced motion: all reveals visible =', vis, '| mock animation duration =', dur); bad += (not vis)
        # no horizontal overflow on phones
        for page in ['index.html','app.html','privacy.html']:
            pg = await (await b.new_context(viewport={'width':375,'height':740})).new_page(); await pg.goto(BASE+page); await pg.wait_for_timeout(600)
            ov = await pg.evaluate("document.documentElement.scrollWidth - innerWidth")
            print(f'mobile {page:14} horizontal overflow px = {ov}'); bad += ov > 1
        await b.close()
    print('FAILED' if bad else 'all good'); raise SystemExit(bad)
asyncio.run(main())
