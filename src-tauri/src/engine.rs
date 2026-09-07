use crate::model::*;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Hold,
    Pause {
        reason: String,
        rule_id: Option<String>,
    },
    Play {
        rule_id: String,
        name: String,
        playlist: Option<String>,
    },
}

impl Decision {
    pub fn rule_id(&self) -> Option<&str> {
        match self {
            Self::Play { rule_id, .. } => Some(rule_id),
            Self::Pause { rule_id, .. } => rule_id.as_deref(),
            Self::Hold => None,
        }
    }
}

fn app_key(value: &str) -> String {
    let value = value.trim().to_lowercase();
    let name = value.rsplit(['/', '\\']).next().unwrap_or(&value);
    let name = name
        .strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".app"))
        .unwrap_or(name);
    // Display names, bundle IDs and executable names differ across platforms.
    // Keep aliases exact so e.g. "code-helper" cannot activate a Code rule.
    match name {
        "code" | "vscode" | "vs code" | "visual studio code" | "com.microsoft.vscode" => {
            "com.microsoft.vscode"
        }
        "terminal" | "com.apple.terminal" => "com.apple.terminal",
        "windowsterminal" | "windows terminal" => "windowsterminal",
        "xcode" | "com.apple.dt.xcode" => "com.apple.dt.xcode",
        other => other,
    }
    .to_owned()
}

pub fn domain_matches(host: &str, domain: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let domain = domain.trim_end_matches('.').to_ascii_lowercase();
    host == domain || host.ends_with(&format!(".{domain}"))
}

fn matches(matcher: &Matcher, context: &Context) -> bool {
    match matcher {
        Matcher::App(value) => {
            let v = app_key(value);
            app_key(&context.app) == v
                || app_key(&context.app_id) == v
                || context
                    .app_id
                    .rsplit(['/', '\\', '.'])
                    .next()
                    .is_some_and(|id| id.eq_ignore_ascii_case(value))
        }
        Matcher::Apps(apps) => apps.iter().any(|app| {
            let keys = std::iter::once(&app.id).chain(&app.aliases);
            keys.into_iter().any(|id| {
                if id.contains(['/', '\\']) {
                    id.eq_ignore_ascii_case(&context.app_id)
                } else {
                    app_key(id) == app_key(&context.app_id) || app_key(id) == app_key(&context.app)
                }
            })
        }),
        Matcher::Title(value) => context.title.to_lowercase().contains(&value.to_lowercase()),
        Matcher::Domain(value) => context
            .url
            .as_ref()
            .and_then(|u| url::Url::parse(u).ok())
            .and_then(|u| u.host_str().map(|h| domain_matches(h, value)))
            .unwrap_or(false),
        Matcher::FileExtension(value) => {
            let extension = format!(".{}", value.trim_start_matches('.').to_lowercase());
            [context.document.as_deref(), context.url.as_deref()]
                .into_iter()
                .flatten()
                .any(|document| {
                    let path = url::Url::parse(document)
                        .ok()
                        .map(|u| u.path().to_owned())
                        .unwrap_or_else(|| document.to_owned());
                    path.to_lowercase().ends_with(&extension)
                })
                || context
                    .title
                    .to_lowercase()
                    .split([' ', '—', '|'])
                    .any(|s| s.ends_with(&extension))
        }
    }
}

pub fn evaluate(settings: &Settings, context: &Context) -> Decision {
    if !settings.enabled {
        return Decision::Hold;
    }
    if settings.pause_on_other_audio && context.other_audio == Some(true) {
        return Decision::Pause {
            reason: "Başka bir uygulamada medya aktif".into(),
            rule_id: None,
        };
    }
    if let Some(url) = context.url.as_ref().and_then(|u| url::Url::parse(u).ok()) {
        let host = url.host_str().unwrap_or("");
        if domain_matches(host, "netflix.com")
            || (domain_matches(host, "youtube.com")
                && host != "music.youtube.com"
                && (url.path() == "/watch" || url.path().starts_with("/shorts/")))
            || domain_matches(host, "youtu.be")
        {
            return Decision::Pause {
                reason: "Video izleme · kesici kural".into(),
                rule_id: None,
            };
        }
    }
    let mut rules: Vec<_> = settings
        .rules
        .iter()
        .filter(|r| r.enabled && matches(&r.matcher, context))
        .collect();
    // Every pause rule outranks every play rule. Equal priorities resolve by stable ID.
    rules.sort_by(|a, b| {
        matches!(b.action, Action::Pause)
            .cmp(&matches!(a.action, Action::Pause))
            .then(b.priority.cmp(&a.priority))
            .then(a.id.cmp(&b.id))
    });
    match rules.first() {
        Some(rule) => match &rule.action {
            Action::Pause => Decision::Pause {
                reason: rule.name.clone(),
                rule_id: Some(rule.id.clone()),
            },
            Action::Play { playlist } => Decision::Play {
                rule_id: rule.id.clone(),
                name: rule.name.clone(),
                playlist: playlist
                    .as_ref()
                    .filter(|uri| crate::config::target_for_settings(uri, settings))
                    .cloned(),
            },
        },
        None => Decision::Hold,
    }
}

/// Immediate interrupts, monotonic hysteresis for context changes.
pub struct Gate {
    pending: Decision,
    since: Instant,
    settled: Decision,
}
impl Default for Gate {
    fn default() -> Self {
        Self {
            pending: Decision::Hold,
            since: Instant::now(),
            settled: Decision::Hold,
        }
    }
}
impl Gate {
    pub fn update(&mut self, next: Decision, now: Instant, settle: Duration) -> Option<Decision> {
        if self.pending != next {
            self.pending = next.clone();
            self.since = now;
        }
        if (matches!(next, Decision::Pause { .. }) || now.duration_since(self.since) >= settle)
            && self.settled != next
        {
            self.settled = next.clone();
            Some(next)
        } else {
            None
        }
    }
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn settings() -> Settings {
        Settings {
            enabled: true,
            ..Settings::default()
        }
    }
    #[test]
    fn one_rule_matches_any_selected_application_and_keeps_pause_priority() {
        let mut settings = Settings {
            enabled: true,
            rules: vec![Rule {
                id: "shared".into(),
                name: "Çalışma".into(),
                enabled: true,
                priority: 90,
                matcher: Matcher::Apps(vec![
                    InstalledApplication {
                        id: "com.microsoft.VSCode".into(),
                        name: "Visual Studio Code".into(),
                        aliases: vec![],
                    },
                    InstalledApplication {
                        id: "com.apple.Preview".into(),
                        name: "Preview".into(),
                        aliases: vec![],
                    },
                ]),
                action: Action::Play { playlist: None },
            }],
            ..Settings::default()
        };
        for id in ["com.microsoft.VSCode", "com.apple.Preview"] {
            let context = Context {
                app_id: id.into(),
                ..Context::default()
            };
            assert!(
                matches!(evaluate(&settings, &context), Decision::Play { rule_id, .. } if rule_id == "shared")
            );
        }
        for id in ["com.apple.Safari", "com.microsoft.VSCode.helper"] {
            assert_eq!(
                evaluate(
                    &settings,
                    &Context {
                        app_id: id.into(),
                        ..Context::default()
                    }
                ),
                Decision::Hold
            );
        }
        let mut pause = settings.rules[0].clone();
        pause.id = "interrupt".into();
        pause.priority = 1;
        pause.action = Action::Pause;
        settings.rules.push(pause);
        assert!(matches!(
            evaluate(
                &settings,
                &Context {
                    app_id: "com.apple.Preview".into(),
                    ..Context::default()
                }
            ),
            Decision::Pause { .. }
        ));
    }

    #[test]
    fn video_interrupt_overrides_coding() {
        let c = Context {
            app: "Visual Studio Code".into(),
            url: Some("https://www.youtube.com/watch?v=123".into()),
            ..Context::default()
        };
        assert!(matches!(evaluate(&settings(), &c), Decision::Pause { .. }));
    }
    #[test]
    fn rejects_spoofed_domains_and_query_substrings() {
        for url in [
            "https://youtube.com.evil.test/watch",
            "https://example.com/?q=netflix.com",
            "https://music.youtube.com/",
            "https://music.youtube.com/watch?v=123",
        ] {
            assert_eq!(
                evaluate(
                    &settings(),
                    &Context {
                        url: Some(url.into()),
                        ..Context::default()
                    }
                ),
                Decision::Hold
            );
        }
    }
    #[test]
    fn detects_pdf_url_with_query() {
        let c = Context {
            url: Some("https://example.com/notes.pdf?page=2".into()),
            ..Context::default()
        };
        assert!(matches!(evaluate(&settings(), &c), Decision::Play { .. }));
    }
    #[test]
    fn pause_is_immediate_play_is_debounced() {
        let mut gate = Gate::default();
        let now = Instant::now();
        let delay = Duration::from_secs(2);
        let play = Decision::Play {
            rule_id: "1".into(),
            name: "Code".into(),
            playlist: None,
        };
        assert!(gate.update(play.clone(), now, delay).is_none());
        assert_eq!(gate.update(play.clone(), now + delay, delay), Some(play));
        assert!(matches!(
            gate.update(
                Decision::Pause {
                    reason: "video".into(),
                    rule_id: None,
                },
                now + delay,
                delay
            ),
            Some(Decision::Pause { .. })
        ));
    }
    #[test]
    fn disabled_engine_never_controls_media() {
        assert_eq!(
            evaluate(
                &Settings::default(),
                &Context {
                    other_audio: Some(true),
                    ..Context::default()
                }
            ),
            Decision::Hold
        );
    }
    #[test]
    fn switching_provider_preserves_but_does_not_send_spotify_playlist() {
        let mut s = settings();
        s.provider = Provider::System;
        s.rules[0].action = Action::Play {
            playlist: Some("spotify:playlist:1234567890123456789012".into()),
        };
        crate::config::validate(&s).unwrap();
        let c = Context {
            app: "Visual Studio Code".into(),
            ..Context::default()
        };
        assert!(matches!(
            evaluate(&s, &c),
            Decision::Play { playlist: None, .. }
        ));
    }
    #[test]
    fn macos_code_display_name_uses_the_vscode_pause_rule() {
        let mut s = settings();
        s.rules[0].action = Action::Pause;
        s.rules[0].priority = 100;
        for (app, app_id) in [
            ("Code", "com.microsoft.VSCode"),
            ("", "com.microsoft.VSCode"),
            ("Code.exe", r"C:\Apps\VS Code\Code.exe"),
            ("code", "code"),
        ] {
            let decision = evaluate(
                &s,
                &Context {
                    app: app.into(),
                    app_id: app_id.into(),
                    ..Context::default()
                },
            );
            assert!(
                matches!(decision, Decision::Pause { .. }),
                "{app}: {decision:?}"
            );
            assert_eq!(decision.rule_id(), Some(s.rules[0].id.as_str()));
        }
        for app in [
            "Code Helper",
            "code-helper",
            "Xcode Helper",
            "Visual Studio",
        ] {
            assert_eq!(
                evaluate(
                    &s,
                    &Context {
                        app: app.into(),
                        ..Context::default()
                    }
                ),
                Decision::Hold
            );
        }
    }
    #[test]
    fn spotify_selected_as_a_system_session_receives_the_playlist() {
        let mut s = settings();
        s.provider = Provider::System;
        let uri = "spotify:playlist:1234567890123456789012";
        s.rules.truncate(1);
        s.rules[0].action = Action::Play {
            playlist: Some(uri.into()),
        };
        for id in [
            "com.spotify.client",
            "Spotify.exe",
            "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify",
            "org.mpris.MediaPlayer2.spotify.instance1",
        ] {
            s.target_player = id.into();
            assert!(
                matches!(evaluate(&s, &Context { app: "Code".into(), ..Context::default() }), Decision::Play { playlist: Some(value), .. } if value == uri)
            );
        }
        s.target_player = "browser:music.youtube.com".into();
        assert!(matches!(
            evaluate(
                &s,
                &Context {
                    app: "Code".into(),
                    ..Context::default()
                }
            ),
            Decision::Play { playlist: None, .. }
        ));
    }
    #[test]
    fn pdf_url_is_checked_even_when_window_document_is_not_a_pdf() {
        let c = Context {
            document: Some("".into()),
            url: Some("https://example.com/notes.pdf".into()),
            ..Context::default()
        };
        assert!(matches!(evaluate(&settings(), &c), Decision::Play { .. }));
    }
}
