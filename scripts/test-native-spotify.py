"""Native bundle resolver regressions; --live additionally plays a Spotify track.

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
import plistlib
import shutil

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--live', metavar='SPOTIFY_TRACK_URI')
parser.add_argument('--seed', metavar='SPOTIFY_URI', help='Start different content before each focus test')
args = parser.parse_args()
if args.live and not re.fullmatch(r'spotify:track:[A-Za-z0-9]{22}', args.live):
    parser.error('--live requires a canonical spotify:track:<22-character-ID>')
if args.seed and (not args.live or not re.fullmatch(r'spotify:(track|playlist|album):[A-Za-z0-9]{22}', args.seed)):
    parser.error('--seed needs --live and a canonical Spotify track/playlist/album URI')
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
    subprocess.run(['node', 'scripts/run.mjs', 'cargo', 'build', '--manifest-path', 'src-tauri/Cargo.toml',
                    '--no-default-features', '--example', 'spotify-desktop-play', '--offline'], cwd=root, check=True)
    player = root / 'src-tauri/target/debug/examples/spotify-desktop-play'
    live = compile_test('native-spotify-live')
    host_binary = compile_test('native-focus-host')
    # Preserve the original paused state even when --seed starts a playlist or a
    # failing probe exits before its own cleanup. Never launches a closed player.
    jxa = "function run(a) { const s=Application('com.spotify.client'); if(!s.running())throw Error('Spotify is closed'); if(a[0]==='pause'){s.pause();return '';} return s.playerState(); }"
    state = subprocess.check_output(['/usr/bin/osascript', '-l', 'JavaScript', '-e', jxa, 'state'], text=True, timeout=5).strip()
    try:
        for mode in ('normal', 'fullscreen'):
            if args.seed:
                subprocess.run([str(player), args.seed], check=True, timeout=20)
                time.sleep(2)
            with tempfile.TemporaryDirectory(prefix='deskody-spotify-') as directory:
                marker = Path(directory) / 'host'
                # Launch Services gives the fixture a real foreground app identity.
                # A raw executable cannot reliably activate itself on recent macOS.
                bundle = Path(directory) / 'FocusHost.app'
                executable = bundle / 'Contents/MacOS/FocusHost'
                executable.parent.mkdir(parents=True)
                shutil.copy2(host_binary, executable)
                (bundle / 'Contents/Info.plist').write_bytes(plistlib.dumps({
                    'CFBundleExecutable': 'FocusHost', 'CFBundleIdentifier': 'dev.deskody.focus-test',
                    'CFBundleName': 'FocusHost', 'CFBundlePackageType': 'APPL'}))
                host = subprocess.Popen(['/usr/bin/open', '-n', '-W', str(bundle), '--args', str(marker), mode])
                try:
                    deadline = time.monotonic() + 20
                    while not marker.with_suffix('.ready').exists():
                        if host.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError('Fullscreen fixture did not become ready')
                        time.sleep(.1)
                    time.sleep(1)
                    marker.with_suffix('.observe').touch()
                    subprocess.run([str(live), args.live, marker.with_suffix('.ready').read_text(), str(player)], check=True, timeout=25)
                finally:
                    marker.with_suffix('.stop').touch()
                    try:
                        host.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        host.terminate()
                        host.wait(timeout=5)
                if host.returncode != 0 or not marker.with_suffix('.done').exists() or marker.with_suffix('.done').read_text() != 'passed':
                    raise RuntimeError('Fullscreen fixture did not retain its Space')
    finally:
        if state != 'playing':
            subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', jxa, 'pause'], check=True, timeout=5)
    print('Live Spotify: production track playback + zero Spotify activation on normal/fullscreen Spaces passed.')
