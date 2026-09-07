use crate::model::*;
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;

pub const PORT: u16 = 43827;
const TTL: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserContext {
    pub url: Option<String>,
    pub title: String,
    pub focused: bool,
    pub audible: bool,
    pub music_playing: Option<bool>,
    #[serde(default)]
    pub music_present: bool,
    #[serde(default)]
    pub music_can_open: bool,
    #[serde(default)]
    pub music_transition: bool,
    pub music_volume: Option<f64>,
    pub music_title: String,
    pub acknowledged: Option<String>,
    pub command_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCommand {
    pub id: String,
    pub action: String,
    pub volume: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fade_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pause: Option<bool>,
}

#[derive(Default)]
pub struct Bridge {
    pub enabled: bool,
    pub error: Option<String>,
    token: String,
    sample: Option<(Instant, BrowserContext)>,
    command: Option<(Instant, BrowserCommand)>,
}
pub type SharedBridge = Arc<Mutex<Bridge>>;

impl Bridge {
    pub fn load(directory: &Path, enabled: bool) -> Result<Self> {
        let path = directory.join("browser-token");
        let token = match std::fs::read_to_string(&path) {
            Ok(token) if token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()) => token,
            Ok(_) => return Err(err("Tarayıcı eşleştirme anahtarı bozuk")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let token = format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                );
                crate::config::atomic_write(&path, token.as_bytes())?;
                token
            }
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            enabled,
            token,
            ..Self::default()
        })
    }
    pub fn token(&self) -> String {
        self.token.clone()
    }
    pub fn sample(&self) -> Option<BrowserContext> {
        if !self.enabled {
            return None;
        }
        self.sample
            .as_ref()
            .filter(|(at, _)| at.elapsed() < TTL)
            .map(|(_, c)| c.clone())
    }
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.sample = None;
            self.command = None;
        }
    }
    fn accept(&mut self, context: BrowserContext) -> Option<BrowserCommand> {
        self.sample = Some((Instant::now(), context));
        self.command
            .as_ref()
            .filter(|(at, command)| {
                at.elapsed()
                    < if command.url.is_some() || command.action == "transition" {
                        Duration::from_secs(18)
                    } else {
                        Duration::from_secs(4)
                    }
            })
            .map(|(_, c)| c.clone())
    }
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let origin = headers
        .get("origin")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !(origin.is_empty()
        || origin.starts_with("chrome-extension://")
        || origin.starts_with("moz-extension://"))
    {
        return false;
    }
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if host != format!("127.0.0.1:{PORT}") {
        return false;
    }
    let supplied = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or("");
    supplied.as_bytes().ct_eq(token.as_bytes()).into()
}

async fn context(
    State(bridge): State<SharedBridge>,
    headers: HeaderMap,
    Json(mut context): Json<BrowserContext>,
) -> impl IntoResponse {
    let Ok(mut bridge) = bridge.lock() else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(None));
    };
    if !bridge.enabled || !authorized(&headers, &bridge.token) {
        return (StatusCode::UNAUTHORIZED, Json(None));
    }
    if context.title.len() > 2048
        || context.music_title.len() > 2048
        || context
            .command_error
            .as_ref()
            .is_some_and(|s| s.len() > 1000)
        || context.acknowledged.as_ref().is_some_and(|s| s.len() > 80)
        || context
            .music_volume
            .is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
    {
        return (StatusCode::BAD_REQUEST, Json(None));
    }
    if let Some(raw) = &context.url {
        if raw.len() > 8192 {
            return (StatusCode::BAD_REQUEST, Json(None));
        }
        let Ok(mut parsed) = url::Url::parse(raw) else {
            return (StatusCode::BAD_REQUEST, Json(None));
        };
        if !matches!(parsed.scheme(), "http" | "https" | "file") {
            return (StatusCode::BAD_REQUEST, Json(None));
        }
        // Queries, fragments and credentials are unnecessary for matching and never retained.
        parsed.set_query(None);
        parsed.set_fragment(None);
        let _ = parsed.set_username("");
        let _ = parsed.set_password(None);
        context.url = Some(parsed.to_string());
    }
    (StatusCode::OK, Json(bridge.accept(context)))
}

pub async fn serve(bridge: SharedBridge) {
    let listener = match tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, PORT)).await
    {
        Ok(l) => l,
        Err(e) => {
            if let Ok(mut b) = bridge.lock() {
                b.error = Some(format!("Tarayıcı köprüsü başlatılamadı: {e}"));
            }
            return;
        }
    };
    let app = Router::new()
        .route("/context", post(context))
        .layer(DefaultBodyLimit::max(16384))
        .with_state(bridge.clone());
    if let Err(e) = axum::serve(listener, app).await {
        if let Ok(mut b) = bridge.lock() {
            b.error = Some(e.to_string());
        }
    }
}

pub fn command(
    bridge: &SharedBridge,
    action: &str,
    volume: Option<f64>,
    url: Option<&str>,
    cancel: &AtomicU64,
) -> Result<()> {
    let command = BrowserCommand {
        id: uuid::Uuid::new_v4().to_string(),
        action: action.into(),
        volume,
        url: url.map(crate::config::youtube_music_uri).transpose()?,
        fade_ms: None,
        pause: None,
    };
    send_command(bridge, command, cancel)
}

fn send_command(bridge: &SharedBridge, command: BrowserCommand, cancel: &AtomicU64) -> Result<()> {
    let generation = cancel.load(Ordering::Relaxed);
    let id = command.id.clone();
    let long = command.url.is_some() || command.action == "transition";
    {
        let mut b = bridge
            .lock()
            .map_err(|_| err("Tarayıcı köprüsü kilit hatası"))?;
        if !b.sample().is_some_and(|s| {
            if command.url.is_some() {
                s.music_present && s.music_can_open
            } else {
                s.music_playing.is_some()
            }
        }) {
            return Err(err(
                "YouTube Music sekmesi ve tarayıcı eklentisi açık olmalı",
            ));
        }
        b.command = Some((Instant::now(), command));
    }
    let deadline = Instant::now() + Duration::from_secs(if long { 16 } else { 3 });
    loop {
        {
            let mut b = bridge
                .lock()
                .map_err(|_| err("Tarayıcı köprüsü kilit hatası"))?;
            if let Some(sample) = b.sample() {
                if sample.acknowledged.as_deref() == Some(&id) {
                    b.command = None;
                    return sample.command_error.map_or(Ok(()), |e| Err(err(e)));
                }
            }
            if !b.enabled
                || cancel.load(Ordering::Relaxed) != generation
                || Instant::now() >= deadline
            {
                b.command = None;
                return Err(err("Tarayıcı medya komutu zaman aşımına uğradı"));
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Native adapter extended with a specifically paired YouTube Music tab.
pub struct WithBrowser {
    pub native: Box<dyn crate::platform::Platform>,
    pub bridge: SharedBridge,
    pub cancel: Arc<AtomicU64>,
}
impl crate::platform::Platform for WithBrowser {
    fn context(&mut self, settings: &Settings) -> Result<Context> {
        let native = self.native.context(settings);
        let sample = self.bridge.lock().ok().and_then(|b| b.sample());
        let mut c = match native {
            Ok(c) => c,
            Err(e) => {
                if sample.as_ref().is_some_and(|s| s.focused) {
                    Context {
                        app: "Browser".into(),
                        is_browser: true,
                        source: "Tarayıcı eklentisi".into(),
                        ..Context::default()
                    }
                } else {
                    return Err(e);
                }
            }
        };
        if let Some(s) = sample {
            if s.focused && c.is_browser {
                c.url = s.url;
                c.title = s.title;
                c.source = format!("{} + eklenti", c.source);
            }
            if settings.target_player == "browser:music.youtube.com"
                && settings.provider == Provider::System
            {
                // Native audio cannot distinguish tabs within the same browser process.
                c.other_audio = Some(s.audible);
            } else if s.audible || s.music_playing == Some(true) {
                c.other_audio = Some(true);
            }
        } else if settings.target_player == "browser:music.youtube.com"
            && settings.provider == Provider::System
        {
            c.other_audio = None;
        }
        Ok(c)
    }
    fn permissions(&self) -> Permissions {
        self.native.permissions()
    }
    fn request_permission(&self, kind: &str) -> Result<()> {
        self.native.request_permission(kind)
    }
    fn players(&mut self, settings: &Settings) -> Result<Vec<Player>> {
        let native = self.native.players(settings);
        let sample = self.bridge.lock().ok().and_then(|b| b.sample());
        let mut players = if settings.provider == Provider::System
            && settings.target_player == "browser:music.youtube.com"
        {
            native
                .unwrap_or_default()
                .into_iter()
                .filter(|p| !crate::platform::browser_app(&p.id, &p.name))
                .collect()
        } else {
            native?
        };
        if let Some(s) = sample {
            if s.music_playing.is_some() || s.music_present {
                players.push(Player {
                    id: "browser:music.youtube.com".into(),
                    name: "YouTube Music · eklenti".into(),
                    playing: s.music_playing,
                    volume: s.music_volume,
                    track: s.music_title,
                    can_play: true,
                    can_pause: true,
                    can_open_uri: s.music_can_open,
                    ..Player::default()
                });
            }
        }
        Ok(players)
    }
    fn play(&mut self, player: &str, uri: Option<&str>) -> Result<()> {
        if player == "browser:music.youtube.com" {
            command(
                &self.bridge,
                if uri.is_some() { "open" } else { "play" },
                None,
                uri,
                &self.cancel,
            )
        } else {
            self.native.play(player, uri)
        }
    }
    fn pause(&mut self, player: &str) -> Result<()> {
        if player == "browser:music.youtube.com" {
            command(&self.bridge, "pause", None, None, &self.cancel)
        } else {
            self.native.pause(player)
        }
    }
    fn volume(&mut self, player: &str, value: f64) -> Result<()> {
        if player == "browser:music.youtube.com" {
            command(&self.bridge, "volume", Some(value), None, &self.cancel)
        } else {
            self.native.volume(player, value)
        }
    }
    fn transition(
        &mut self,
        player: &Player,
        uri: Option<&str>,
        pause: bool,
        fade_ms: u64,
    ) -> Option<Result<()>> {
        if player.id != "browser:music.youtube.com" {
            return None;
        }
        Some((|| {
            if !self
                .bridge
                .lock()
                .ok()
                .and_then(|b| b.sample())
                .is_some_and(|s| s.music_transition)
            {
                return Err(err("YouTube Music için güncel Deskody Bridge eklentisini yükleyip sayfayı yenileyin"));
            }
            send_command(
                &self.bridge,
                BrowserCommand {
                    id: uuid::Uuid::new_v4().to_string(),
                    action: "transition".into(),
                    volume: player.volume,
                    url: uri.map(crate::config::youtube_music_uri).transpose()?,
                    fade_ms: Some(fade_ms),
                    pause: Some(pause),
                },
                &self.cancel,
            )
        })())
    }
    fn media_key(&mut self) -> Result<()> {
        self.native.media_key()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transition_payload_has_one_atomic_operation_and_optional_legacy_capability() {
        let payload = serde_json::to_value(BrowserCommand {
            id: "transaction".into(),
            action: "transition".into(),
            volume: Some(0.7),
            url: Some("https://music.youtube.com/watch?v=LkoXilp7FPY".into()),
            fade_ms: Some(600),
            pause: Some(false),
        })
        .unwrap();
        assert_eq!(payload["fadeMs"], 600);
        assert_eq!(payload["pause"], false);
        assert_eq!(payload["volume"], 0.7);
        let mut old = serde_json::to_value(BrowserContext::default()).unwrap();
        old.as_object_mut().unwrap().remove("musicTransition");
        assert!(
            !serde_json::from_value::<BrowserContext>(old)
                .unwrap()
                .music_transition
        );
    }
    #[test]
    fn open_command_carries_the_validated_target_and_waits_for_ack() {
        let bridge = Arc::new(Mutex::new(Bridge {
            enabled: true,
            ..Bridge::default()
        }));
        bridge.lock().unwrap().accept(BrowserContext {
            music_present: true,
            music_can_open: true,
            ..BrowserContext::default()
        });
        let worker_bridge = bridge.clone();
        let handle = std::thread::spawn(move || {
            command(
                &worker_bridge,
                "open",
                None,
                Some("https://music.youtube.com/watch?v=LkoXilp7FPY&list=PLexample&si=tracking"),
                &AtomicU64::new(0),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        let sent = loop {
            if let Some((_, command)) = &bridge.lock().unwrap().command {
                break command.clone();
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        };
        assert_eq!(
            sent.url.as_deref(),
            Some("https://music.youtube.com/watch?v=LkoXilp7FPY&list=PLexample")
        );
        bridge.lock().unwrap().accept(BrowserContext {
            acknowledged: Some(sent.id),
            music_playing: Some(true),
            ..BrowserContext::default()
        });
        handle.join().unwrap().unwrap();
        assert!(bridge.lock().unwrap().command.is_none());
    }
    #[test]
    fn pending_navigation_is_cancelled_by_new_user_commands() {
        let bridge = Arc::new(Mutex::new(Bridge {
            enabled: true,
            ..Bridge::default()
        }));
        bridge.lock().unwrap().accept(BrowserContext {
            music_present: true,
            music_can_open: true,
            ..BrowserContext::default()
        });
        let worker_bridge = bridge.clone();
        let cancel = Arc::new(AtomicU64::new(0));
        let worker_cancel = cancel.clone();
        let handle = std::thread::spawn(move || {
            command(
                &worker_bridge,
                "open",
                None,
                Some("https://music.youtube.com/watch?v=LkoXilp7FPY"),
                &worker_cancel,
            )
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while bridge.lock().unwrap().command.is_none() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        cancel.fetch_add(1, Ordering::Relaxed);
        assert!(handle.join().unwrap().is_err());
        assert!(bridge.lock().unwrap().command.is_none());
    }
    #[tokio::test]
    async fn authenticated_context_strips_url_secrets() {
        let bridge = Arc::new(Mutex::new(Bridge {
            enabled: true,
            token: "secret".into(),
            ..Bridge::default()
        }));
        let mut headers = HeaderMap::new();
        headers.insert("host", "127.0.0.1:43827".parse().unwrap());
        headers.insert("authorization", "Bearer secret".parse().unwrap());
        let sample = BrowserContext {
            url: Some("https://user:pass@example.com/notes.pdf?private=yes#page=2".into()),
            ..BrowserContext::default()
        };
        let response = context(State(bridge.clone()), headers, Json(sample))
            .await
            .into_response();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            bridge.lock().unwrap().sample().unwrap().url.as_deref(),
            Some("https://example.com/notes.pdf")
        );
    }
    #[tokio::test]
    async fn disabled_bridge_does_not_accept_context_even_with_valid_token() {
        let bridge = Arc::new(Mutex::new(Bridge {
            enabled: false,
            token: "secret".into(),
            ..Bridge::default()
        }));
        let mut headers = HeaderMap::new();
        headers.insert("host", "127.0.0.1:43827".parse().unwrap());
        headers.insert("authorization", "Bearer secret".parse().unwrap());
        let response = context(
            State(bridge.clone()),
            headers,
            Json(BrowserContext::default()),
        )
        .await
        .into_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(bridge.lock().unwrap().sample.is_none());
    }
    #[test]
    fn rejects_web_origins_and_wrong_secret() {
        let mut h = HeaderMap::new();
        h.insert("host", "127.0.0.1:43827".parse().unwrap());
        h.insert("authorization", "Bearer secret".parse().unwrap());
        h.insert("origin", "https://evil.test".parse().unwrap());
        assert!(!authorized(&h, "secret"));
        h.insert("origin", "chrome-extension://abc".parse().unwrap());
        assert!(authorized(&h, "secret"));
        assert!(!authorized(&h, "other"));
        h.insert("host", "evil.test:43827".parse().unwrap());
        assert!(!authorized(&h, "secret"));
    }
    #[test]
    fn stale_browser_data_is_discarded() {
        let b = Bridge {
            enabled: true,
            sample: Some((
                Instant::now() - Duration::from_secs(10),
                BrowserContext::default(),
            )),
            ..Bridge::default()
        };
        assert!(b.sample().is_none());
    }
}
