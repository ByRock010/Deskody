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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
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
            ("Kodlama · VS Code", "Visual Studio Code"),
            ("Kodlama · Terminal", "Terminal"),
            ("Kodlama · Xcode", "Xcode"),
            ("Kodlama · Windows Terminal", "WindowsTerminal"),
            ("Kodlama · Linux", "code"),
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
            name: "Ders çalışma".into(),
            enabled: true,
            priority: 60,
            matcher: Matcher::FileExtension("pdf".into()),
            action: Action::Play { playlist: None },
        });
        Self {
            version: 1,
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
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub time: u64,
    pub message: String,
    pub level: String,
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
