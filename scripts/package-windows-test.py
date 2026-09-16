"""Package a built Windows installer and a clean Chromium extension for testers."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--installer', type=Path)
parser.add_argument('--target', default='x86_64-pc-windows-msvc')
parser.add_argument('--output', type=Path, default=ROOT / 'dist-releases')
args = parser.parse_args()
version = json.loads((ROOT / 'package.json').read_text())['version']
if args.installer is None:
    candidates = list((ROOT / 'src-tauri/target/release/bundle/nsis').glob('*_x64-setup.exe'))
    if len(candidates) != 1:
        parser.error('Pass --installer with the exact built x64 setup EXE')
    args.installer = candidates[0]
installer = args.installer.resolve()
if not installer.name.endswith('_x64-setup.exe') or version not in installer.name:
    parser.error('Installer filename must match the current version and x64 target')
# Reject missing, truncated or non-Windows inputs rather than shipping source/stubs.
data = installer.read_bytes()
if len(data) < 1024 or data[:2] != b'MZ':
    parser.error('Installer is not a Windows PE executable')
pe = struct.unpack_from('<I', data, 0x3c)[0]
if data[pe:pe+4] != b'PE\0\0':
    parser.error('Installer PE signature is invalid')

subprocess.run(['node', 'scripts/package-extension.mjs'], cwd=ROOT, check=True)
manifest = json.loads((ROOT / 'dist-extensions/chromium/manifest.json').read_text())
files = {'manifest.json', 'background.js', 'media-target.js', 'heartbeat.js',
         'music.js', 'music-page.js', 'options.html', 'options.css', 'options.js'}
args.output.mkdir(parents=True, exist_ok=True)
name = f'Deskody-{version}-Windows-x64-test'
archive = args.output / f'{name}.zip'
with tempfile.TemporaryDirectory(prefix='deskody-windows-') as temporary:
    package = Path(temporary) / name
    bridge = package / 'Deskody-Bridge'
    bridge.mkdir(parents=True)
    shutil.copy2(installer, package / installer.name)
    # An allowlist excludes browser profiles, caches, settings and pairing keys.
    for file in sorted(files):
        shutil.copy2(ROOT / 'dist-extensions/chromium' / file, bridge / file)
    for source, destination in [('WINDOWS-TEST-KURULUM.txt', 'ONCE-BENI-OKU.txt'),
                                ('WINDOWS-TEST-SONUCLARI.txt', 'TEST-SONUCLARI.txt')]:
        text = (ROOT / 'docs' / source).read_text(encoding='utf-8')
        (package / destination).write_text(text, encoding='utf-8-sig', newline='\r\n')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    (package / 'BUILD-INFO.json').write_text(json.dumps({
        'applicationVersion': version, 'extensionVersion': manifest['version'],
        'target': args.target, 'sourceRevision': revision, 'localChanges': dirty,
        'installer': installer.name, 'signed': False, 'windowsDesktopTested': False,
    }, indent=2) + '\n', encoding='utf-8')
    checksums = []
    for path in sorted(package.rglob('*')):
        if path.is_file():
            checksums.append(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(package).as_posix()}')
    (package / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='ascii')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as out:
        for path in sorted(package.rglob('*')):
            if path.is_file():
                out.write(path, path.relative_to(package.parent).as_posix())
with zipfile.ZipFile(archive) as check:
    if check.testzip() is not None:
        raise RuntimeError('ZIP integrity check failed')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n', encoding='ascii')
print(f'Created: {archive}')
print(f'Size: {archive.stat().st_size / 1024 / 1024:.1f} MiB')
print(f'SHA-256: {digest}')
