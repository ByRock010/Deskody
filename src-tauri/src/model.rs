use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
pub type Result<T> = std::result::Result<T, Error>;
pub fn err(message: impl Into<String>) -> Error {
    Error::Message(message.into())
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub app: String,
    pub app_id: String,
    pub title: String,
    pub url: Option<String>,
    pub document: Option<String>,
    pub is_browser: bool,
    /// None means the platform cannot determine other audio, never "silent".
    pub other_audio: Option<bool>,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    Spotify,
    System,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstalledApplication {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Matcher {
    App(String),
    Apps(Vec<InstalledApplication>),
    Domain(String),
    Title(String),
    FileExtension(String),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    Pause,
    Play { playlist: Option<String> },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub priority: i32,
    pub matcher: Matcher,
    pub action: Action,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Tr,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    #[serde(default)]
    pub language: Language,
    pub version: u32,
    pub enabled: bool,
    pub provider: Provider,
    #[serde(default)]
    pub spotify_web: bool,
    #[serde(default)]
    pub spotify_client_id: String,
    /// Exact GSMTC source ID / MPRIS bus name. Never control an arbitrary session.
    pub target_player: String,
    pub poll_ms: u64,
    pub settle_ms: u64,
    pub fade_ms: u64,
    pub pause_on_other_audio: bool,
    pub browser_bridge: bool,
    pub rules: Vec<Rule>,
}

impl Settings {
    /// The explicit system-session picker can also select Spotify.
    pub fn targets_spotify(&self) -> bool {
        self.provider == Provider::Spotify || is_spotify_id(&self.target_player)
    }
}

pub fn is_spotify_id(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    matches!(
        id.as_str(),
        "com.spotify.client" | "spotify" | "spotify.exe"
    ) || id.starts_with("spotify:web:")
        || id.starts_with("spotifyab.spotifymusic_")
        || id == "org.mpris.mediaplayer2.spotify"
        || id.starts_with("org.mpris.mediaplayer2.spotify.")
}

impl Default for Settings {
    fn default() -> Self {
        let mut rules = Vec::new();
        for (name, app) in [
            ("Coding · VS Code", "Visual Studio Code"),
            ("Coding · Terminal", "Terminal"),
            ("Coding · Xcode", "Xcode"),
            ("Coding · Windows Terminal", "WindowsTerminal"),
            ("Coding · Linux", "code"),
        ] {
            rules.push(Rule {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.into(),
                enabled: true,
                priority: 50,
                matcher: Matcher::App(app.into()),
                action: Action::Play { playlist: None },
            });
        }
        rules.push(Rule {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Study".into(),
            enabled: true,
            priority: 60,
            matcher: Matcher::FileExtension("pdf".into()),
            action: Action::Play { playlist: None },
        });
        Self {
            version: 1,
            language: Language::En,
            enabled: false,
            provider: Provider::Spotify,
            spotify_web: false,
            spotify_client_id: String::new(),
            target_player: String::new(),
            poll_ms: 1500,
            settle_ms: 2000,
            fade_ms: 600,
            pause_on_other_audio: true,
            browser_bridge: false,
            rules,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Capability {
    pub name: String,
    pub available: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub accessibility: bool,
    pub automation: String,
    pub platform: String,
    pub capabilities: Vec<Capability>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Player {
    pub id: String,
    pub name: String,
    pub playing: Option<bool>,
    pub volume: Option<f64>,
    pub track: String,
    pub artist: String,
    pub can_play: bool,
    pub can_pause: bool,
    pub can_open_uri: bool,
    pub track_id: String,
    pub artwork: Option<String>,
    pub duration: Option<f64>,
    pub position: Option<f64>,
    pub sampled_at: Option<f64>,
    pub can_seek: bool,
    pub can_next: bool,
    pub can_previous: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackActivity {
    pub app: String,
    pub reason: String,
    pub rule_name: bool,
    pub player: String,
    pub action: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub time: u64,
    pub message: String,
    pub level: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playback: Option<PlaybackActivity>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub context: Context,
    pub last_context: Option<Context>,
    pub player: Option<Player>,
    pub decision: String,
    pub active_rule: Option<String>,
    pub error: Option<String>,
    pub manual_override: bool,
    pub bridge_connected: bool,
    pub activity: Vec<Activity>,
}

/// Seconds at every IPC/adapter boundary (native ticks are converted in adapters).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TransportAction {
    Next,
    Previous,
    Seek {
        position: f64,
        #[serde(rename = "trackId")]
        track_id: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransportRequest {
    pub player_id: String,
    pub action: TransportAction,
}
pub fn timestamp() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
impl Player {
    pub fn normalize_timeline(&mut self) {
        self.duration = self
            .duration
            .filter(|v| v.is_finite() && *v > 0.0 && *v <= 604800.0);
        self.position = self
            .position
            .filter(|v| v.is_finite() && *v >= 0.0)
            .map(|v| v.min(self.duration.unwrap_or(v)));
        self.sampled_at = self
            .sampled_at
            .filter(|v| v.is_finite() && *v > 0.0 && *v <= timestamp() + 5.0)
            .or(Some(timestamp()));
        self.can_seek &=
            self.duration.is_some() && self.position.is_some() && !self.track_id.is_empty();
    }
}
impl TransportRequest {
    pub fn validate(&self, player: &Player) -> Result<()> {
        if self.player_id != player.id {
            return Err(err("Seçili oynatıcı değişti; tekrar deneyin"));
        }
        match &self.action {
            TransportAction::Next if player.can_next => Ok(()),
            TransportAction::Previous if player.can_previous => Ok(()),
            TransportAction::Seek { position, track_id } => {
                if !position.is_finite() || *position < 0.0 {
                    return Err(err("Geçersiz oynatma konumu"));
                }
                if track_id.is_empty() || *track_id != player.track_id {
                    return Err(err("Parça değişti; tekrar deneyin"));
                }
                if !player.can_seek
                    || !player
                        .duration
                        .is_some_and(|d| d.is_finite() && *position < d)
                {
                    return Err(err("Bu parçada konum değiştirme desteklenmiyor"));
                }
                Ok(())
            }
            _ => Err(err("Oynatıcı bu medya kontrolünü desteklemiyor")),
        }
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    #[test]
    fn rejects_stale_and_unsupported_transport_commands() {
        let mut player = Player {
            id: "spotify".into(),
            track_id: "track-a".into(),
            duration: Some(180.0),
            position: Some(30.0),
            can_seek: true,
            can_next: true,
            ..Player::default()
        };
        player.normalize_timeline();
        let request = |position, track: &str| TransportRequest {
            player_id: "spotify".into(),
            action: TransportAction::Seek {
                position,
                track_id: track.into(),
            },
        };
        assert!(request(60.0, "track-a").validate(&player).is_ok());
        for value in [f64::NAN, f64::INFINITY, -1.0, 180.0, 181.0] {
            assert!(request(value, "track-a").validate(&player).is_err());
        }
        assert!(request(60.0, "track-b").validate(&player).is_err());
        assert!(TransportRequest {
            player_id: "other".into(),
            action: TransportAction::Next
        }
        .validate(&player)
        .is_err());
        assert!(TransportRequest {
            player_id: "spotify".into(),
            action: TransportAction::Previous
        }
        .validate(&player)
        .is_err());
        player.duration = None;
        player.normalize_timeline();
        assert!(!player.can_seek);
    }
    #[test]
    fn legacy_players_do_not_advertise_new_controls() {
        let p: Player = serde_json::from_str(r#"{"id":"legacy","name":"Player"}"#).unwrap();
        assert!(!p.can_seek && !p.can_next && !p.can_previous);
        assert!(p.duration.is_none());
    }
}
