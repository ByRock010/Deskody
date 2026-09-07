//! Optional Spotify Web API adapter. OAuth tokens never cross frontend IPC.
use crate::{model::*, platform::Platform};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;

pub const REDIRECT: &str = "http://127.0.0.1:43828/callback";
static REVISION: AtomicU64 = AtomicU64::new(0);
static AUTH_LOCK: Mutex<()> = Mutex::new(());
#[derive(Serialize, Deserialize)]
struct Tokens {
    access: String,
    refresh: String,
    expires: u64,
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn network(_: reqwest::Error) -> Error {
    err("Spotify ağına bağlanılamadı veya yanıt geçersiz; bağlantınızı kontrol edin")
}
fn client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(6))
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(network)
}
fn entry(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("dev.musicoptimizer.spotify", id)
        .map_err(|e| err(format!("Güvenli kimlik deposu: {e}")))
}
fn store(id: &str, tokens: &Tokens) -> Result<()> {
    entry(id)?
        .set_password(&serde_json::to_string(tokens)?)
        .map_err(|e| err(format!("Kimlik bilgisi saklanamadı: {e}")))
}
fn check_client_id(id: &str) -> Result<()> {
    if id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(err("Spotify Client ID geçersiz"))
    }
}

fn token_response(response: Response, previous: Option<String>) -> Result<Tokens> {
    if !response.status().is_success() {
        return Err(err(format!(
            "Spotify yetkilendirmesi başarısız (HTTP {}). Yeniden bağlanın.",
            response.status().as_u16()
        )));
    }
    let result: TokenResponse = response.json().map_err(network)?;
    Ok(Tokens {
        access: result.access_token,
        refresh: result
            .refresh_token
            .or(previous)
            .ok_or_else(|| err("Spotify yenileme anahtarı dönmedi"))?,
        expires: now() + result.expires_in,
    })
}

/// Run on a dedicated blocking task, independently of the media worker.
pub fn login(id: &str) -> Result<()> {
    check_client_id(id)?;
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 43828))?;
    listener.set_nonblocking(true)?;
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let state = uuid::Uuid::new_v4().simple().to_string();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut authorize = url::Url::parse("https://accounts.spotify.com/authorize")
        .map_err(|_| err("OAuth adresi geçersiz"))?;
    authorize.query_pairs_mut().extend_pairs([
        ("client_id", id),
        ("response_type", "code"),
        ("redirect_uri", REDIRECT),
        ("code_challenge_method", "S256"),
        ("code_challenge", &challenge),
        ("state", &state),
        (
            "scope",
            "user-read-playback-state user-modify-playback-state",
        ),
    ]);
    open_browser(authorize.as_str())?;
    let deadline = Instant::now() + Duration::from_secs(120);
    let code = loop {
        if Instant::now() >= deadline {
            return Err(err("Spotify bağlantısı 2 dakika içinde tamamlanmadı"));
        }
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                stream.set_read_timeout(Some(Duration::from_secs(2)))?;
                stream.set_write_timeout(Some(Duration::from_secs(2)))?;
                let mut buffer = [0u8; 8192];
                let mut size = 0;
                while size < buffer.len() {
                    match stream.read(&mut buffer[size..]) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => size += n,
                    }
                    if buffer[..size].windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&buffer[..size]);
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.strip_prefix("GET "))
                    .and_then(|s| s.split(' ').next());
                let parsed = target.and_then(|target| {
                    url::Url::parse(&format!("http://127.0.0.1:43828{target}")).ok()
                });
                let outcome = parsed.and_then(|u| {
                    if u.path() != "/callback" {
                        return None;
                    }
                    let params: std::collections::HashMap<_, _> =
                        u.query_pairs().into_owned().collect();
                    if !bool::from(params.get("state")?.as_bytes().ct_eq(state.as_bytes())) {
                        return None;
                    }
                    if params.contains_key("error") {
                        Some(Err(err("Spotify erişimi kullanıcı tarafından reddedildi")))
                    } else {
                        params.get("code").cloned().map(Ok)
                    }
                });
                let (status, body) = if outcome.is_some() {
                    ("200 OK", "Spotify authorization received. You can close this tab and return to Deskody.")
                } else {
                    ("400 Bad Request", "Invalid authorization callback.")
                };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}", body.len());
                if let Some(outcome) = outcome {
                    break outcome?;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(e) => return Err(e.into()),
        }
    };
    let response = client()?
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", id),
            ("code", &code),
            ("redirect_uri", REDIRECT),
            ("code_verifier", &verifier),
        ])
        .send()
        .map_err(network)?;
    let tokens = token_response(response, None)?;
    let _guard = AUTH_LOCK
        .lock()
        .map_err(|_| err("Spotify kimlik kilit hatası"))?;
    store(id, &tokens)?;
    REVISION.fetch_add(1, Ordering::Relaxed);
    Ok(())
}
pub fn logout(id: &str) -> Result<()> {
    let _guard = AUTH_LOCK
        .lock()
        .map_err(|_| err("Spotify kimlik kilit hatası"))?;
    check_client_id(id)?;
    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => (),
        Err(e) => return Err(err(format!("Bağlantı silinemedi: {e}"))),
    }
    REVISION.fetch_add(1, Ordering::Relaxed);
    Ok(())
}
fn open_browser(url: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        crate::process::run("/usr/bin/open", &[url], Duration::from_secs(3))?;
    }
    #[cfg(target_os = "linux")]
    {
        crate::process::run("xdg-open", &[url], Duration::from_secs(3))?;
    }
    #[cfg(target_os = "windows")]
    {
        let uri = ::windows::Foundation::Uri::CreateUri(&::windows::core::HSTRING::from(url))
            .map_err(|_| err("Tarayıcı bağlantısı açılamadı"))?;
        if !::windows::System::Launcher::LaunchUriAsync(&uri)
            .map_err(|_| err("Tarayıcı açılamadı"))?
            .get()
            .map_err(|_| err("Tarayıcı açılamadı"))?
        {
            return Err(err("Tarayıcı açılamadı"));
        }
    }
    Ok(())
}

pub struct WithSpotify {
    pub native: Box<dyn Platform>,
    client: Option<Client>,
    tokens: Option<Tokens>,
    client_id: String,
    revision: u64,
    retry_after: Instant,
    cached: Option<(Instant, Vec<Player>)>,
}
impl WithSpotify {
    pub fn new(native: Box<dyn Platform>) -> Self {
        Self {
            native,
            client: None,
            tokens: None,
            client_id: String::new(),
            revision: 0,
            retry_after: Instant::now(),
            cached: None,
        }
    }
    fn token(&mut self) -> Result<String> {
        let _guard = AUTH_LOCK
            .lock()
            .map_err(|_| err("Spotify kimlik kilit hatası"))?;
        if self.revision != REVISION.load(Ordering::Relaxed) {
            self.tokens = None;
            self.cached = None;
            self.revision = REVISION.load(Ordering::Relaxed);
        }
        if self.client.is_none() {
            self.client = Some(client()?);
        }
        if self.tokens.is_none() {
            self.tokens = Some(serde_json::from_str(
                &entry(&self.client_id)?.get_password().map_err(|_| {
                    err("Önce Ayarlar → Spotify hesabını bağla seçeneğini kullanın")
                })?,
            )?);
        }
        let tokens = self
            .tokens
            .as_ref()
            .ok_or_else(|| err("Spotify bağlantısı yok"))?;
        if tokens.expires <= now() + 60 {
            let refresh = tokens.refresh.clone();
            let response = self
                .client
                .as_ref()
                .ok_or_else(|| err("HTTP istemcisi yok"))?
                .post("https://accounts.spotify.com/api/token")
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("refresh_token", &refresh),
                    ("client_id", &self.client_id),
                ])
                .send()
                .map_err(network)?;
            let tokens = token_response(response, Some(refresh))?;
            store(&self.client_id, &tokens)?;
            self.tokens = Some(tokens);
        }
        Ok(self
            .tokens
            .as_ref()
            .ok_or_else(|| err("Spotify bağlantısı yok"))?
            .access
            .clone())
    }
    fn request(
        &mut self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<Option<serde_json::Value>> {
        if Instant::now() < self.retry_after {
            return Err(err(
                "Spotify istek sınırı: yeniden denemeden önce bekleniyor",
            ));
        }
        let token = self.token()?;
        let mut request = self
            .client
            .as_ref()
            .ok_or_else(|| err("HTTP istemcisi yok"))?
            .request(method, format!("https://api.spotify.com/v1/{path}"))
            .bearer_auth(token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().map_err(network)?;
        let code = response.status().as_u16();
        if code == 429 {
            let delay = response
                .headers()
                .get("retry-after")
                .and_then(|h| h.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(30)
                .clamp(1, 3600);
            self.retry_after = Instant::now() + Duration::from_secs(delay);
            return Err(err(format!(
                "Spotify istek sınırı; {delay} saniye beklenecek"
            )));
        }
        if code == 401 {
            if let Some(t) = &mut self.tokens {
                t.expires = 0;
            }
            return Err(err("Spotify oturumu yenilenmeli; tekrar deneniyor"));
        }
        if code == 403 {
            return Err(err("Spotify bu işlemi reddetti. Premium üyeliğinizi ve Developer uygulama erişimini kontrol edin."));
        }
        if code == 404 {
            return Err(err(
                "Spotify cihazı aktif değil; seçili cihazda bir parça açın",
            ));
        }
        if !response.status().is_success() {
            return Err(err(format!("Spotify HTTP {code}")));
        }
        if code == 204 {
            Ok(None)
        } else {
            response.json().map(Some).map_err(network)
        }
    }
    fn web_players(&mut self, settings: &Settings) -> Result<Vec<Player>> {
        if self.client_id != settings.spotify_client_id {
            self.tokens = None;
            self.cached = None;
            self.client_id = settings.spotify_client_id.clone();
        }
        if self.revision == REVISION.load(Ordering::Relaxed) {
            if let Some((at, p)) = &self.cached {
                if at.elapsed() < Duration::from_secs(3) {
                    return Ok(p.clone());
                }
            }
        }
        let devices = self
            .request(reqwest::Method::GET, "me/player/devices", None)?
            .unwrap_or_default();
        let state = self
            .request(reqwest::Method::GET, "me/player", None)?
            .unwrap_or_default();
        let active = state["device"]["id"].as_str().unwrap_or("");
        let mut players = vec![];
        for d in devices["devices"].as_array().into_iter().flatten() {
            let Some(id) = d["id"].as_str() else {
                continue;
            };
            let current = id == active;
            let restricted = d["is_restricted"].as_bool().unwrap_or(true);
            players.push(Player {
                id: format!("spotify:web:{id}"),
                name: format!("Spotify · {}", d["name"].as_str().unwrap_or("Cihaz")),
                playing: Some(current && state["is_playing"].as_bool().unwrap_or(false)),
                volume: if d["supports_volume"].as_bool() == Some(false) {
                    None
                } else {
                    d["volume_percent"].as_f64().map(|v| v / 100.0)
                },
                track: if current {
                    state["item"]["name"].as_str().unwrap_or("").into()
                } else {
                    String::new()
                },
                artist: if current {
                    state["item"]["artists"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|a| a["name"].as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                } else {
                    String::new()
                },
                can_play: !restricted,
                can_pause: !restricted,
                can_open_uri: !restricted,
            });
        }
        self.cached = Some((Instant::now(), players.clone()));
        Ok(players)
    }
    fn device(player: &str) -> Result<&str> {
        player
            .strip_prefix("spotify:web:")
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 128
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            })
            .ok_or_else(|| err("Spotify cihaz kimliği geçersiz"))
    }
}
impl Platform for WithSpotify {
    fn context(&mut self, settings: &Settings) -> Result<Context> {
        self.native.context(settings)
    }
    fn permissions(&self) -> Permissions {
        self.native.permissions()
    }
    fn request_permission(&self, kind: &str) -> Result<()> {
        self.native.request_permission(kind)
    }
    fn players(&mut self, settings: &Settings) -> Result<Vec<Player>> {
        if settings.provider != Provider::Spotify || !settings.spotify_web {
            return self.native.players(settings);
        }
        let mut players = self.web_players(settings)?;
        players.extend(
            self.native
                .players(settings)
                .unwrap_or_default()
                .into_iter()
                .filter(|p| !p.id.to_lowercase().contains("spotify")),
        );
        Ok(players)
    }
    fn play(&mut self, player: &str, uri: Option<&str>) -> Result<()> {
        if !player.starts_with("spotify:web:") {
            return self.native.play(player, uri);
        }
        let id = Self::device(player)?;
        let body = uri
            .map(crate::config::spotify_uri)
            .transpose()?
            .map(|uri| serde_json::json!({"context_uri":uri}));
        self.request(
            reqwest::Method::PUT,
            &format!("me/player/play?device_id={id}"),
            body,
        )?;
        self.cached = None;
        Ok(())
    }
    fn pause(&mut self, player: &str) -> Result<()> {
        if !player.starts_with("spotify:web:") {
            return self.native.pause(player);
        }
        self.request(
            reqwest::Method::PUT,
            &format!("me/player/pause?device_id={}", Self::device(player)?),
            None,
        )?;
        self.cached = None;
        Ok(())
    }
    fn volume(&mut self, player: &str, value: f64) -> Result<()> {
        if !player.starts_with("spotify:web:") {
            return self.native.volume(player, value);
        }
        self.request(
            reqwest::Method::PUT,
            &format!(
                "me/player/volume?device_id={}&volume_percent={}",
                Self::device(player)?,
                (value.clamp(0.0, 1.0) * 100.0).round() as u8
            ),
            None,
        )?;
        self.cached = None;
        Ok(())
    }
    fn media_key(&mut self) -> Result<()> {
        self.native.media_key()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_matches_rfc7636_vector() {
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(
                b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
            )),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn rejects_query_injection_in_device_id() {
        assert!(WithSpotify::device("spotify:web:abc&device_id=evil").is_err());
        assert_eq!(WithSpotify::device("spotify:web:abc123").unwrap(), "abc123");
    }
}
