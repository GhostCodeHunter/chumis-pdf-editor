// Offline validators for Indian government identifiers. Pure functions (no DOM) so they can be unit-tested in Node.
// These check FORMAT and CHECKSUM only. They cannot prove that a number was actually issued — see PORTALS below.

/* ---------------------------------------------------------------- Verhoeff (Aadhaar) */
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0,4,3,2,1,5,6,7,8,9];
export function verhoeffValid(digits) {
  let c = 0; const a = String(digits).split('').reverse().map(Number);
  for (let i = 0; i < a.length; i++) c = D[c][P[i % 8][a[i]]];
  return c === 0;
}
export function verhoeffDigit(digits) {
  let c = 0; const a = String(digits).split('').reverse().map(Number);
  for (let i = 0; i < a.length; i++) c = D[c][P[(i + 1) % 8][a[i]]];
  return INV[c];
}

/* ---------------------------------------------------------------- reference data */
export const GST_STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '25': 'Daman & Diu (old code)', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '28': 'Andhra Pradesh (old code)', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction' };
export const PAN_TYPES = { P: 'Individual', C: 'Company', H: 'Hindu Undivided Family', F: 'Firm / LLP', A: 'Association of Persons', T: 'Trust', B: 'Body of Individuals', L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government' };
const CIN_STATES = new Set('AN AP AR AS BR CH CT DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OR PB PY RJ SK TG TN TR TS UP UR UK WB'.split(' '));
const CIN_OWNERSHIP = { PLC: 'Public limited company', PTC: 'Private limited company', GOI: 'Government of India company', SGC: 'State government company', FTC: 'Subsidiary of a foreign company', NPL: 'Not-for-profit (Section 8) company', ULL: 'Unlimited liability (with share capital)', ULT: 'Unlimited liability (without share capital)', OPC: 'One person company', FLC: 'Financial lease company', GAP: 'Guarantee & association public', GAT: 'Guarantee & association private' };

/* ---------------------------------------------------------------- validators — each returns { ok, checks: [{label, ok, note?, warn?}], details } */
const chk = (label, ok, note, warn) => ({ label, ok: !!ok, note, warn: !!warn });
const finish = (checks, details = {}) => ({ ok: checks.every(c => c.ok || c.warn), checks, details });
export const clean = s => String(s ?? '').toUpperCase().replace(/[\s -]+/g, '');

export function validateAadhaar(input) {
  const v = String(input ?? '').replace(/\D/g, '');
  const checks = [chk('12 digits', v.length === 12, v.length !== 12 ? `Found ${v.length} digits` : undefined)];
  if (v.length === 12) {
    checks.push(chk('Does not start with 0 or 1', /^[2-9]/.test(v)));
    checks.push(chk('Not a repeated digit', !/^(\d)\1{11}$/.test(v)));
    checks.push(chk('Verhoeff checksum', verhoeffValid(v), verhoeffValid(v) ? 'The last digit is consistent with the first 11.' : 'The last digit does not match — a typo or an invalid number.'));
  }
  return finish(checks, { masked: v.length === 12 ? 'XXXX XXXX ' + v.slice(8) : '' });
}

export function validatePAN(input) {
  const v = clean(input); const checks = [chk('10 characters: 5 letters, 4 digits, 1 letter', /^[A-Z]{5}\d{4}[A-Z]$/.test(v))];
  const details = {};
  if (/^[A-Z]{5}\d{4}[A-Z]$/.test(v)) {
    const t = v[3]; details.holder = PAN_TYPES[t] || 'Unknown'; details.initial = v[4];
    checks.push(chk(`4th letter “${t}” = ${PAN_TYPES[t] || 'not a known holder type'}`, !!PAN_TYPES[t]));
    checks.push(chk('Last letter is a check letter', true, 'The check-letter algorithm is not public, so it cannot be verified offline.', true));
  }
  return finish(checks, details);
}

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = B36.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
  return B36[(36 - (sum % 36)) % 36];
}
export function validateGSTIN(input) {
  const v = clean(input); const fmt = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v);
  const checks = [chk('15 characters in GSTIN format', fmt)]; const details = {};
  if (fmt) {
    const st = v.slice(0, 2); details.state = GST_STATES[st]; details.pan = v.slice(2, 12); details.entity = v[12];
    checks.push(chk(`State code ${st}${details.state ? ' = ' + details.state : ''}`, !!details.state));
    const pan = validatePAN(details.pan); checks.push(chk(`Embedded PAN ${details.pan} is well-formed`, pan.ok)); details.panType = pan.details.holder;
    const expect = gstinCheckChar(v.slice(0, 14)); checks.push(chk('Check character (mod-36)', expect === v[14], expect === v[14] ? undefined : `Expected “${expect}” but found “${v[14]}”.`));
  }
  return finish(checks, details);
}

export function validateCIN(input) {
  const v = clean(input); const m = /^([LU])(\d{5})([A-Z]{2})(\d{4})([A-Z]{3})(\d{6})$/.exec(v);
  const checks = [chk('21 characters in CIN format', !!m)]; const details = {};
  if (m) {
    details.listed = m[1] === 'L' ? 'Listed company' : 'Unlisted company'; details.nic = m[2]; details.state = m[3]; details.year = +m[4]; details.ownership = CIN_OWNERSHIP[m[5]]; details.regNo = m[6];
    checks.push(chk(`Listing status: ${details.listed}`, true));
    checks.push(chk(`State / ROC code ${m[3]}`, CIN_STATES.has(m[3]), CIN_STATES.has(m[3]) ? undefined : 'Unrecognised code', true));
    checks.push(chk(`Year of incorporation ${m[4]}`, details.year >= 1857 && details.year <= new Date().getFullYear(), 'Must be between 1857 and this year'));
    checks.push(chk(`Ownership code ${m[5]}${details.ownership ? ' = ' + details.ownership : ''}`, !!details.ownership, details.ownership ? undefined : 'Unrecognised ownership code', !details.ownership));
  }
  return finish(checks, details);
}
export function validateLLPIN(input) { const v = String(input ?? '').toUpperCase().replace(/\s/g, ''); return finish([chk('Format AAA-1234', /^[A-Z]{3}-\d{4}$/.test(v))]); }
export const validateTAN = i => { const v = clean(i); return finish([chk('10 characters: 4 letters, 5 digits, 1 letter', /^[A-Z]{4}\d{5}[A-Z]$/.test(v))]); };
export const validateUdyam = i => { const v = String(i ?? '').toUpperCase().replace(/\s/g, ''); const ok = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(v); return finish([chk('Format UDYAM-XX-00-0000000', ok)], ok ? { state: v.slice(6, 8) } : {}); };
export const validateEPIC = i => { const v = clean(i); return finish([chk('3 letters + 7 digits', /^[A-Z]{3}\d{7}$/.test(v))]); };
export const validatePassport = i => { const v = clean(i); return finish([chk('1 letter + 7 digits (Indian passport)', /^[A-PR-WY][1-9]\d{6}$/.test(v) || /^[A-PR-WY][1-9]\d{5}[1-9]$/.test(v))]); };
export const validateDL = i => { const v = clean(i); const ok = /^[A-Z]{2}\d{2}(19|20)\d{2}\d{7}$/.test(v); return finish([chk('State + RTO + year + 7 digits', ok)]); };
export const validateIFSC = i => { const v = clean(i); return finish([chk('4 letters, “0”, then 6 characters', /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v))]); };

export const TYPES = {
  aadhaar: { label: 'Aadhaar number', fn: validateAadhaar, example: '2345 6789 0123' },
  pan: { label: 'PAN', fn: validatePAN, example: 'ABCDE1234F' },
  gstin: { label: 'GSTIN', fn: validateGSTIN, example: '27AAPFU0939F1ZV' },
  cin: { label: 'CIN (company)', fn: validateCIN, example: 'U12345MH2020PTC123456' },
  llpin: { label: 'LLPIN', fn: validateLLPIN, example: 'AAB-1234' },
  tan: { label: 'TAN', fn: validateTAN, example: 'MUMA12345B' },
  udyam: { label: 'Udyam registration', fn: validateUdyam, example: 'UDYAM-KL-01-1234567' },
  epic: { label: 'Voter ID (EPIC)', fn: validateEPIC, example: 'ABC1234567' },
  passport: { label: 'Passport number', fn: validatePassport, example: 'K1234567' },
  dl: { label: 'Driving licence', fn: validateDL, example: 'KL0720110012345' },
  ifsc: { label: 'IFSC code', fn: validateIFSC, example: 'SBIN0001234' },
};

/** Where the real check is done. Verified against the official sites' own guidance. */
export const PORTALS = {
  aadhaar: { name: 'UIDAI — Verify an Aadhaar Number', url: 'https://myaadhaar.uidai.gov.in/verifyAadhaar', note: 'Confirms the number exists and shows age band, gender, state and last 3 digits of the linked mobile. It does not show name or photo.' },
  pan: { name: 'Income Tax e-Filing — Verify Your PAN', url: 'https://eportal.incometax.gov.in/iec/foservices/#/pre-login/verifyYourPAN', note: 'Free, no login. Checks that the PAN is active and that the name and date of birth match.' },
  gstin: { name: 'GST Portal — Search Taxpayer', url: 'https://services.gst.gov.in/services/searchtp', note: 'Free, no login. Shows legal name, status (Active / Cancelled / Suspended) and registration details.' },
  cin: { name: 'MCA — View Company/LLP Master Data', url: 'https://www.mca.gov.in/', note: 'Open MCA Services → Master Data → View Company/LLP Master Data and enter the CIN.' },
  llpin: { name: 'MCA — View Company/LLP Master Data', url: 'https://www.mca.gov.in/', note: 'Open MCA Services → Master Data → View Company/LLP Master Data and enter the LLPIN.' },
  udyam: { name: 'Udyam Registration — Verify', url: 'https://udyamregistration.gov.in/', note: 'Use Print/Verify → Verify Udyam Registration. Only use the official domain; private sites may charge fees.' },
  epic: { name: 'Election Commission — Electoral Search', url: 'https://electoralsearch.eci.gov.in/', note: 'Search your own or another elector entry.' },
  dl: { name: 'Parivahan Sewa', url: 'https://parivahan.gov.in/', note: 'Driving-licence services of the Ministry of Road Transport & Highways.' },
};

/* ---------------------------------------------------------------- scanning free text */
const KEYWORDS = {
  aadhaar: /AADHAAR|AADHAR|आधार|UNIQUE IDENTIFICATION AUTHORITY|UIDAI|MERA AADHAAR/i,
  pan: /PERMANENT ACCOUNT NUMBER|INCOME TAX DEPARTMENT|आयकर विभाग|E-?PAN/i,
  gst: /GOODS AND SERVICES TAX|REGISTRATION CERTIFICATE|GSTIN|FORM GST REG|GSTN/i,
  coi: /CERTIFICATE OF INCORPORATION|CORPORATE IDENTITY NUMBER|MINISTRY OF CORPORATE AFFAIRS|REGISTRAR OF COMPANIES/i,
  udyam: /UDYAM REGISTRATION|MSME/i, epic: /ELECTION COMMISSION OF INDIA|ELECTOR'?S? PHOTO IDENTITY/i, dl: /DRIVING LICEN[CS]E/i, passport: /REPUBLIC OF INDIA.*PASSPORT|PASSPORT NO/is,
  llp: /LIMITED LIABILITY PARTNERSHIP|LLPIN/i,
};
export const DOC_LABELS = { aadhaar: 'Aadhaar', pan: 'PAN card', gst: 'GST registration certificate', coi: 'Certificate of Incorporation', udyam: 'Udyam certificate', epic: 'Voter ID', dl: 'Driving licence', passport: 'Passport' };

function labelValue(lines, label, { maxLen = 90 } = {}) {
  for (let i = 0; i < lines.length; i++) {
    const m = label.exec(lines[i]);
    if (!m) continue;
    let rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:.\-–—|]+/, '').trim();
    if (!rest) { for (let k = i + 1; k < Math.min(lines.length, i + 3); k++) { const t = lines[k].trim(); if (t && !/^[\d\W]*$/.test(t)) { rest = t; break; } } }
    if (rest && rest.length <= maxLen) return rest;
  }
  return '';
}

/**
 * Finds identifiers and labelled fields in extracted text.
 * Returns { docTypes: [...], findings: [{type, value, display, result, page, source}], fields: {...}, crossChecks: [...] }
 */
export function scanText(pages) {
  const text = pages.join('\n'); const upper = text.toUpperCase(); const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const docTypes = Object.entries(KEYWORDS).filter(([, re]) => re.test(text)).map(([k]) => k).filter(k => k !== 'llp');
  const findings = []; const seen = new Set();
  const add = (type, value, extra = {}) => {
    const key = type + ':' + clean(value); if (seen.has(key)) return; seen.add(key);
    findings.push({ type, value, result: TYPES[type].fn(value), ...extra });
  };
  const pageOf = needle => { const k = pages.findIndex(p => p.toUpperCase().replace(/\s+/g, '').includes(clean(needle))); return k >= 0 ? k : 0; };
  const gstins = [...upper.matchAll(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g)].map(m => m[0]);
  gstins.forEach(g => add('gstin', g, { page: pageOf(g) }));
  const gstPans = new Set(gstins.map(g => g.slice(2, 12)));
  [...upper.matchAll(/\b[A-Z]{5}\d{4}[A-Z]\b/g)].map(m => m[0]).forEach(p => add('pan', p, { page: pageOf(p), embeddedInGstin: gstPans.has(p) }));
  [...upper.matchAll(/\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/g)].forEach(m => add('cin', m[0], { page: pageOf(m[0]) }));
  if (KEYWORDS.llp.test(text)) [...upper.matchAll(/\b[A-Z]{3}-\d{4}\b/g)].forEach(m => add('llpin', m[0], { page: pageOf(m[0]) }));
  [...upper.matchAll(/\b[A-Z]{4}\d{5}[A-Z]\b/g)].forEach(m => { if (!gstPans.has(m[0]) && /\bTAN\b/.test(upper)) add('tan', m[0], { page: pageOf(m[0]) }); });
  [...upper.matchAll(/\bUDYAM-[A-Z]{2}-\d{2}-\d{7}\b/g)].forEach(m => add('udyam', m[0], { page: pageOf(m[0]) }));
  [...upper.matchAll(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g)].forEach(m => { if (/IFSC/.test(upper)) add('ifsc', m[0], { page: pageOf(m[0]) }); });
  if (docTypes.includes('epic')) [...upper.matchAll(/\b[A-Z]{3}\d{7}\b/g)].forEach(m => add('epic', m[0], { page: pageOf(m[0]) }));
  if (docTypes.includes('dl')) [...upper.matchAll(/\b[A-Z]{2}[- ]?\d{2}[- ]?(?:19|20)\d{2}[- ]?\d{7}\b/g)].forEach(m => add('dl', m[0], { page: pageOf(m[0]) }));
  // Aadhaar: 12 digits in groups of 4 (also masked XXXX XXXX 1234)
  const aad = [...text.matchAll(/(?<![\d])([2-9]\d{3})[\s-]?(\d{4})[\s-]?(\d{4})(?![\d])/g)].map(m => m[1] + m[2] + m[3]);
  const aadKeyword = docTypes.includes('aadhaar');
  for (const a of aad) { const r = validateAadhaar(a); if (aadKeyword || r.ok) add('aadhaar', a, { page: pageOf(a), possible: !aadKeyword }); }
  const masked = [...text.matchAll(/(?:[Xx*•]{4}[\s-]?){2}(\d{4})(?!\d)/g)].map(m => m[1]);
  masked.forEach(l4 => { const key = 'masked:' + l4; if (seen.has(key)) return; seen.add(key); findings.push({ type: 'aadhaar', value: 'XXXX XXXX ' + l4, masked: true, result: { ok: true, checks: [chk('Masked Aadhaar — only the last 4 digits are visible', true, 'A masked number cannot be checksum-verified.', true)], details: {} }, page: 0 }); });
  const vids = [...text.matchAll(/(?<!\d)(\d{4})\s(\d{4})\s(\d{4})\s(\d{4})(?!\d)/g)].map(m => m.slice(1).join(''));
  const vid = vids.length ? vids[0] : '';

  /* labelled fields */
  const fields = {};
  const set = (k, v) => { if (v && !fields[k]) fields[k] = v; };
  const dob = /(?:DOB|DATE OF BIRTH|जन्म तिथि|जन्म)\s*[:\-]?\s*([0-3]?\d[\/\-.][01]?\d[\/\-.](?:19|20)\d{2})/i.exec(text); if (dob) set('Date of birth', dob[1]);
  const yob = /YEAR OF BIRTH\s*[:\-]?\s*((?:19|20)\d{2})/i.exec(text); if (yob) set('Year of birth', yob[1]);
  const gender = /\b(MALE|FEMALE|TRANSGENDER)\b/i.exec(text); if (gender && aadKeyword) set('Gender', gender[1].toUpperCase());
  if (docTypes.includes('pan')) { set('Name', labelValue(lines, /^\s*(?:नाम\s*\/\s*)?NAME\b/i)); set("Father's name", labelValue(lines, /FATHER'?S? NAME/i)); }
  if (aadKeyword) {
    const dobIdx = lines.findIndex(l => /DOB|DATE OF BIRTH|YEAR OF BIRTH/i.test(l));
    if (dobIdx > 0) { for (let k = dobIdx - 1; k >= Math.max(0, dobIdx - 3); k--) { if (/^[A-Za-z][A-Za-z .'-]{2,40}$/.test(lines[k]) && !/GOVERNMENT|INDIA|AADHAAR|AUTHORITY/i.test(lines[k])) { set('Name', lines[k]); break; } } }
    set('Name', labelValue(lines, /^\s*NAME\b/i));
  }
  if (docTypes.includes('gst')) {
    set('Legal name', labelValue(lines, /LEGAL NAME(?: OF BUSINESS)?/i)); set('Trade name', labelValue(lines, /TRADE NAME/i)); set('Constitution of business', labelValue(lines, /CONSTITUTION OF BUSINESS/i));
    set('Type of registration', labelValue(lines, /TYPE OF REGISTRATION/i)); set('Date of liability', labelValue(lines, /DATE OF LIABILITY/i, { maxLen: 30 }));
    set('Address', labelValue(lines, /(?:ADDRESS OF PRINCIPAL PLACE OF BUSINESS|PRINCIPAL PLACE OF BUSINESS|ADDRESS)/i, { maxLen: 200 }));
  }
  if (docTypes.includes('coi')) {
    const nm = /CERTIFY THAT\s+(.+?)\s+IS\s+(?:THIS\s+DAY\s+)?INCORPORATED/is.exec(text.replace(/\s+/g, ' ')); if (nm) set('Company name', nm[1].trim());
    set('Company name', labelValue(lines, /(?:NAME OF (?:THE )?COMPANY|COMPANY NAME)/i)); set('Date of incorporation', labelValue(lines, /DATE OF INCORPORATION/i, { maxLen: 30 }));
  }

  /* cross-checks between identifiers and fields */
  const cross = []; const ok = (label, good, note) => cross.push({ label, ok: good, note });
  const gst = findings.find(f => f.type === 'gstin' && f.result.checks[0].ok); const panF = findings.find(f => f.type === 'pan');
  if (gst && panF) ok('PAN matches the PAN inside the GSTIN', gst.value.slice(2, 12) === clean(panF.value), `GSTIN contains ${gst.value.slice(2, 12)}; PAN on the document is ${clean(panF.value)}.`);
  const legal = fields['Legal name'] || fields['Company name'] || fields['Name'];
  const holderPan = (gst && gst.value.slice(2, 12)) || (panF && clean(panF.value));
  if (holderPan && legal && /^[A-Z]{5}\d{4}[A-Z]$/.test(holderPan)) {
    const t = holderPan[3]; const u = legal.toUpperCase(); const corp = /\b(PVT|PRIVATE|LTD|LIMITED|COMPANY|CORPORATION)\b/.test(u); const firm = /\b(LLP|PARTNERSHIP|ASSOCIATES|& CO|AND CO|ENTERPRISES|TRADERS|FIRM)\b/.test(u); const huf = /\bHUF\b|HINDU UNDIVIDED/.test(u); const trust = /\b(TRUST|FOUNDATION|SOCIETY)\b/.test(u);
    if (corp) ok(`Name looks like a company; PAN type is “${t}” (${PAN_TYPES[t] || '?'})`, t === 'C' || t === 'G' || t === 'L' || t === 'J', 'Companies normally have a PAN whose 4th letter is C.');
    else if (huf) ok(`Name looks like a HUF; PAN type is “${t}”`, t === 'H');
    else if (trust) ok(`Name looks like a trust/society; PAN type is “${t}”`, ['T', 'A', 'B'].includes(t));
    else if (firm) ok(`Name looks like a firm/LLP; PAN type is “${t}”`, ['F', 'A', 'P'].includes(t));
    const first = u.replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean);
    if (t === 'P' && first.length) ok(`PAN 5th letter “${holderPan[4]}” matches the start of a name word`, first.some(w => w[0] === holderPan[4]), 'For individuals the 5th letter is the first letter of the surname.');
    else if (t !== 'P' && first.length && (corp || firm || trust)) ok(`PAN 5th letter “${holderPan[4]}” matches the entity name`, first[0][0] === holderPan[4], 'For non-individuals the 5th letter is the first letter of the name.');
  }
  const cin = findings.find(f => f.type === 'cin' && f.result.checks[0].ok); const inc = fields['Date of incorporation'];
  if (cin && inc) { const y = /(19|20)\d{2}/.exec(inc); if (y) ok(`CIN year ${cin.result.details.year} matches the date of incorporation`, +y[0] === cin.result.details.year); }
  const ids = findings.filter(f => f.type === 'aadhaar' && !f.masked); const mk = findings.filter(f => f.masked);
  if (ids.length && mk.length) ok('Masked and unmasked Aadhaar numbers end in the same 4 digits', mk.every(m => ids.some(i => clean(i.value).endsWith(m.value.slice(-4)))));
  if (vid) cross.push({ label: 'A 16-digit Virtual ID (VID) is printed on this document', ok: true, note: 'VIDs are validated only by UIDAI.', neutral: true });
  return { docTypes, findings, fields, crossChecks: cross, text, vid };
}

/** Aadhaar number boxes for masking: returns [{page, x, y, w, h}] using positioned text items. items: [{str, x, baseline, w, fs}] */
export function aadhaarMaskBoxes(items) {
  const boxes = [];
  for (const it of items) {
    const m = /(?<!\d)([2-9]\d{3})(\s?)(\d{4})(\s?)(\d{4})(?!\d)/.exec(it.str);
    if (!m) continue;
    const full = m[1] + m[3] + m[5]; if (!validateAadhaar(full).ok && !/AADHAAR/i.test('')) { /* keep even if invalid when keyword present — caller decides */ }
    const L = it.str.length; const start = m.index; const end = m.index + m[1].length + m[2].length + m[3].length; // first 8 digits
    const cw = it.w / L;
    boxes.push({ x: it.x + start * cw - 1, y: it.baseline - it.fs * 0.95, w: (end - start) * cw + 2, h: it.fs * 1.2, value: full });
  }
  return boxes;
}
