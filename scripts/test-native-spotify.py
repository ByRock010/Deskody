"""Native focus-policy regressions; --live additionally plays a Spotify track.

Live mode needs a logged-in Spotify desktop app and macOS Automation permission.
It changes the current track, preserves the initial play/pause state, and uses a
short-lived fullscreen fixture. It does not need Spotify Premium or a Web API ID.
"""
from pathlib import Path
import argparse
import os
import re
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--live', metavar='SPOTIFY_TRACK_URI')
args = parser.parse_args()
if args.live and not re.fullmatch(r'spotify:track:[A-Za-z0-9]{22}', args.live):
    parser.error('--live requires a canonical spotify:track:<22-character-ID>')
env = {**os.environ, 'DEVELOPER_DIR': '/Library/Developer/CommandLineTools'}
(root / '.tools').mkdir(exist_ok=True)
def compile_test(name):
    binary = root / '.tools' / name
    subprocess.run(['clang', '-fobjc-arc', '-mmacosx-version-min=12.0', '-Wall',
                    '-Wextra', '-Wno-unused-parameter', '-Werror', '-framework', 'Cocoa',
                    str(root / 'tests' / (name + '.m')), '-o', str(binary)], env=env, check=True)
    return binary

subprocess.run([str(compile_test('native-spotify'))], check=True, timeout=10)
if args.live:
    live = compile_test('native-spotify-live')
    host_binary = compile_test('native-focus-host')
    for mode in ('normal', 'fullscreen'):
        with tempfile.TemporaryDirectory(prefix='deskody-spotify-') as directory:
            marker = Path(directory) / 'host'
            host = subprocess.Popen([str(host_binary), str(marker), mode])
            try:
                deadline = time.monotonic() + 20
                while not marker.with_suffix('.ready').exists():
                    if host.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('Fullscreen fixture did not become ready')
                    time.sleep(.1)
                time.sleep(1)
                subprocess.run([str(live), args.live, str(host.pid)], check=True, timeout=20)
            finally:
                marker.with_suffix('.stop').touch()
                try:
                    host.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    host.terminate()
                    host.wait(timeout=5)
            if host.returncode != 0:
                raise RuntimeError('Fullscreen fixture did not retain its Space')
    print('Live Spotify: track playback + focus recovery on normal/fullscreen Spaces passed.')
