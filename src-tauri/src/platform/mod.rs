use crate::model::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// Adapters live exclusively on the automation worker; native handles never cross IPC.
pub trait Platform: Send {
    fn context(&mut self, settings: &Settings) -> Result<Context>;
    fn permissions(&self) -> Permissions;
    fn request_permission(&self, kind: &str) -> Result<()>;
    fn players(&mut self, settings: &Settings) -> Result<Vec<Player>>;
    fn play(&mut self, player: &str, uri: Option<&str>) -> Result<()>;
    fn pause(&mut self, player: &str) -> Result<()>;
    fn volume(&mut self, player: &str, value: f64) -> Result<()>;
    /// A remote player can own one local fade/transition transaction.
    fn transition(
        &mut self,
        _player: &Player,
        _uri: Option<&str>,
        _pause: bool,
        _fade_ms: u64,
    ) -> Option<Result<()>> {
        None
    }
    /// Explicit user action only: a global toggle has no reliable target/state.
    fn media_key(&mut self) -> Result<()>;
}

pub fn create() -> Box<dyn Platform> {
    #[cfg(target_os = "macos")]
    {
        Box::new(macos::MacOs::default())
    }
    #[cfg(target_os = "windows")]
    {
        Box::new(windows::Windows::default())
    }
    #[cfg(target_os = "linux")]
    {
        Box::new(linux::Linux::default())
    }
}

pub fn browser_app(id: &str, name: &str) -> bool {
    let s = format!("{id} {name}").to_lowercase();
    [
        "chrome",
        "chromium",
        "safari",
        "firefox",
        "msedge",
        "microsoft edge",
        "brave",
        "arc",
        "vivaldi",
        "opera",
    ]
    .iter()
    .any(|b| s.contains(b))
}

pub fn selected<'a>(players: &'a [Player], settings: &Settings) -> Option<&'a Player> {
    if settings.provider == Provider::Spotify && settings.spotify_web {
        return players
            .iter()
            .find(|p| p.id == settings.target_player && p.id.starts_with("spotify:web:"));
    }
    if settings.provider == Provider::Spotify {
        players
            .iter()
            .find(|p| p.id.to_lowercase().contains("spotify"))
    } else if !settings.target_player.is_empty() {
        players.iter().find(|p| p.id == settings.target_player)
    } else {
        None
    }
}
