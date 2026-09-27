//! Bounded, memory-only artwork loading. Never fetch an arbitrary page-supplied URL.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    collections::VecDeque,
    io::Read,
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

pub const MAX_BYTES: usize = 1024 * 1024;
pub fn allowed_url(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else {
        return false;
    };
    raw.len() <= 2048
        && url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|h| {
            [
                "i.scdn.co",
                "image-cdn-ak.spotifycdn.com",
                "image-cdn-fa.spotifycdn.com",
            ]
            .contains(&h)
                || ["ytimg.com", "googleusercontent.com", "mzstatic.com"]
                    .iter()
                    .any(|base| h == *base || h.ends_with(&format!(".{base}")))
        })
}
pub fn data_uri(bytes: &[u8]) -> Option<String> {
    if bytes.len() > MAX_BYTES {
        return None;
    }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}
type Entries = VecDeque<(String, Instant, Option<String>)>;
pub struct ArtworkCache {
    requests: mpsc::SyncSender<String>,
    entries: Arc<Mutex<Entries>>,
}
impl Default for ArtworkCache {
    fn default() -> Self {
        Self::new()
    }
}
impl ArtworkCache {
    pub fn new() -> Self {
        let (requests, receiver) = mpsc::sync_channel::<String>(1);
        let entries = Arc::new(Mutex::new(Entries::new()));
        let output = entries.clone();
        std::thread::spawn(move || {
            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(4))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .ok();
            while let Ok(url) = receiver.recv() {
                let image = (|| {
                    let response = client
                        .as_ref()?
                        .get(&url)
                        .send()
                        .ok()?
                        .error_for_status()
                        .ok()?;
                    if response
                        .content_length()
                        .is_some_and(|n| n > MAX_BYTES as u64)
                    {
                        return None;
                    }
                    let mut bytes = Vec::new();
                    response
                        .take((MAX_BYTES + 1) as u64)
                        .read_to_end(&mut bytes)
                        .ok()?;
                    data_uri(&bytes)
                })();
                if let Ok(mut cache) = output.lock() {
                    if let Some(entry) = cache.iter_mut().find(|e| e.0 == url) {
                        entry.2 = image;
                    }
                }
            }
        });
        Self { requests, entries }
    }
    pub fn resolve(&self, source: Option<&str>) -> Option<String> {
        let source = source?;
        if source.starts_with("data:image/") {
            if source.len() > MAX_BYTES * 2 {
                return None;
            }
            let (_, data) = source.split_once(";base64,")?;
            return data_uri(&STANDARD.decode(data).ok()?);
        }
        if !allowed_url(source) {
            return None;
        }
        let mut entries = self.entries.lock().ok()?;
        entries.retain(|(_, at, _)| at.elapsed() < Duration::from_secs(300));
        if let Some(entry) = entries.iter().find(|e| e.0 == source) {
            return entry.2.clone();
        }
        if self.requests.try_send(source.into()).is_ok() {
            if entries.len() >= 8 {
                entries.pop_front();
            }
            entries.push_back((source.into(), Instant::now(), None));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn artwork_cannot_fetch_local_or_arbitrary_resources() {
        for url in [
            "file:///etc/passwd",
            "http://127.0.0.1/x",
            "https://i.scdn.co.evil.test/x",
            "https://evil.test/x",
            "https://user@i.scdn.co/x",
            "https://i.scdn.co:444/x",
        ] {
            assert!(!allowed_url(url), "{url}");
        }
        assert!(allowed_url("https://i.scdn.co/image/abc"));
        assert!(allowed_url("https://lh3.googleusercontent.com/example"));
        assert!(data_uri(b"<svg onload='evil()'/>").is_none());
        assert!(data_uri(&vec![0; MAX_BYTES + 1]).is_none());
    }
}
