use crate::model::*;
use std::{
    collections::HashSet,
    io::Write,
    path::{Path, PathBuf},
};

fn valid_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
pub fn valid_app(app: &InstalledApplication) -> bool {
    valid_text(&app.id, 300)
        && valid_text(&app.name, 120)
        && app.aliases.len() <= 4
        && app.aliases.iter().all(|v| valid_text(v, 300))
}

pub fn validate(settings: &Settings) -> Result<()> {
    if !settings.spotify_client_id.is_empty()
        && (settings.spotify_client_id.len() != 32
            || !settings
                .spotify_client_id
                .bytes()
                .all(|b| b.is_ascii_hexdigit()))
    {
        return Err(err("Spotify Client ID 32 onaltılık karakter olmalı"));
    }
    if settings.spotify_web && settings.spotify_client_id.is_empty() {
        return Err(err("Spotify Web API için Client ID girin"));
    }
    if settings.version != 1 {
        return Err(err("Desteklenmeyen ayar sürümü"));
    }
    if !(750..=10000).contains(&settings.poll_ms)
        || !(500..=15000).contains(&settings.settle_ms)
        || settings.fade_ms > 3000
    {
        return Err(err("Algılama, bekleme veya geçiş süresi sınır dışında"));
    }
    if settings.rules.len() > 100
        || settings.target_player.len() > 256
        || settings.target_player.chars().any(char::is_control)
    {
        return Err(err("Kural sayısı veya oynatıcı kimliği geçersiz"));
    }
    let mut ids = HashSet::new();
    for rule in &settings.rules {
        if rule.id.is_empty() || rule.id.len() > 80 || !ids.insert(&rule.id) {
            return Err(err("Kural kimlikleri benzersiz olmalı"));
        }
        if rule.name.trim().is_empty()
            || rule.name.len() > 120
            || !(0..=999).contains(&rule.priority)
        {
            return Err(err("Kural adı veya önceliği geçersiz"));
        }
        match &rule.matcher {
            Matcher::Apps(apps) => {
                if apps.is_empty() || apps.len() > 64 {
                    return Err(err("Bir kural için 1–64 uygulama seçin"));
                }
                let mut apps_seen = HashSet::new();
                for app in apps {
                    if !valid_app(app) || !apps_seen.insert(app.id.to_lowercase()) {
                        return Err(err("Uygulama seçimi geçersiz veya yineleniyor"));
                    }
                }
            }
            Matcher::App(value)
            | Matcher::Domain(value)
            | Matcher::Title(value)
            | Matcher::FileExtension(value) => {
                if !valid_text(value, 300) {
                    return Err(err("Eşleştirme değeri geçersiz"));
                }
            }
        }
        if let Matcher::Domain(domain) = &rule.matcher {
            let parsed = url::Url::parse(&format!("https://{domain}"))
                .map_err(|_| err("Alan adı geçersiz"))?;
            if parsed.host_str() != Some(domain.as_str())
                || parsed.path() != "/"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
                || parsed.port().is_some()
                || !parsed.username().is_empty()
            {
                return Err(err(
                    "Yalnızca küçük harfli alan adı girin; URL veya yol kullanmayın",
                ));
            }
        }
        if let Action::Play {
            playlist: Some(uri),
        } = &rule.action
        {
            media_uri(uri)?;
        }
    }
    Ok(())
}

/// Playback URLs are intentionally separate from the redacted sensing URL.
pub fn youtube_music_uri(input: &str) -> Result<String> {
    if input.len() > 2048 || input.chars().any(|c| c.is_control() || c == '\\') {
        return Err(err("Geçerli bir YouTube Music bağlantısı girin"));
    }
    let source = url::Url::parse(input.trim()).map_err(|_| err("Geçersiz müzik bağlantısı"))?;
    if source.scheme() != "https"
        || source.host_str() != Some("music.youtube.com")
        || !source.username().is_empty()
        || source.password().is_some()
        || source.port().is_some()
        || !matches!(source.path(), "/watch" | "/playlist")
    {
        return Err(err(
            "YouTube Music şarkı, liste, radyo veya mix bağlantısı kullanın",
        ));
    }
    let mut result =
        url::Url::parse(&format!("https://music.youtube.com{}", source.path())).unwrap();
    for key in ["v", "list", "start_radio", "index", "params"] {
        let values: Vec<_> = source
            .query_pairs()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
            .collect();
        if values.len() > 1 {
            return Err(err("Yinelenen oynatma parametresi"));
        }
        if let Some(value) = values.first() {
            let id = |v: &str| {
                v.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            };
            let valid = match key {
                "v" => value.len() == 11 && id(value),
                "list" => (2..=256).contains(&value.len()) && id(value),
                "start_radio" => value == "1",
                "index" => {
                    (1..=5).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_digit())
                }
                "params" => {
                    (1..=512).contains(&value.len())
                        && value
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"_=-".contains(&b))
                }
                _ => false,
            };
            if !valid {
                return Err(err("YouTube Music oynatma parametresi geçersiz"));
            }
            result.query_pairs_mut().append_pair(key, value);
        }
    }
    let required = if source.path() == "/watch" {
        "v"
    } else {
        "list"
    };
    if !result.query_pairs().any(|(k, _)| k == required) {
        return Err(err("Şarkı veya liste kimliği eksik"));
    }
    Ok(result.to_string())
}

pub fn media_uri(input: &str) -> Result<String> {
    if url::Url::parse(input.trim())
        .ok()
        .is_some_and(|u| u.host_str() == Some("music.youtube.com"))
    {
        youtube_music_uri(input)
    } else {
        spotify_uri(input.trim())
    }
}

pub fn target_for_settings(input: &str, settings: &Settings) -> bool {
    match media_uri(input) {
        Ok(uri) if uri.starts_with("https://music.youtube.com/") => {
            settings.provider == Provider::System
                && settings.target_player == "browser:music.youtube.com"
        }
        Ok(_) => settings.targets_spotify(),
        Err(_) => false,
    }
}

/// Return a canonical Spotify track/playlist/album URI, stripping share parameters.
pub fn spotify_uri(input: &str) -> Result<String> {
    let input = input.trim();
    let parts: Vec<String> = if input.starts_with("spotify:") {
        input.split(':').map(str::to_owned).collect()
    } else {
        let u = url::Url::parse(input).map_err(|_| err("Spotify müzik bağlantısı geçersiz"))?;
        if u.scheme() != "https"
            || u.host_str() != Some("open.spotify.com")
            || !u.username().is_empty()
            || u.password().is_some()
            || u.port().is_some()
        {
            return Err(err("Yalnızca open.spotify.com bağlantıları kabul edilir"));
        }
        let path = u.path().strip_prefix('/').unwrap_or(u.path());
        let path: Vec<_> = path.strip_suffix('/').unwrap_or(path).split('/').collect();
        if path.len() != 2 {
            return Err(err("Spotify şarkı, liste veya albüm bağlantısı kullanın"));
        }
        vec!["spotify".into(), path[0].into(), path[1].into()]
    };
    if parts.len() != 3
        || !matches!(parts[1].as_str(), "track" | "playlist" | "album")
        || parts[2].len() != 22
        || !parts[2].bytes().all(|b| b.is_ascii_alphanumeric())
    {
        return Err(err(
            "Spotify şarkı/liste/albüm kimliği 22 alfasayısal karakter olmalı",
        ));
    }
    Ok(parts.join(":"))
}

pub struct Store {
    path: PathBuf,
}
impl Store {
    pub fn new(directory: &Path) -> Self {
        Self {
            path: directory.join("settings.json"),
        }
    }
    pub fn load(&self) -> Result<Settings> {
        match std::fs::read(&self.path) {
            Ok(bytes) => {
                let settings = serde_json::from_slice(&bytes)?;
                validate(&settings)?;
                Ok(settings)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(e) => Err(e.into()),
        }
    }
    pub fn save(&self, settings: &Settings) -> Result<()> {
        validate(settings)?;
        atomic_write(&self.path, &serde_json::to_vec_pretty(settings)?)
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or_else(|| err("Ayar dizini bulunamadı"))?;
    std::fs::create_dir_all(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    #[cfg(unix)]
    std::fs::File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multi_application_validation_and_legacy_roundtrip() {
        let old = Settings::default();
        let decoded: Settings =
            serde_json::from_str(&serde_json::to_string(&old).unwrap()).unwrap();
        assert_eq!(old, decoded);
        let mut settings = old;
        let app = InstalledApplication {
            id: "com.apple.Preview".into(),
            name: "Preview".into(),
            aliases: vec![],
        };
        settings.rules[0].matcher = Matcher::Apps(vec![app.clone()]);
        validate(&settings).unwrap();
        let decoded: Settings =
            serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
        assert_eq!(settings, decoded);
        for apps in [
            vec![],
            vec![app.clone(), app.clone()],
            vec![app.clone(); 65],
        ] {
            settings.rules[0].matcher = Matcher::Apps(apps);
            assert!(validate(&settings).is_err());
        }
        settings.rules[0].matcher = Matcher::Apps(vec![InstalledApplication {
            id: "bad\nvalue".into(),
            ..app
        }]);
        assert!(validate(&settings).is_err());
    }

    #[test]
    fn youtube_targets_match_the_frontend_and_extension_corpus() {
        let corpus: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/music-targets.json")).unwrap();
        for case in corpus["valid"].as_array().unwrap() {
            let uri = case["input"].as_str().unwrap();
            assert_eq!(
                youtube_music_uri(uri).unwrap(),
                case["output"].as_str().unwrap()
            );
            let mut settings = Settings::default();
            settings.rules[0].action = Action::Play {
                playlist: Some(uri.into()),
            };
            validate(&settings).unwrap();
            assert!(!target_for_settings(uri, &settings));
            settings.provider = Provider::System;
            settings.target_player = "browser:music.youtube.com".into();
            assert!(target_for_settings(uri, &settings));
        }
        for uri in corpus["invalid"].as_array().unwrap() {
            assert!(youtube_music_uri(uri.as_str().unwrap()).is_err());
        }
    }
    #[test]
    fn validates_spotify_without_injection() {
        assert_eq!(
            spotify_uri("https://open.spotify.com/playlist/1234567890123456789012?si=abc").unwrap(),
            "spotify:playlist:1234567890123456789012"
        );
        for invalid in [
            "spotify:artist:1234567890123456789012",
            "https://open.spotify.com.evil/playlist/1234567890123456789012",
            "spotify:playlist:\" & do shell script",
            "file:///tmp/foo",
        ] {
            assert!(spotify_uri(invalid).is_err());
        }
    }
    #[test]
    fn spotify_shared_targets_validate_roundtrip_and_match_the_provider() {
        let corpus: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/spotify-targets.json"))
                .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let store = Store::new(directory.path());
        for entry in corpus["valid"].as_array().unwrap() {
            let input = entry["input"].as_str().unwrap();
            assert_eq!(
                spotify_uri(input).unwrap(),
                entry["output"].as_str().unwrap()
            );
            let mut settings = Settings::default();
            settings.rules[0].action = Action::Play {
                playlist: Some(input.into()),
            };
            store.save(&settings).unwrap();
            assert_eq!(store.load().unwrap(), settings);
            assert!(target_for_settings(input, &settings));
            settings.provider = Provider::System;
            settings.target_player = "browser:music.youtube.com".into();
            assert!(!target_for_settings(input, &settings));
        }
        for input in corpus["invalid"].as_array().unwrap() {
            assert!(spotify_uri(input.as_str().unwrap()).is_err(), "{input}");
        }
    }
    #[test]
    fn settings_roundtrip_and_corrupt_file_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let settings = Settings::default();
        store.save(&settings).unwrap();
        assert_eq!(store.load().unwrap(), settings);
        std::fs::write(&store.path, "corrupt").unwrap();
        assert!(store.load().is_err());
        assert_eq!(std::fs::read_to_string(&store.path).unwrap(), "corrupt");
    }
    #[test]
    fn rejects_duplicate_ids_and_unbounded_polling() {
        let mut s = Settings::default();
        s.rules.push(s.rules[0].clone());
        assert!(validate(&s).is_err());
        s.rules.pop();
        s.poll_ms = 0;
        assert!(validate(&s).is_err());
    }
}
