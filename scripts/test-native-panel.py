"""Runs the real AppKit panel on the current Space and an external fullscreen Space.

Uses only its own test windows. No AX grant, settings access, account or media action.
Requires a logged-in macOS GUI session; temporarily opens a fullscreen fixture.
"""
from pathlib import Path
import os
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parent.parent
binary = root / ".tools/native-panel-test"
binary.parent.mkdir(exist_ok=True)
subprocess.run([
    "clang", "-fobjc-arc", "-Wall", "-Wextra", "-Wno-unused-parameter", "-Werror",
    "-framework", "Cocoa", "-framework", "QuartzCore", "-framework", "WebKit",
    str(root / "tests/native-panel.m"), "-o", str(binary),
], env={**os.environ, "DEVELOPER_DIR": "/Library/Developer/CommandLineTools"}, check=True)
subprocess.run([str(binary)], check=True, timeout=30)
with tempfile.TemporaryDirectory(prefix="deskody-panel-") as directory:
    marker = Path(directory) / "host"
    host = subprocess.Popen([str(binary), "--host", str(marker)])
    try:
        deadline = time.monotonic() + 20
        while not marker.with_suffix(".ready").exists():
            if host.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError("Fullscreen fixture did not become ready")
            time.sleep(0.1)
        # Wait for the Space animation to finish, not just the AppKit callback.
        time.sleep(1)
        subprocess.run([str(binary), "--panel", str(host.pid)], check=True, timeout=30)
    finally:
        marker.with_suffix(".stop").touch()
        try:
            host.wait(timeout=5)
        except subprocess.TimeoutExpired:
            host.terminate()
            host.wait(timeout=5)
    if host.returncode != 0:
        raise RuntimeError(f"Fullscreen fixture failed: {host.returncode}")
print("Native panel: current Space + external fullscreen integration passed.")
