# Acrobat's flow: click the signature -> Signature Validation Status -> Signature Properties -> Advanced / Certificate Viewer (tabs, Trust).
import asyncio
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'; V='.view-doc:not([hidden]) '
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1366,'height':900}); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(FX+'sig-adobe-appearance.pdf'); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(1500)
        # 1. click the signature while unknown: validation status dialog; open the certificate viewer and trust the root through the Trust tab
        await pg.locator(V+'.sig-badge').first.click(); await pg.wait_for_selector('.modal .sg-status'); print('STATUS 1:', (await pg.inner_text('.modal')).replace('\n',' | ')[:330])
        await pg.click('.modal button:has-text("Signature Properties")'); await pg.wait_for_selector('.modal h4:has-text("Signature Validity Summary")')
        print('PROPS buttons:', [await x.inner_text() for x in await pg.locator('.modal .modal-actions button, .modal footer button').all()][:6])
        await pg.click('.modal button:has-text("Advanced Properties")'); await pg.wait_for_selector('.cv-tabs'); print('ADV summary:', (await pg.inner_text('.modal .cv-body')).replace('\n',' | ')[:260])
        await pg.click('.modal .cv-tab:has-text("Date/Time")'); print('ADV date:', (await pg.inner_text('.modal .cv-body')).replace('\n',' | ')[:200]); await pg.click('.modal button:has-text("Close")'); await pg.wait_for_timeout(300)
        await pg.locator(V+'.sig-badge').first.click(button='right'); await pg.wait_for_selector('.popmenu'); print('MENU:', (await pg.inner_text('.popmenu')).replace('\n',' | '))
        await pg.click('.popmenu button:has-text("Show Signature Properties")'); await pg.wait_for_selector('.modal button:has-text("Show Signer")'); await pg.click('.modal button:has-text("Show Signer")'); await pg.wait_for_selector('.cert-grid')
        for t in ('Summary','Details','Revocation','Trust','Policies','Legal Notice'):
            await pg.click(f'.modal .cv-tab:has-text("{t}")'); await pg.wait_for_timeout(150); print('CERT', t, ':', (await pg.inner_text('.modal .cv-body')).replace('\n',' | ')[:150])
        await pg.click('.cert-item >> nth=1'); await pg.click('.modal .cv-tab:has-text("Trust")')
        n = await pg.locator('.cert-item').count()
        await pg.click(f'.cert-item >> nth={n-1}'); await pg.click('.modal .cv-tab:has-text("Trust")'); await pg.click('.modal button:has-text("Add to Trusted Identities")')
        await pg.wait_for_selector('.modal :text("Import Contact Settings")'); print('TRUST DIALOG:', (await pg.inner_text('.modal')).replace('\n',' | ')[:260])
        await pg.click('.modal button:has-text("OK")'); await pg.wait_for_selector('.modal .sg-status', timeout=10000); await pg.wait_for_timeout(500)
        print('STATUS 2:', (await pg.inner_text('.modal')).replace('\n',' | ')[:300])
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
