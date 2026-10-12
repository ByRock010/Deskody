"""Real AppKit notch integration with fixtures, including an external fullscreen Space.
Requires a logged-in macOS desktop. Temporarily moves/restores the mouse pointer and feeds hover coordinates;
uses its own windows and fixture metadata, never user settings or real playback.
"""
from pathlib import Path
import os
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parent.parent
binary = root / '.tools/native-notch-test'
host_binary = root / '.tools/native-menu-test'
binary.parent.mkdir(exist_ok=True)
for source, output in [('native-notch.m', binary), ('native-menu.m', host_binary)]:
    subprocess.run(['clang', '-fobjc-arc', '-Wall', '-Wextra', '-Wno-unused-parameter', '-Werror',
                    '-framework', 'Cocoa', '-framework', 'QuartzCore', '-framework', 'ApplicationServices',
                    str(root / 'tests' / source), '-o', str(output)],
                   env={**os.environ, 'DEVELOPER_DIR': '/Library/Developer/CommandLineTools'}, check=True, cwd=root)
subprocess.run([str(binary)], check=True, timeout=30, cwd=root)
with tempfile.TemporaryDirectory(prefix='deskody-notch-') as directory:
    marker = Path(directory) / 'host'
    host = subprocess.Popen([str(host_binary), '--host', str(marker)], cwd=root)
    try:
        deadline = time.monotonic() + 20
        while not marker.with_suffix('.ready').exists():
            if host.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError('Fullscreen fixture did not become ready')
            time.sleep(.1)
        time.sleep(1)
        subprocess.run([str(binary), str(host.pid)], check=True, timeout=30, cwd=root)
    finally:
        marker.with_suffix('.stop').touch()
        try:
            host.wait(timeout=5)
        except subprocess.TimeoutExpired:
            host.terminate()
            host.wait(timeout=5)
    if host.returncode != 0:
        raise RuntimeError(f'Fullscreen fixture failed: {host.returncode}')
print('Native notch: current Space + external fullscreen integration passed.')
