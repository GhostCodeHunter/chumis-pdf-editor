# Chumi's PDF Editor

A free, private PDF editor that runs **entirely in the browser**. Edit text, OCR scans, merge and organize pages,
convert to Word / Excel / PowerPoint / images, sign, redact — and **verify Aadhaar, PAN, GST and company
(COI) documents**, including digital-signature validation modelled on Acrobat's *Validate Signature* flow.

No server, no sign-up, no uploads. It is a static site, so it deploys to **GitHub Pages** as-is, and it can be
**installed on your desktop** (Chrome / Edge / Safari) like a normal app.

> **Live site:** after you publish, it will be at `https://<your-username>.github.io/<repo-name>/`

---

## Features

| Area | What you get |
|---|---|
| **Viewer** | Continuous scroll, thumbnails, zoom / fit, text search, text selection, form-field panel |
| **Edit PDF** | Edit existing text (click a line), add text in **55+ Google Fonts** (Poppins bundled; others load on demand and are cached; fonts are embedded so text stays selectable), images / shapes / arrows / freehand, highlight / underline / strike-through, sticky notes, white-out, checkmarks, undo / redo |
| **OCR** | Tesseract OCR (English, Hindi, Malayalam, Tamil, Telugu, Kannada, Bengali, Marathi, Gujarati, Punjabi, Urdu, Arabic, European & CJK languages). Makes searchable PDFs and lets you **edit the recognised text in place** |
| **Organize pages** | Drag-and-drop reorder, rotate, duplicate, delete, extract, insert blank / from file, split by count or ranges |
| **Combine files** | Merge PDFs, images, Word, Excel/CSV and text; page ranges; rotate; reorder |
| **Create PDF** | Blank pages, from images, from text / Markdown, from Word (.docx), from spreadsheet (.xlsx / .csv) |
| **Convert** | Export to Word, Excel, PowerPoint, PNG / JPG / WebP, HTML, Markdown, plain text |
| **Fill & sign** | Draw / type / upload signature, ticks, dates, AcroForm fields |
| **Redact & clean-up** | Permanent redaction, watermark, page numbers, crop, shrink file size, edit / remove metadata |
| **Verify documents** | Aadhaar (Verhoeff), PAN, GSTIN (check character), CIN / LLPIN, TAN, Udyam, EPIC, passport, DL, IFSC · cross-checks · one-click Aadhaar masking · links to the official portals |
| **Digital signatures** | Status bar + on-page badge, **Validate Signature**, **View Signed Version**, **Compare Signed Version to Current Version**, **Signature Properties**, certificate viewer, trusted-certificate list (e.g. CCA India root) |
| **Install as an app** | PWA: install button, offline use, "Open with" for `.pdf` files (Chrome / Edge) |
| **Motion** | Purposeful transitions and entrances; all animation is disabled for users who prefer reduced motion |

---

## Run it locally

You need any static web server (browsers block ES modules on `file://`).

```bash
cd chumis-pdf-editor
python3 -m http.server 8000
# open http://localhost:8000
```

Pages: `index.html` (landing) · `app.html` (editor) · `privacy.html` · `terms.html` · `disclaimer.html` · `licenses.html`.

## Publish on GitHub Pages

1. Create an empty repository on GitHub (for example `chumis-pdf-editor`).
2. From this folder:

   ```bash
   git init -b main
   git add .
   git commit -m "Chumi's PDF Editor"
   git remote add origin https://github.com/<your-username>/chumis-pdf-editor.git
   git push -u origin main
   ```

   (Use `git` or GitHub Desktop — the folder has more than 100 files, which the web uploader does not accept.)
3. In the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
   The included workflow (`.github/workflows/pages.yml`) publishes the site on every push.
   *Alternative:* choose **Deploy from a branch → main → / (root)** — no workflow needed.
4. Open `https://<your-username>.github.io/chumis-pdf-editor/`.

All paths are relative, so the site works from a sub-folder URL like the one above or from a custom domain.

## Before you go public — checklist

- [ ] `js/config.js` → set `REPO_URL` (shows a "Source code & support" link in the footer and legal pages).
- [ ] Copyright holder / year: `js/config.js` (`COPYRIGHT_HOLDER`, `COPYRIGHT_YEAR`), `LICENSE`, and the constants at the top of `tools/make_pages.py` (then run `python3 tools/make_pages.py`).
- [ ] Read `privacy.html`, `terms.html` and `disclaimer.html` and have them reviewed for your jurisdiction. They are written for the app exactly as shipped — if you add analytics, uploads or accounts, update them. Add a governing-law clause if your lawyer recommends one.
- [ ] If you add the optional live-verification proxy (`VERIFY_PROXY_URL`), describe it in the privacy policy. **Never put API keys in this repository** — it is public.

## Install on your desktop

*Chrome / Edge:* click **Install app** on the landing page or the install icon in the address bar.
*Safari (macOS 14+):* File → Add to Dock. *iPhone / iPad:* Share → Add to Home Screen.
After installing, right-click a PDF → **Open with → Chumi's PDF Editor** (Chrome / Edge).

The service worker (`sw.js`) caches the app for offline use. It uses network-first for pages and scripts so a new deploy is picked up as soon as you are online. `python3 tools/build_sw.py` refreshes its file list (the workflow does it automatically).

## How verification works (and what it cannot do)

* **Number checks** run in `js/validators.js` (unit-tested in `tests/unit-validators.mjs`): Aadhaar Verhoeff checksum, GSTIN mod-36 check character, PAN structure and holder type, CIN decoding, plus cross-checks (PAN inside GSTIN, entity type vs. name, CIN year vs. incorporation date).
* **Signature checks** run in `js/sigcheck.js`: the signed byte range is hashed and compared to the signed attributes, the RSA signature is verified with the signer certificate, and the certificate chain is built from the file. A signature is **valid** only if the chain ends at a certificate the user has chosen to trust.
  Adobe's built-in trust list does not include India's Root CA (CCA), so Indian signatures show as *unknown* until the root is trusted. Download the root from <https://cca.gov.in/root_certificate.html>, confirm its thumbprint with the CCA, and import it in the **Digital signatures** panel.
* **Not checked:** revocation (CRL / OCSP), timestamps, long-term-validation data, RSA-PSS / ECDSA signatures.
* An offline check can never prove a number was *issued*. Each result links to the official portal (UIDAI, Income Tax e-Filing, GST portal, MCA, Udyam).

## OCR

Tesseract.js is loaded from a CDN the first time you run OCR (`TESSERACT_SRC` in `js/config.js`, pinned to v5.1.1) and language data comes from Tesseract's default data host. To work fully offline, host `tesseract.min.js`, the worker, the core and your `.traineddata` files yourself and point `TESSERACT_SRC` / `TESSERACT_LANG_PATH` at them.

## Known limits

* No password protection / encryption, certificate-based signing, form design or LTV signatures.
* "Edit text" overlays new text on a cover patch; the original text remains in the file beneath (use *Redact* when it must be removed).
* Password-protected PDFs can be read, searched and exported; to edit them the app creates an unlocked copy (pages become pictures with a hidden text layer).
* Word / Excel / HTML exports are rebuilt from text positions, so complex layouts are simplified. Use *Exact look* (Word) or the image / PowerPoint exports to preserve appearance.
* Text in Indian-language fonts, and any character a chosen font lacks, is embedded as a picture of the text (exact look, not selectable). Google Fonts other than Poppins need an internet connection the first time you choose them; they are then cached for offline use.

## Tests

```bash
node tests/unit-validators.mjs          # checksums & document scanning (no browser needed)
python3 tests/make_fixtures.py          # builds sample PDFs incl. a signed + tampered file (needs reportlab + openssl)
python3 -m http.server 8765 &           # then, with Playwright for Python installed:
python3 tests/smoke4.py                 # open/convert, combine, organize, export, unlock, tools, redact, sign
python3 tests/smoke6.py                 # signature badge, validate, trust, tamper, compare, view signed version
node tests/unit-ttf.mjs                 # TrueType / WOFF reader (after running tools/build_fonts.py)
python3 tests/smoke8.py                 # font picker, live preview and embedding (uses a mocked font CDN)
```

## Project layout

```
index.html  app.html  privacy.html  terms.html  disclaimer.html  licenses.html  404.html
manifest.webmanifest  sw.js  robots.txt  LICENSE
css/    theme.css (tokens) · components.css · app.css · site.css
js/     main.js · docview.js · viewer.js · annots.js · bake.js · doc.js · organize.js · combine.js · create.js · layout.js
        convert.js · extract.js · ocr.js · verify.js · validators.js · sigcheck.js · signatures.js · sign.js · pagetools.js
        fonts.js · fontpicker.js · ttf.js · pdffont.js · pwa.js · landing.js · ui.js · icons.js · config.js
vendor/ pdf.js · pdf-lib · JSZip · PptxGenJS · fonts/ (Poppins) (+ licenses/)
tools/  make_pages.py · build_sw.py · build_fonts.py
tests/  unit tests, Playwright smoke tests, fixtures
```

## Licence

Source code: **MIT** (see `LICENSE`). Third-party components keep their own licences — see `vendor/licenses/` and `licenses.html`:
PDF.js (Apache-2.0), pdf-lib (MIT), JSZip (MIT), PptxGenJS (MIT), Tesseract.js (Apache-2.0), Material Design Icons (Apache-2.0), Poppins (SIL OFL 1.1). Google Fonts you pick in the editor are served by Fontsource/jsDelivr under their own licences (OFL / Apache-2.0).

*Adobe and Acrobat are trademarks of Adobe Inc. This project is not affiliated with or endorsed by Adobe, UIDAI, the Income Tax Department, GSTN, the Ministry of Corporate Affairs or the Controller of Certifying Authorities.*


## Built-in trust for Indian signatures

Signatures on Indian government documents (GST, e-Aadhaar, e-Mudhra, ...) validate on their own, as they do in Acrobat on a PC that trusts the Root CA of India. `vendor/trust/india-pki.json` holds the CCA India roots (2007, 2011, 2014, 2022, 2022 SPL) and the licensed-CA certificates under them. It is built by `tools/build_trust.py`, which refuses any root that does not match:

| Root | SHA-256 (DER) |
| --- | --- |
| CCA India 2022 | `9a3fd3176798e842ddcb12c262f11cfacca70a8b84c6ea6fda30842a95a94cd8` |
| CCA India 2022 SPL | `b724689b79b2ef9421ef8f5cc733eb093851b170ee715177005a09f226d8c91a` |

The older (expired) roots were cross-checked as byte-identical in two independent sources and match the names and validity listed on cca.gov.in. Every other certificate is kept only if its signature chain verifies up to one of these roots. Certificate revocation (CRL/OCSP) is not consulted, because a browser cannot reach the CAs' servers. You can still add your own trusted certificates in the Signatures panel.

Password-protected signed files (e-Aadhaar, e-PAN) are checked on their original bytes, as Acrobat does, so open them with the password and the result appears at once. Older Adobe signature styles (`adbe.pkcs7.sha1`, as used by several state portals), RSA-PSS and signatures whose signer certificate is named by key id are supported. Printing draws the validation result into the print copy only; locked files are printed from their page pictures.

## Revocation and certified documents

- **Revocation** is checked like Acrobat does it offline: from the CRL / OCSP data the signer stored in the signature or the PDF's `/DSS` (long-term validation). A certificate revoked before the signing time makes the signature invalid. Validation information added to a file after signing (LTV) is not counted as a change.
- **Live CRL checking** needs a small proxy because browsers cannot reach CA servers: deploy `tools/revocation-proxy/worker.js` and set `REVOCATION_PROXY_URL` in `js/config.js`. Users then get a "Check revocation online" switch (off by default).
- **Certified documents (DocMDP)** are detected with their permission level. A certifying signer must be trusted for certifying: the built-in CCA roots are; certificates you add are only if you tick "Certified documents" in "Add to Trusted Identities". Changes after certification are reported, not analysed.

## Offline

Once the app has loaded it works without a network: editing, merging, organizing, converting, signing, printing and **signature validation** (India's CCA roots are built in; revocation uses the data stored in the file, or the last CRL fetched through the optional proxy). Two optional parts come from a CDN and are kept for offline use by **Offline → Download for offline use**: the OCR engine with English + Hindi data (~15 MB) and the fonts used to match edited PDFs. `tests/smoke17.py` loads the app, switches the network off, reloads, validates a real CCA-issued document, and saves.
