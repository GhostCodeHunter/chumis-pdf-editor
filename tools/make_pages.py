#!/usr/bin/env python3
"""Generates the static marketing/legal pages (index, privacy, terms, disclaimer, licenses, 404) from one template.
Run:  python3 tools/make_pages.py      (edit the constants below, then re-run to rebrand)"""
import pathlib, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAME = "Chumi's PDF Editor"
HOLDER = "Chumi"
YEAR = 2026
UPDATED = "3 November 2026"
TAGLINE = "Edit, OCR, merge, convert, sign and verify PDFs — privately, in your browser."
SITE_DESC = "Free PDF editor that runs entirely in your browser: edit text, OCR scans, merge and organize pages, convert to Word/Excel/PowerPoint, sign, redact, and verify Aadhaar, PAN, GST and company documents. Nothing is uploaded."
e = html.escape

def icon(name, size=20):
    return f'<span data-icon="{name}" data-size="{size}"></span>'

HEAD = f'''<header class="site-head" id="top"><div class="wrap">
  <a class="site-brand" href="index.html"><svg viewBox="0 0 512 512" aria-hidden="true"><use href="assets/logo.svg#mark"/></svg><span>{e(NAME)}</span></a>
  <nav class="site-nav" aria-label="Main"><a href="index.html#features">Features</a><a href="index.html#verify">Verify documents</a><a href="index.html#privacy">Privacy</a><a href="index.html#install">Install</a><a href="index.html#faq">FAQ</a></nav>
  <div class="head-cta"><span data-install></span><a class="btn btn-brand" href="app.html">{icon("pdf", 18)}<span>Open the editor</span></a></div>
  <button class="btn btn-ghost btn-icon menu-btn" type="button" aria-label="Menu" aria-expanded="false" data-menu>{icon("menu", 22)}</button>
</div></header>'''

FOOT = f'''<footer class="site-foot"><div class="wrap">
  <div class="foot-grid">
    <div><div class="foot-brand"><svg viewBox="0 0 512 512" aria-hidden="true"><use href="assets/logo.svg#mark"/></svg>{e(NAME)}</div><p>{e(TAGLINE)}</p></div>
    <div><h4>Product</h4><ul><li><a href="app.html">Open the editor</a></li><li><a href="index.html#features">Features</a></li><li><a href="index.html#verify">Verify documents</a></li><li><a href="index.html#install">Install on desktop</a></li><li><a href="index.html#faq">FAQ</a></li></ul></div>
    <div><h4>Legal</h4><ul><li><a href="privacy.html">Privacy Policy</a></li><li><a href="terms.html">Terms of Use</a></li><li><a href="disclaimer.html">Disclaimer</a></li><li><a href="licenses.html">Open-source licences</a></li><li data-repo-li hidden><a data-repo href="#" rel="noopener">Source code &amp; support</a></li></ul></div>
  </div>
  <div class="foot-legal">
    <span>© <span data-year>{YEAR}</span> {e(HOLDER)}. All rights reserved. The source code is released under the MIT Licence; third-party components keep their own licences.</span>
    <span>{e(NAME)} is an independent project. It is not affiliated with, endorsed by or sponsored by Adobe Inc., the Unique Identification Authority of India (UIDAI), the Income Tax Department, the Goods and Services Tax Network (GSTN), the Ministry of Corporate Affairs, the Controller of Certifying Authorities or any other government body. Adobe and Acrobat are trademarks or registered trademarks of Adobe Inc. in the United States and/or other countries. Aadhaar, PAN, GSTIN, CIN and other names are used only to describe the documents this tool can read and belong to their respective owners.</span>
    <span>Verification results are informational only — see the <a href="disclaimer.html">Disclaimer</a>.</span>
  </div>
</div></footer>'''

def page(fname, title, desc, body, body_cls='site', robots='index,follow', extra_head=''):
    full_title = title if title.startswith(NAME) else f'{title} — {NAME}'
    doc = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(full_title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="robots" content="{robots}">
<meta name="theme-color" content="#d31510">
<meta name="author" content="{e(HOLDER)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="{e(NAME)}"><meta property="og:title" content="{e(full_title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:image" content="assets/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="css/theme.css"><link rel="stylesheet" href="css/components.css"><link rel="stylesheet" href="css/site.css">
{extra_head}<script>document.documentElement.classList.add('js')</script>
</head>
<body class="{body_cls}">
<a class="skip" href="#main">Skip to content</a>
{HEAD}
<main id="main">
{body}
</main>
{FOOT}
<div id="toasts" aria-live="polite"></div>
<script type="module" src="js/landing.js"></script>
</body>
</html>
'''
    (ROOT / fname).write_text(doc, encoding='utf-8')

def legal(fname, title, desc, inner):
    body = f'''<article class="legal"><div class="wrap">
<a class="crumb" href="index.html">{icon("chev-left", 16)} Back to {e(NAME)}</a>
<h1>{e(title)}</h1><p class="meta">Last updated: {UPDATED}</p>
{inner}
</div></article>'''
    page(fname, title, desc, body, body_cls='site legal-page')

# ------------------------------------------------------------------ landing
FEATURES = [
 ('edit-text', '', 'Edit text & content', 'Click a line to change it. Add text in 55+ Google Fonts, plus images, shapes, drawings, highlights, comments and checkmarks anywhere.'),
 ('ocr', '', 'OCR for scans', 'Turn scanned pages into searchable PDFs, then correct the recognised text in place. English, Hindi, Malayalam, Tamil and 15+ more languages.'),
 ('merge', '', 'Merge & combine', 'Join PDFs, photos, Word and Excel files into one document. Reorder by drag and drop, pick page ranges, rotate.'),
 ('layers', '', 'Organize pages', 'Reorder, rotate, duplicate, delete, extract, insert and split pages with a visual grid.'),
 ('export', 'red', 'Convert to anything', 'Export to Word, Excel, PowerPoint, images, HTML, Markdown or plain text — or turn Word, Excel, text and images into PDF.'),
 ('sign', 'red', 'Fill & sign', 'Draw, type or upload your signature, add ticks and dates, flatten forms. Saved only on your device.'),
 ('redact', 'red', 'Redact & protect privacy', 'Permanently black out sensitive text, strip metadata, add watermarks and page numbers, shrink big files.'),
 ('shield-check', 'green', 'Verify documents', 'Check Aadhaar, PAN, GSTIN and company (CIN) documents, and validate digital signatures like Acrobat does.'),
]
feat_html = '\n'.join(f'<div class="feat {c} reveal" style="--d:{i*60}ms"><div class="ic">{icon(ic, 26)}</div><h3>{e(t)}</h3><p>{e(d)}</p></div>' for i, (ic, c, t, d) in enumerate(FEATURES))

faqs = [
 ("Is it really free? Do I need an account?", "Yes, it is free and there is no sign-up. The source code is open under the MIT Licence, so you can also host your own copy."),
 ("Are my files uploaded anywhere?", "No. Documents are opened and edited in your browser's memory and never sent to a server. The only network requests are: loading this website, a one-time download of the OCR engine and language data when you first use OCR, and the official government websites you choose to open. Read the <a href='privacy.html'>Privacy Policy</a> for details."),
 ("Does it replace Adobe Acrobat?", "It covers the everyday jobs — editing, OCR, merging, organizing, converting, signing, redacting and form filling — in a familiar layout. It does not do password protection/encryption, certificate-based digital signing, form design or long-term-validation signatures. Use desktop software for those."),
 ("Can I rely on the document verification?", "Treat it as a fast first check, not proof. It validates number formats and checksums (Aadhaar, PAN, GSTIN, CIN…), cross-checks details against each other, and checks whether a digital signature was altered after signing. Whether a number was really issued must be confirmed on the official portal — each result links straight to it. See the <a href='disclaimer.html'>Disclaimer</a>."),
 ("Why does my digital signature say “unknown”?", "A signature is only “valid” when its certificate chain leads to a trusted certificate. India's Root CA (CCA) and the licensed authorities under it are built in, so GST, PAN, e-Aadhaar and e-Mudhra signatures validate on their own. “Unknown” means the chain does not end at a trusted certificate — for example a self-signed signer or an authority outside India's PKI. Open the certificate's Trust tab and choose “Add to Trusted Identities” only after confirming its fingerprint with the issuer."),
 ("How do I install it on my desktop?", "Click <strong>Install app</strong> on this page (Chrome or Edge), or use the install icon in the address bar. In Safari choose File → Add to Dock (macOS) or Share → Add to Home Screen (iPhone/iPad). Once installed it opens in its own window, works offline and can open PDFs from your file manager."),
 ("Which fonts can I use for text?", "The standard PDF fonts, Poppins (bundled, works offline) and 55+ popular Google Fonts that load the first time you pick them and are then kept on your device. Latin text is embedded as real, selectable text; Indian-language fonts and any characters a font doesn't contain are saved as an exact picture of the text. You can add any other Google Font by typing its name."),
 ("Which browsers work?", "Recent versions of Chrome, Edge, Firefox and Safari. Installing as an app works in Chrome, Edge and Safari 17+."),
 ("Is it safe to use with Aadhaar cards?", "Files stay on your device and Aadhaar numbers are masked on screen by default. You can also burn a permanent black box over the first 8 digits before sharing. Share a masked copy whenever the full number is not required."),
]
faq_html = '\n'.join(f'<details class="reveal" style="--d:{i*40}ms"><summary>{e(q)}</summary><div><p>{a}</p></div></details>' for i, (q, a) in enumerate(faqs))

LANDING = f'''
<section class="hero"><div class="wrap">
  <div>
    <span class="eyebrow in-up">{icon("lock", 16)} 100% private · runs in your browser</span>
    <h1 class="in-up d1">Every PDF tool you need. <em>None of your files leave your device.</em></h1>
    <p class="lead in-up d2">{e(NAME)} edits text, reads scans with OCR, merges and organizes pages, converts to Word, Excel and PowerPoint, signs, redacts — and checks Aadhaar, PAN, GST and company documents. Free, no sign-up.</p>
    <div class="hero-cta in-up d3"><a class="btn btn-primary btn-lg" href="app.html">{icon("folder-open", 20)}<span>Open the editor</span></a><span data-install data-size="lg"></span></div>
    <ul class="hero-points in-up d4"><li>{icon("check-circle", 18)}No uploads</li><li>{icon("check-circle", 18)}No account</li><li>{icon("check-circle", 18)}Works offline when installed</li><li>{icon("check-circle", 18)}Open source</li></ul>
  </div>
  <div class="mock" aria-hidden="true">
    <div class="mock-bar"><i></i><i></i><i></i><span>invoice.pdf</span></div>
    <div class="mock-tools"><b class="on">{icon("edit-text", 16)}</b><b>{icon("highlight", 16)}</b><b>{icon("image-add", 16)}</b><b>{icon("sign", 16)}</b><b>{icon("redact", 16)}</b></div>
    <div class="mock-page"><h4>Tax Invoice</h4><div class="ln m"></div><div class="ln hl s"></div><div class="ln m"></div><div class="ln s"></div><div class="ln"></div>
      <div class="mock-edit">Paid in full</div><div class="mock-sig"><span>{icon("check", 16)}</span></div></div>
    <div class="mock-chip">{icon("shield-check", 18)} GSTIN checksum OK · signature intact</div>
  </div>
</div></section>

<section class="sec" id="features"><div class="wrap">
  <div class="sec-head reveal"><h2>All the everyday PDF jobs, in one familiar workspace</h2><p>A clean toolbar, page thumbnails and tool panels — laid out the way you already expect from desktop PDF software.</p></div>
  <div class="feat-grid">{feat_html}</div>
</div></section>

<section class="sec tint" id="verify"><div class="wrap split">
  <div class="reveal">
    <span class="eyebrow">{icon("shield-check", 16)} New</span>
    <h2>Check Aadhaar, PAN, GST and company documents in seconds</h2>
    <p>Open the document and press <strong>Scan</strong>. The numbers are found, validated, cross-checked and — for digitally signed files — the signature is tested for tampering.</p>
    <ul class="checks">
      <li>{icon("check-circle", 20)}<span><strong>Aadhaar</strong> Verhoeff checksum, masked on screen, one-click permanent masking of the first 8 digits.</span></li>
      <li>{icon("check-circle", 20)}<span><strong>PAN</strong> structure and holder type; <strong>GSTIN</strong> check character, state code and embedded-PAN match.</span></li>
      <li>{icon("check-circle", 20)}<span><strong>Company certificates</strong> CIN decoded (state, year, ownership) and cross-checked with the date of incorporation.</span></li>
      <li>{icon("check-circle", 20)}<span><strong>Digital signatures</strong> Validate Signature, View Signed Version, Compare to Current Version and certificate viewer — like Acrobat.</span></li>
    </ul>
    <div class="notice">{icon("alert", 20)}<span>These are offline checks. They catch typos, impossible numbers and edited files, but they cannot confirm that a number was really issued. Every result links to the official portal for that final step.</span></div>
  </div>
  <div class="verify-card reveal" style="--d:120ms" aria-hidden="true">
    <div class="verify-row"><span class="k">Aadhaar</span><code>XXXX XXXX 0124</code><span class="pill ok">Checksum OK</span></div>
    <div class="verify-row"><span class="k">PAN</span><code>AAPFU0939F</code><span class="pill ok">Format OK</span></div>
    <div class="verify-row"><span class="k">GSTIN</span><code>27AAPFU0939F1ZV</code><span class="pill ok">Check char OK</span></div>
    <div class="verify-row"><span class="k">CIN</span><code>U72900KL2015PTC036982</code><span class="pill ok">Decoded</span></div>
    <div class="verify-row"><span class="k">Signature</span><code>Signed by GSTN</code><span class="pill ok">Not changed</span></div>
  </div>
</div></section>

<section class="sec" id="privacy"><div class="wrap">
  <div class="sec-head reveal"><h2>Private by design</h2><p>Most online PDF tools upload your file to a server. This one doesn't have a server to upload to.</p></div>
  <div class="feat-grid">
    <div class="feat green reveal"><div class="ic">{icon("lock", 26)}</div><h3>Processed on your device</h3><p>Your PDFs are read and written in browser memory. Closing the tab clears them.</p></div>
    <div class="feat green reveal" style="--d:70ms"><div class="ic">{icon("eye-off", 26)}</div><h3>No tracking</h3><p>No accounts, no analytics, no advertising cookies. Saved signatures and trusted certificates stay in your own browser.</p></div>
    <div class="feat green reveal" style="--d:140ms"><div class="ic">{icon("code", 26)}</div><h3>Open source</h3><p>Read the code, host your own copy, or fork it. Built on well-known open libraries — see the <a href="licenses.html">licences</a>.</p></div>
  </div>
</div></section>

<section class="sec tint" id="how"><div class="wrap">
  <div class="sec-head reveal"><h2>Start in three steps</h2></div>
  <div class="steps-row">
    <div class="step reveal"><h3>Open a file</h3><p>Drop a PDF — or an image, Word, Excel or text file to convert — onto the page.</p></div>
    <div class="step reveal" style="--d:80ms"><h3>Use any tool</h3><p>Edit, OCR, organize, sign, redact, convert or verify from the toolbar and side panels.</p></div>
    <div class="step reveal" style="--d:160ms"><h3>Download</h3><p>Save the finished PDF, or export to Word, Excel, PowerPoint, images and more.</p></div>
  </div>
</div></section>

<section class="sec" id="install"><div class="wrap"><div class="install-box reveal">
  <div style="position:relative">
    <h2>Install it on your desktop</h2>
    <p>Add {e(NAME)} to your computer or phone like a regular app — its own window, a shortcut on your desktop or Dock, and it keeps working without internet.</p>
    <ul><li>{icon("check-circle", 20)}Opens instantly from the Start menu, Dock or home screen</li><li>{icon("check-circle", 20)}Works offline (the OCR engine needs one online download)</li><li>{icon("check-circle", 20)}Right-click a PDF → Open with {e(NAME)} (Chrome and Edge)</li></ul>
  </div>
  <div class="install-actions"><span data-install data-size="lg" data-always></span><a class="btn btn-secondary btn-lg" href="app.html"><span>Or just open it in the browser</span></a></div>
</div></div></section>

<section class="sec tint" id="faq"><div class="wrap"><div class="sec-head reveal"><h2>Questions, answered</h2></div><div class="faq">{faq_html}</div></div></section>

<section class="cta-band"><h2 class="reveal">Ready to work on a PDF?</h2><a class="btn btn-brand btn-lg reveal" style="--d:100ms" href="app.html">{icon("folder-open", 20)}<span>Open the editor</span></a></section>
'''
page('index.html', NAME + ' — free, private PDF editor in your browser', SITE_DESC, LANDING)

# ------------------------------------------------------------------ privacy
legal('privacy.html', 'Privacy Policy', f'How {NAME} handles your files and data: everything is processed in your browser and nothing is uploaded.', f'''
<p>This policy explains what {e(NAME)} (“the app”, “we”) does and does not do with information. In short: <strong>your documents are processed on your own device and are never uploaded to us.</strong></p>
<div class="callout"><strong>Summary.</strong> No accounts. No analytics or advertising cookies. No server that receives your files. A few small items are stored in your browser so the app can work (listed below), and a few third-party services are contacted in the situations listed below.</div>

<h2>1. Your documents</h2>
<ul>
<li>PDFs, images and other files you open are read and edited <strong>in your browser's memory</strong>. They are not transmitted to us or to any server operated for this app.</li>
<li>Edited files are created on your device and saved only when you click Download.</li>
<li>Closing a document tab or the browser tab releases it from memory. We have no copy and cannot recover it for you.</li>
</ul>

<h2>2. Sensitive identity documents (Aadhaar, PAN, GST, etc.)</h2>
<p>The verification tool reads numbers from the document <strong>locally</strong>. Numbers are not sent anywhere, are not logged, and are not stored by the app. Aadhaar numbers are masked on screen by default and the exported report masks all but the last four digits. If you click an “official site” button, your browser opens the relevant government website in a new tab; nothing from your document is passed to it automatically — anything you type there is governed by that site's own policy.</p>

<h2>2A. Information stored in your browser</h2>
<p>Stored locally on your device using the browser's local storage / cache, and never sent to us:</p>
<table><tr><th>Item</th><th>Why</th><th>How to remove it</th></tr>
<tr><td>Saved signature images</td><td>So you can re-use a signature you drew, typed or uploaded.</td><td>Delete the signature in the Fill &amp; Sign panel, or clear this site's data in your browser.</td></tr>
<tr><td>Trusted certificates (public certificates you imported)</td><td>So signature validation can recognise issuers you trust.</td><td>Remove them in the Digital signatures panel, or clear site data.</td></tr>
<tr><td>Downloaded fonts and your recently used / added font names</td><td>So fonts you picked load instantly and work offline afterwards.</td><td>Clear this site's data in your browser settings.</td></tr>
<tr><td>Cached app files (service worker)</td><td>So the app opens quickly and works offline once installed.</td><td>Uninstall the app or clear site data.</td></tr></table>
<p>The app does not use cookies. It does not use third-party analytics, advertising or fingerprinting scripts.</p>

<h2>3. Third parties your browser may contact</h2>
<table><tr><th>When</th><th>Who</th><th>What they can see</th></tr>
<tr><td>Loading the website</td><td>The host of the site (for example GitHub Pages)</td><td>Normal web-server logs: your IP address, browser type and the pages requested. Your documents are not involved.</td></tr>
<tr><td>First use of OCR</td><td>jsDelivr (CDN for the Tesseract.js engine) and the Tesseract language-data host</td><td>The same standard request details. The engine runs on your device; your page images are not sent.</td></tr>
<tr><td>Choosing a Google Font for the first time</td><td>jsDelivr, which mirrors the Google Fonts collection through the open-source Fontsource project</td><td>The same standard request details (IP address, browser type) and the name of the font file requested. The fonts are then kept in your browser cache; your documents are not involved.</td></tr>
<tr><td>Clicking an “official site” link</td><td>The relevant government website (UIDAI, Income Tax Department, GSTN, MCA, Udyam, etc.)</td><td>Whatever you choose to enter on that site.</td></tr></table>
<p>If the site owner has configured an optional live-verification service, it is only contacted when you press “Check live”, and the owner must describe it separately.</p>

<h2>4. Children</h2>
<p>The app is a general-purpose tool and does not knowingly collect any information from anyone, including children.</p>

<h2>5. Security</h2>
<p>Because files never leave your device, the main protections are those of your own computer and browser. Keep your browser up to date, and avoid using shared or public computers for sensitive documents. Redaction in this app permanently flattens the affected page into a picture, but you should always re-open the saved file and check that the covered information is really gone before sharing it.</p>

<h2>6. Your choices</h2>
<p>You can clear everything the app stores by clearing this site's data in your browser settings, or by uninstalling the installed app. There is no account to close.</p>

<h2>7. Changes to this policy</h2>
<p>If the app's behaviour changes, this page will be updated and the date above will change.</p>

<h2>8. Contact</h2>
<p>Questions or concerns can be raised through the project's repository (see the link in the page footer when it is available) or with the person who gave you this site's address.</p>
<p class="hint">Site operators: if you host your own copy and add analytics, accounts, uploads or other services, you must update this policy to describe them and meet the privacy laws that apply to you.</p>
''')

# ------------------------------------------------------------------ terms
legal('terms.html', 'Terms of Use', f'The terms for using {NAME}.', f'''
<p>By using {e(NAME)} you agree to these terms. If you do not agree, please do not use the app.</p>
<h2>1. What the app is</h2>
<p>{e(NAME)} is a free, browser-based tool for working with PDF and related files. It runs on your device. It is provided by {e(HOLDER)} as an independent project.</p>
<h2>2. Licence to use</h2>
<p>You may use the app for personal or business purposes at no charge. The app's source code is available under the MIT Licence (see the <code>LICENSE</code> file). Third-party components are covered by their own licences, listed on the <a href="licenses.html">open-source licences</a> page.</p>
<h2>3. Acceptable use</h2>
<p>You agree not to use the app to:</p>
<ul>
<li>forge, falsify or tamper with documents, signatures, certificates or identity records, or to present an altered document as the original;</li>
<li>process another person's personal data (for example their Aadhaar, PAN or other identity details) without a lawful basis, or in breach of laws and regulations that apply to you;</li>
<li>infringe copyright or other rights in the files you process;</li>
<li>attempt to disrupt the site or the services it relies on.</li>
</ul>
<p>You are solely responsible for the files you open, the edits you make and how you use the results.</p>
<h2>4. No warranty</h2>
<p>The app is provided <strong>“as is” and “as available”</strong>, without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy, or non-infringement. Conversions (Word, Excel, PowerPoint, HTML, OCR and others) are best-effort and may not preserve every detail of the original layout. Always check the output before relying on it.</p>
<h2>5. Verification features</h2>
<p>Document-verification and signature-validation features are informational aids with limits explained in the <a href="disclaimer.html">Disclaimer</a>. They are not legal, regulatory, tax or compliance advice and must not be your only basis for decisions such as KYC, onboarding, lending or accepting a document as genuine.</p>
<h2>6. Limitation of liability</h2>
<p>To the fullest extent permitted by law, {e(HOLDER)} will not be liable for any loss of data, loss of profit, business interruption or any indirect or consequential loss arising from the use of, or inability to use, the app. Keep your own backups of important files — the app never stores your documents.</p>
<h2>7. Intellectual property and trademarks</h2>
<p>© {YEAR} {e(HOLDER)}. The name “{e(NAME)}”, the logo and the site design are the property of {e(HOLDER)}, subject to the open-source licence of the code. Adobe, Acrobat and other product or company names are trademarks of their respective owners and are used only to describe compatibility. No affiliation or endorsement is implied.</p>
<h2>8. Third-party sites</h2>
<p>Links to government and other websites are provided for convenience. We do not control those sites and are not responsible for their content or availability.</p>
<h2>9. Changes</h2>
<p>These terms may be updated from time to time. The date at the top of the page shows the latest version; continued use means you accept the updated terms.</p>
''')

# ------------------------------------------------------------------ disclaimer
legal('disclaimer.html', 'Disclaimer', f'Important limits of {NAME}: verification results, digital-signature validation, redaction, OCR and conversion.', f'''
<div class="callout warn"><strong>Please read this before relying on any result.</strong> {e(NAME)} helps you inspect and edit documents. It is not an official verification service and is not connected to any government authority.</div>

<h2>1. Government-document verification</h2>
<ul>
<li><strong>Offline checks only.</strong> The tool checks number formats, published checksums (for example Aadhaar's Verhoeff check and the GSTIN check character), structural rules (PAN holder type, CIN fields) and consistency between values found in the same document.</li>
<li><strong>A passing result does not prove a number or document is genuine.</strong> A number can have a valid format and checksum without ever having been issued. Only the issuing authority can confirm that — use the official-site button shown next to each result (UIDAI, Income Tax e-Filing, GST portal, MCA, Udyam).</li>
<li><strong>A failing result can be a reading error.</strong> Text is read from the PDF or by OCR and may be wrong, especially on scans.</li>
<li><strong>Not a KYC or compliance tool.</strong> Do not use it as the sole basis for onboarding, lending, tax or legal decisions. Entities that collect or store Aadhaar numbers must follow the Aadhaar Act, UIDAI rules and other applicable law.</li>
<li>No affiliation: {e(NAME)} is not affiliated with UIDAI, the Income Tax Department, GSTN, the Ministry of Corporate Affairs, the Controller of Certifying Authorities or any other authority.</li>
</ul>

<h2>2. Digital-signature validation</h2>
<ul>
<li>The validator recomputes the signed fingerprint of the document and checks the signer's RSA signature. If either fails, the document or signature was changed.</li>
<li>It builds the certificate chain from the file. A signature is shown as <strong>valid</strong> only when the chain ends at a trusted certificate: India's CCA roots and licensed authorities are built in (checked against the fingerprints the CCA publishes), and you can add others. Adding a certificate is your decision — confirm its thumbprint with the issuer first.</li>
<li><strong>Revocation</strong> is checked only from the CRL/OCSP data stored inside the file, and from the authority's CRL if the site owner has switched on the optional revocation proxy. Without either, revocation is not checked. <strong>Not checked:</strong> the validity of trusted timestamps, and whether later changes to a certified document were permitted (the tool reports that changes exist).</li>
<li>A “valid” result is a cryptographic check that the signed content is unchanged and was signed by a certificate chaining to a trusted root. It is not proof of the signer's authority or of legal validity. For legal or official use, confirm with the issuing authority or the official portal.</li>
<li>Whether an electronic signature is legally valid depends on the law, the certifying authority and the circumstances. This tool gives no legal opinion.</li>
</ul>

<h2>3. Editing and redaction</h2>
<ul>
<li>“Edit text” places new text over the original and covers the old text. The original text may still exist underneath (it can be copied or extracted). White-out has the same limitation.</li>
<li>“Redact” permanently flattens the page into a picture with black boxes burned in, so covered text and images are removed from that page. <strong>Always reopen the saved file and confirm</strong> the information is really gone before sharing it. Hidden data such as metadata should be removed separately (Document properties → Remove all).</li>
<li>Editing a signed document breaks its signature by design.</li>
</ul>

<h2>4. OCR and conversion</h2>
<p><strong>Fonts.</strong> Text added in Latin-script fonts is embedded as live, selectable text. Indian-language fonts, and any character a chosen font does not contain, are saved as a picture of the text (accurate to look at, but not selectable or searchable).</p>
<p>OCR accuracy depends on scan quality, language and fonts. Conversions to Word, Excel, PowerPoint, HTML and Markdown rebuild content from text positions and may change layout, fonts, tables and images. Review every result.</p>

<h2>5. Unsupported features</h2>
<p>The browser version does not create password-protected/encrypted PDFs, sign with a certificate or USB token, or design interactive forms.</p>

<h2>6. No professional advice</h2>
<p>Nothing in the app or on this site is legal, tax, financial or compliance advice. Consult a qualified professional where it matters.</p>
''')

# ------------------------------------------------------------------ licences
legal('licenses.html', 'Open-source licences', f'Third-party software and assets used by {NAME}.', f'''
<p>{e(NAME)} is © {YEAR} {e(HOLDER)} and released under the <strong>MIT Licence</strong> (see <code>LICENSE</code> in the repository). It stands on the work of these open-source projects, each used under its own licence:</p>
<table><tr><th>Component</th><th>Used for</th><th>Licence</th></tr>
<tr><td><a href="https://github.com/mozilla/pdf.js" rel="noopener">PDF.js</a> (Mozilla), including its OpenJPEG, JBIG2 and QCMS decoders</td><td>Rendering PDF pages and extracting text</td><td>Apache-2.0 (decoders: BSD-2-Clause / MIT / Apache-2.0)</td></tr>
<tr><td><a href="https://github.com/Hopding/pdf-lib" rel="noopener">pdf-lib</a></td><td>Creating and modifying PDF files</td><td>MIT</td></tr>
<tr><td><a href="https://github.com/Stuk/jszip" rel="noopener">JSZip</a></td><td>ZIP files, Word/Excel/PowerPoint packaging</td><td>MIT (dual-licensed MIT or GPL-3.0; used under MIT)</td></tr>
<tr><td><a href="https://github.com/gitbrent/PptxGenJS" rel="noopener">PptxGenJS</a></td><td>PowerPoint export</td><td>MIT</td></tr>
<tr><td><a href="https://github.com/naptha/tesseract.js" rel="noopener">Tesseract.js</a> and the <a href="https://github.com/tesseract-ocr/tesseract" rel="noopener">Tesseract OCR engine</a> with its language data</td><td>OCR (downloaded from a CDN when first used)</td><td>Apache-2.0</td></tr>
<tr><td><a href="https://pictogrammers.com/library/mdi/" rel="noopener">Material Design Icons</a> (Pictogrammers)</td><td>Interface icons</td><td>Apache-2.0</td></tr>
<tr><td><a href="https://github.com/itfoundry/Poppins" rel="noopener">Poppins</a> (Indian Type Foundry) — bundled</td><td>Text font (works offline)</td><td>SIL Open Font Licence 1.1</td></tr>
<tr><td><a href="https://fonts.google.com" rel="noopener">Google Fonts</a> families, served by <a href="https://fontsource.org" rel="noopener">Fontsource</a> via jsDelivr</td><td>Optional text fonts you choose in the editor (downloaded on demand)</td><td>SIL Open Font Licence 1.1 or Apache-2.0, set by each font's authors; Fontsource is MIT</td></tr></table>
<p>Fonts are licensed by their designers. The SIL Open Font Licence and the Apache licence both allow fonts to be embedded in the documents you create; check a font's own licence before redistributing the font files themselves.</p>
<p>The complete licence texts are included in the <code>vendor/</code> folder of the source code and in each project's repository. Product and company names mentioned anywhere in this app belong to their respective owners.</p>
<h2>MIT Licence (this project)</h2>
<pre style="white-space:pre-wrap;background:var(--c-surface-2);padding:16px;border-radius:12px;font-size:14px">MIT License

Copyright (c) {YEAR} {e(HOLDER)}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</pre>
''')

# ------------------------------------------------------------------ 404
page('404.html', 'Page not found', 'This page does not exist.', f'''
<section class="hero" style="min-height:60vh"><div class="wrap" style="grid-template-columns:1fr;text-align:center;justify-items:center">
  <div><h1>That page <em>isn't here</em></h1><p class="lead">The link may be out of date. You can open the editor or go back to the start page.</p>
  <div class="hero-cta" style="justify-content:center"><a class="btn btn-primary btn-lg" href="app.html"><span>Open the editor</span></a><a class="btn btn-secondary btn-lg" href="index.html"><span>Start page</span></a></div></div>
</div></section>''', robots='noindex')
print('pages written')
