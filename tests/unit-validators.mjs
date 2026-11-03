import * as V from '../js/validators.js';
let fails = 0; const t = (name, cond) => { if (!cond) { fails++; console.log('FAIL', name); } else console.log('ok  ', name); };
// Verhoeff round-trip + known vector (2363 is the textbook example: check digit of "236" is 3)
t('verhoeff known 2363', V.verhoeffValid('2363') && V.verhoeffDigit('236') === 3);
for (let k = 0; k < 200; k++) { const base = String(2 + Math.floor(Math.random()*8)) + Array.from({length:10},()=>Math.floor(Math.random()*10)).join(''); const full = base + V.verhoeffDigit(base); if (!V.validateAadhaar(full).ok) { t('verhoeff roundtrip '+full, false); break; } if (V.validateAadhaar(full.slice(0,11)+((+full[11]+1)%10)).ok) { t('verhoeff detects wrong digit '+full, false); break; } }
t('aadhaar roundtrip x200', true);
t('aadhaar rejects leading 1', !V.validateAadhaar('123456789012').ok);
t('aadhaar rejects 11 digits', !V.validateAadhaar('23456789012').ok);
// GSTIN — widely published sample numbers
for (const g of ['27AAPFU0939F1ZV','27AAACR5055K1Z7','24AAACC1206D1ZM','27AAACT2727Q1ZW']) t('gstin published sample '+g, V.validateGSTIN(g).ok);
t('gstin sample 27AAPFU0939F1ZV', V.validateGSTIN('27AAPFU0939F1ZV').ok);
t('gstin rejects altered check char', !V.validateGSTIN('27AAPFU0939F1ZW').ok);
t('gstin rejects bad state 88', !V.validateGSTIN('88AAPFU0939F1ZV').ok);
t('pan valid', V.validatePAN('ABCPE1234F').ok && V.validatePAN('ABCPE1234F').details.holder === 'Individual');
t('pan bad shape', !V.validatePAN('ABCDE12345').ok && !V.validatePAN('ABCXE1234F').ok);
t('cin valid', V.validateCIN('U72900KL2015PTC036982').ok && V.validateCIN('U72900KL2015PTC036982').details.year === 2015);
t('cin bad year', !V.validateCIN('U72900KL1815PTC036982').ok);
t('cin bad shape', !V.validateCIN('X72900KL2015PTC036982').ok);
t('udyam', V.validateUdyam('UDYAM-KL-01-1234567').ok && !V.validateUdyam('UDYAM-K-01-1234567').ok);
t('ifsc', V.validateIFSC('SBIN0001234').ok && !V.validateIFSC('SBIN1001234').ok);
// scanning
const gen = (b) => b + V.verhoeffDigit(b);
const aad = gen('23456789012');
const text = ['GOVERNMENT OF INDIA','Chumi Test Customer','DOB: 12/03/1990','MALE', aad.replace(/(\d{4})(?=\d)/g,'$1 '), 'Aadhaar - Aam Aadmi ka Adhikar'].join('\n');
const s = V.scanText([text]);
t('scan finds aadhaar + type', s.docTypes.includes('aadhaar') && s.findings.some(f=>f.type==='aadhaar' && f.result.ok));
t('scan fields dob/gender/name', s.fields['Date of birth']==='12/03/1990' && s.fields['Gender']==='MALE' && s.fields['Name']==='Chumi Test Customer');
const gst = ['Government of India','Registration Certificate','Goods and Services Tax','Registration Number: 27AAPFU0939F1ZV','Legal Name: ACME TRADERS FIRM','Trade Name: ACME','Constitution of Business: Partnership','PAN: AAPFU0939F'].join('\n');
const sg = V.scanText([gst]);
console.log(JSON.stringify({types: sg.docTypes, f: sg.findings.map(f=>[f.type,f.value,f.result.ok]), fields: sg.fields, cross: sg.crossChecks.map(c=>[c.label,c.ok])}, null, 0));
t('gst scan', sg.findings.some(f=>f.type==='gstin'&&f.result.ok) && sg.crossChecks.some(c=>/PAN matches/.test(c.label)&&c.ok));
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails?1:0);
