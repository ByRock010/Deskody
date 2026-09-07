use crate::model::*;
use std::{
    io::Read,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

/// No shell, bounded time/output, always reap child processes (including timeout).
pub fn run(program: &str, args: &[&str], timeout: Duration) -> Result<String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| err("stdout açılamadı"))?;
    let stderr = child.stderr.take().ok_or_else(|| err("stderr açılamadı"))?;
    let out = thread::spawn(move || {
        let mut s = String::new();
        stdout.take(65536).read_to_string(&mut s).map(|_| s)
    });
    let errors = thread::spawn(move || {
        let mut s = String::new();
        stderr.take(8192).read_to_string(&mut s).map(|_| s)
    });
    let deadline = Instant::now() + timeout;
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(15)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(err(format!("{program}: işlem zaman aşımına uğradı")));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(e.into());
            }
        }
    };
    let output = out.join().map_err(|_| err("stdout okuma hatası"))??;
    let errors = errors.join().map_err(|_| err("stderr okuma hatası"))??;
    let status = result?;
    if !status.success() {
        return Err(err(format!("{program}: {}", errors.trim())));
    }
    Ok(output.trim().to_owned())
}
