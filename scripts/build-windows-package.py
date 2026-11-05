#!/usr/bin/env python3
"""Build a credential-free Windows x64 package using a checksum-verified Node runtime."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'releases'
WORK = OUT / '_work'
APP = WORK / 'StayDesk' / 'app'
VERSION = 'v24.22.2'
NAME = f'node-{VERSION}-win-x64'
ARCHIVE = NAME + '.zip'
BASE = f'https://nodejs.org/dist/{VERSION}'
OUT.mkdir(exist_ok=True)
CACHE = OUT / '_cache'
CACHE.mkdir(exist_ok=True)
manifest = urllib.request.urlopen(BASE + '/SHASUMS256.txt', timeout=30).read().decode('utf-8')
checksums = dict((line.split()[1].lstrip('*'), line.split()[0]) for line in manifest.splitlines() if line.strip())
expected = checksums[ARCHIVE]
archive = CACHE / ARCHIVE
if not archive.exists() or hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() != expected:
    temporary = archive.with_suffix('.zip.partial')
    with urllib.request.urlopen(BASE + '/' + ARCHIVE, timeout=90) as response, temporary.open('wb') as target:
        shutil.copyfileobj(response, target)
    if hashlib.file_digest(temporary.open('rb'), 'sha256').hexdigest() != expected:
        temporary.unlink(missing_ok=True)
        raise RuntimeError('Official Node SHA-256 mismatch; refusing the runtime.')
    temporary.replace(archive)
print('Official Node runtime SHA-256 verified.', flush=True)
if WORK.exists():
    shutil.rmtree(WORK)
APP.mkdir(parents=True)
package_root = APP.parent
runtime = package_root / 'runtime'
runtime.mkdir()
with zipfile.ZipFile(archive) as source:
    for filename in ('node.exe', 'LICENSE', 'README.md', 'CHANGELOG.md'):
        (runtime / filename).write_bytes(source.read(NAME + '/' + filename))
lock = json.loads((ROOT / 'package-lock.json').read_text())
package = {
    'name': 'staydesk-windows-runtime', 'version': '1.0.0', 'private': True, 'type': 'module',
    'dependencies': {name: lock['packages']['node_modules/' + name]['version'] for name in ('express', 'playwright')}
}
(APP / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
env = {k: v for k, v in os.environ.items() if k not in ('SONO_USERNAME', 'SONO_PASSWORD', 'SONO_CONNECTOR_TOKEN', 'SONO_CONNECTOR_URL')}
subprocess.run(['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=APP, env=env, check=True)
subprocess.run(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=APP, env=env, check=True)
shutil.copytree(ROOT / 'server', APP / 'server')
shutil.copytree(ROOT / 'dist', APP / 'dist')
for filename in ('START.cmd', 'launcher.cjs', 'README.txt'):
    text = (ROOT / 'desktop' / filename).read_text()
    # Windows CMD uses CRLF; Node and Windows browsers accept UTF-8.
    (package_root / filename).write_bytes(text.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8'))
metadata = {'node_version': VERSION, 'node_source': BASE + '/' + ARCHIVE, 'node_archive_sha256': expected,
            'node_exe_sha256': hashlib.file_digest((runtime / 'node.exe').open('rb'), 'sha256').hexdigest(),
            'runtime_dependencies': package['dependencies'], 'contains_credentials': False,
            'tested_platform': 'Linux server and launcher logic; Windows launch requires user confirmation'}
(package_root / 'release-info.json').write_text(json.dumps(metadata, indent=2) + '\n')
# Only explicit package paths are copied above: no .env, browser state, artifacts or local Git data.
for path in package_root.rglob('*'):
    if path.name.startswith('.env') or path.name == '.git':
        raise RuntimeError('Unexpected sensitive/configuration file in package: ' + str(path.relative_to(package_root)))
    if path.is_file() and path.suffix in ('.js', '.json', '.cjs', '.html', '.txt', '.cmd'):
        data = path.read_bytes()
        for name in ('SONO_USERNAME', 'SONO_PASSWORD'):
            value = os.environ.get(name)
            if value and len(value) >= 4 and value.encode() in data:
                raise RuntimeError('Credential value detected; package refused. File: ' + str(path.relative_to(package_root)))
output = OUT / 'StayDesk-Windows-x64.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=7) as target:
    for path in sorted(package_root.rglob('*')):
        if path.is_file() and not path.is_symlink():
            target.write(path, path.relative_to(WORK))
sha256 = hashlib.file_digest(output.open('rb'), 'sha256').hexdigest()
(output.with_suffix('.zip.sha256')).write_text(sha256 + '  ' + output.name + '\n')
print(f'Created {output} ({output.stat().st_size / 1024 / 1024:.1f} MiB). No account values included.', flush=True)
