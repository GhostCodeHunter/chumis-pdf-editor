"""CA with a good and a revoked leaf; produces CRL (DER) and OCSP responses (DER).  Usage: python3 tests/make_revocation.py OUTDIR"""
import os, sys, subprocess
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True); os.chdir(OUT)
def run(*a): return subprocess.run(a, check=True, capture_output=True)
open('ca.cnf', 'w').write('''[ca]
default_ca = CA
[CA]
dir = .
database = index.txt
serial = serial.txt
crlnumber = crlnumber.txt
new_certs_dir = .
default_md = sha256
default_days = 3650
default_crl_days = 7
policy = pol
unique_subject = no
[pol]
commonName = supplied
[v3_ca]
basicConstraints = CA:TRUE
keyUsage = keyCertSign, cRLSign
subjectKeyIdentifier = hash
[v3_leaf]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, nonRepudiation
''')
open('index.txt', 'w').close(); open('serial.txt', 'w').write('1000\n'); open('crlnumber.txt', 'w').write('01\n')
run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=Rev Test CA/O=Chumi/C=IN', '-days', '3650', '-sha256', '-config', 'ca.cnf', '-extensions', 'v3_ca')
for n in ('good', 'bad'):
    run('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', n + '.key', '-out', n + '.csr', '-subj', f'/CN=Leaf {n}')
    run('openssl', 'ca', '-batch', '-config', 'ca.cnf', '-cert', 'ca.pem', '-keyfile', 'ca.key', '-in', n + '.csr', '-out', n + '.pem', '-extensions', 'v3_leaf', '-notext')
run('openssl', 'ca', '-config', 'ca.cnf', '-cert', 'ca.pem', '-keyfile', 'ca.key', '-revoke', 'bad.pem', '-crl_reason', 'keyCompromise')
run('openssl', 'ca', '-config', 'ca.cnf', '-cert', 'ca.pem', '-keyfile', 'ca.key', '-gencrl', '-out', 'ca.crl.pem'); run('openssl', 'crl', '-in', 'ca.crl.pem', '-outform', 'DER', '-out', 'ca.crl')
for n in ('good', 'bad'):
    run('openssl', 'ocsp', '-index', 'index.txt', '-rsigner', 'ca.pem', '-rkey', 'ca.key', '-CA', 'ca.pem', '-issuer', 'ca.pem', '-cert', n + '.pem', '-respout', n + '.ocsp', '-ndays', '7')
print('ok', sorted(f for f in os.listdir('.') if f.endswith(('.crl', '.ocsp', '.pem'))))
