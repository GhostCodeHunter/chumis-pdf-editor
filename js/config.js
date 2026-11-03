// Central settings. Edit this file to rebrand or to self-host optional libraries.
export const APP_NAME = "Chumi's PDF Editor";
export const APP_SHORT = 'Chumi PDF';
export const COPYRIGHT_HOLDER = 'Chumi';
export const COPYRIGHT_YEAR = 2026;
// Set to your GitHub repository URL after you publish (shown in the footer and legal pages). Leave empty to hide.
export const REPO_URL = '';
export const APP_TAGLINE = 'Edit, OCR, merge, convert and verify PDFs — privately, in your browser.';

// OCR engine (Tesseract.js) is fetched on first use. Pin a version; point to your own copy to work fully offline.
export const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
// Leave empty to use Tesseract's default language-data host (supports ~100 languages).
export const TESSERACT_LANG_PATH = '';

// Optional: URL of YOUR OWN server-side proxy for live government-ID verification (see README "Live verification").
// The browser sends  POST { type, value }  and expects  { ok: boolean, message?: string, details?: object }.
// Never put third-party API keys in this file — it is public once published.
export const VERIFY_PROXY_URL = '';

export const MAX_UNDO = 80;
