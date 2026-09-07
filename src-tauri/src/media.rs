use crate::{model::*, platform::Platform};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct Controller {
    pub owned: Option<String>,
    pub paused_by_us: bool,
    pub expected_playing: bool,
    pub manual_override: bool,
    last_playlist: Option<String>,
    last_rule: Option<String>,
    last_action: Option<Instant>,
}

impl Controller {
    pub fn observe(&mut self, player: Option<&Player>) {
        if self
            .last_action
            .is_some_and(|t| t.elapsed() < Duration::from_secs(3))
        {
            return;
        }
        if let Some(player) = player {
            if self.owned.as_deref() == Some(&player.id)
                && self.expected_playing
                && player.playing == Some(false)
                && !self.paused_by_us
            {
                self.manual_override = true;
                self.expected_playing = false;
            }
        }
    }
    pub fn relinquish(&mut self) {
        *self = Self::default();
    }
    pub fn leave_context(&mut self) {
        self.last_rule = None;
        self.manual_override = false;
        // Do not reinterpret a pause outside the rule as a fresh manual override.
        self.expected_playing = false;
    }
    pub fn apply(
        &mut self,
        adapter: &mut dyn Platform,
        player: &Player,
        decision: &crate::engine::Decision,
        fade_ms: u64,
        cancel: &Arc<AtomicU64>,
        generation: u64,
    ) -> Result<()> {
        use crate::engine::Decision;
        match decision {
            Decision::Hold => {
                self.leave_context();
                Ok(())
            }
            Decision::Pause { .. } => {
                if player.playing != Some(true) {
                    return Ok(());
                }
                if !player.can_pause {
                    return Err(err("Oynatıcı duraklatmayı desteklemiyor"));
                }
                let result = transition(adapter, player, None, true, fade_ms, cancel, generation);
                if result.is_ok() {
                    self.owned = Some(player.id.clone());
                    self.paused_by_us = true;
                    self.expected_playing = false;
                    self.last_action = Some(Instant::now());
                }
                result
            }
            Decision::Play {
                rule_id, playlist, ..
            } => {
                if self.last_rule.as_deref() != Some(rule_id) {
                    self.manual_override = false;
                }
                self.last_rule = Some(rule_id.clone());
                if self.manual_override {
                    return Ok(());
                }
                if !player.can_play {
                    return Err(err("Oynatıcı çalmayı desteklemiyor"));
                }
                let canonical = playlist
                    .as_ref()
                    .map(|u| crate::config::media_uri(u))
                    .transpose()?;
                let change_playlist = canonical.is_some()
                    && (self.last_playlist != canonical
                        || self.owned.as_deref() != Some(&player.id));
                if change_playlist && !player.can_open_uri {
                    return Err(err(if player.id == "browser:music.youtube.com" {
                        "Liste başlatmak için Deskody Bridge eklentisini güncelleyip YouTube Music sayfasını yenileyin"
                    } else {
                        "Bu oynatıcı liste açmayı desteklemiyor; mevcut müzik kuralını kullanın"
                    }));
                }
                if player.playing == Some(true) && !change_playlist {
                    self.owned = Some(player.id.clone());
                    self.expected_playing = true;
                    self.paused_by_us = false;
                    return Ok(());
                }
                transition(
                    adapter,
                    player,
                    if change_playlist {
                        canonical.as_deref()
                    } else {
                        None
                    },
                    false,
                    fade_ms,
                    cancel,
                    generation,
                )?;
                self.owned = Some(player.id.clone());
                self.last_playlist = canonical;
                self.paused_by_us = false;
                self.expected_playing = true;
                self.last_action = Some(Instant::now());
                Ok(())
            }
        }
    }
}

fn cancelled(cancel: &AtomicU64, generation: u64) -> Result<()> {
    if cancel.load(Ordering::Relaxed) != generation {
        Err(err("İşlem yeni kullanıcı isteği nedeniyle iptal edildi"))
    } else {
        Ok(())
    }
}

fn fade(
    adapter: &mut dyn Platform,
    id: &str,
    from: f64,
    to: f64,
    duration: u64,
    cancel: &AtomicU64,
    generation: u64,
) -> Result<()> {
    let max_steps = if id.starts_with("spotify:web:") || id.starts_with("browser:") {
        3
    } else {
        10
    };
    let steps = (duration / 100).clamp(1, max_steps);
    let start = Instant::now();
    for step in 1..=steps {
        cancelled(cancel, generation)?;
        adapter.volume(id, from + (to - from) * step as f64 / steps as f64)?;
        let target = Duration::from_millis(duration * step / steps);
        if let Some(wait) = target.checked_sub(start.elapsed()) {
            std::thread::sleep(wait);
        }
    }
    Ok(())
}

fn transition(
    adapter: &mut dyn Platform,
    player: &Player,
    uri: Option<&str>,
    pause: bool,
    fade_ms: u64,
    cancel: &AtomicU64,
    generation: u64,
) -> Result<()> {
    cancelled(cancel, generation)?;
    if let Some(result) = adapter.transition(player, uri, pause, fade_ms) {
        return result;
    }
    let original = player
        .volume
        .filter(|v| v.is_finite() && (0.0..=1.0).contains(v));
    if fade_ms == 0 || original.is_none() {
        return if pause {
            adapter.pause(&player.id)
        } else {
            adapter.play(&player.id, uri)
        };
    }
    let original = original.unwrap_or(0.5);
    let result = (|| {
        if player.playing == Some(true) {
            fade(
                adapter,
                &player.id,
                original,
                0.0,
                fade_ms / 2,
                cancel,
                generation,
            )?;
        } else {
            adapter.volume(&player.id, 0.0)?;
        }
        cancelled(cancel, generation)?;
        if pause {
            adapter.pause(&player.id)?;
        } else {
            adapter.play(&player.id, uri)?;
            fade(
                adapter,
                &player.id,
                0.0,
                original,
                fade_ms / 2,
                cancel,
                generation,
            )?;
        }
        Ok(())
    })();
    // Restore even on cancellation or player failure; never leave a player accidentally muted.
    let restore = adapter.volume(&player.id, original);
    if result.is_err() && pause && cancel.load(Ordering::Relaxed) == generation {
        // Volume support may disappear mid-fade. The interrupt must still pause playback.
        adapter.pause(&player.id)?;
        return restore;
    }
    result.and(restore)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fake {
        calls: Vec<String>,
        fail_play: bool,
    }
    impl Platform for Fake {
        fn context(&mut self, _: &Settings) -> Result<Context> {
            unreachable!()
        }
        fn permissions(&self) -> Permissions {
            unreachable!()
        }
        fn request_permission(&self, _: &str) -> Result<()> {
            unreachable!()
        }
        fn players(&mut self, _: &Settings) -> Result<Vec<Player>> {
            unreachable!()
        }
        fn play(&mut self, _: &str, _: Option<&str>) -> Result<()> {
            self.calls.push("play".into());
            if self.fail_play {
                Err(err("failed"))
            } else {
                Ok(())
            }
        }
        fn pause(&mut self, _: &str) -> Result<()> {
            self.calls.push("pause".into());
            Ok(())
        }
        fn volume(&mut self, _: &str, v: f64) -> Result<()> {
            self.calls.push(format!("v:{v:.2}"));
            Ok(())
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
            self.calls.push(format!(
                "transition:{pause}:{fade_ms}:{}",
                uri.unwrap_or("")
            ));
            Some(if self.fail_play {
                Err(err("remote error"))
            } else {
                Ok(())
            })
        }
        fn media_key(&mut self) -> Result<()> {
            unreachable!()
        }
    }
    #[test]
    fn remote_transition_owns_volume_and_cleanup_on_success_and_failure() {
        for fail_play in [false, true] {
            let mut fake = Fake {
                calls: vec![],
                fail_play,
            };
            let player = Player {
                id: "browser:music.youtube.com".into(),
                playing: Some(true),
                volume: Some(0.7),
                ..Player::default()
            };
            let uri = "https://music.youtube.com/watch?v=LkoXilp7FPY";
            let result = transition(
                &mut fake,
                &player,
                Some(uri),
                false,
                600,
                &AtomicU64::new(0),
                0,
            );
            assert_eq!(result.is_err(), fail_play);
            // No separate volume/play/pause calls may race the browser's local transaction.
            assert_eq!(fake.calls, [format!("transition:false:600:{uri}")]);
        }
    }
    #[test]
    fn restores_original_volume_on_play_error() {
        let mut f = Fake {
            calls: vec![],
            fail_play: true,
        };
        let p = Player {
            id: "spotify".into(),
            playing: Some(false),
            volume: Some(0.7),
            ..Player::default()
        };
        assert!(transition(&mut f, &p, None, false, 2, &AtomicU64::new(0), 0).is_err());
        assert_eq!(f.calls.last().unwrap(), "v:0.70");
    }
    #[test]
    fn never_toggle_unknown_state_to_pause() {
        let mut f = Fake {
            calls: vec![],
            fail_play: false,
        };
        let mut c = Controller::default();
        let p = Player::default();
        c.apply(
            &mut f,
            &p,
            &crate::engine::Decision::Pause {
                reason: "video".into(),
                rule_id: None,
            },
            0,
            &Arc::new(AtomicU64::new(0)),
            0,
        )
        .unwrap();
        assert!(f.calls.is_empty());
    }
    #[test]
    fn cancelled_transition_has_no_side_effects() {
        let mut f = Fake {
            calls: vec![],
            fail_play: false,
        };
        assert!(transition(
            &mut f,
            &Player::default(),
            None,
            false,
            0,
            &AtomicU64::new(2),
            1
        )
        .is_err());
        assert!(f.calls.is_empty());
    }
    #[test]
    fn manual_pause_is_respected_until_context_changes() {
        let mut f = Fake {
            calls: vec![],
            fail_play: false,
        };
        let mut c = Controller::default();
        let mut p = Player {
            id: "spotify".into(),
            playing: Some(true),
            can_play: true,
            can_pause: true,
            ..Player::default()
        };
        let decision = crate::engine::Decision::Play {
            rule_id: "code".into(),
            name: "Code".into(),
            playlist: None,
        };
        let cancel = Arc::new(AtomicU64::new(0));
        c.apply(&mut f, &p, &decision, 0, &cancel, 0).unwrap();
        p.playing = Some(false);
        c.observe(Some(&p));
        assert!(c.manual_override);
        c.apply(&mut f, &p, &decision, 0, &cancel, 0).unwrap();
        assert!(f.calls.is_empty());
        let other = crate::engine::Decision::Play {
            rule_id: "study".into(),
            name: "Study".into(),
            playlist: None,
        };
        c.apply(&mut f, &p, &other, 0, &cancel, 0).unwrap();
        assert_eq!(f.calls, ["play"]);
    }
    #[test]
    fn leaving_and_reentering_the_same_rule_clears_manual_override() {
        let mut f = Fake {
            calls: vec![],
            fail_play: false,
        };
        let mut c = Controller::default();
        let mut p = Player {
            id: "spotify".into(),
            playing: Some(true),
            can_play: true,
            ..Player::default()
        };
        let decision = crate::engine::Decision::Play {
            rule_id: "code".into(),
            name: "Code".into(),
            playlist: None,
        };
        let cancel = Arc::new(AtomicU64::new(0));
        c.apply(&mut f, &p, &decision, 0, &cancel, 0).unwrap();
        p.playing = Some(false);
        c.observe(Some(&p));
        assert!(c.manual_override);
        c.leave_context();
        c.observe(Some(&p));
        c.apply(&mut f, &p, &decision, 0, &cancel, 0).unwrap();
        assert_eq!(f.calls, ["play"]);
    }
    #[test]
    fn interruption_resumes_without_reopening_same_playlist() {
        struct Recording {
            calls: Vec<Option<String>>,
        }
        impl Platform for Recording {
            fn context(&mut self, _: &Settings) -> Result<Context> {
                unreachable!()
            }
            fn permissions(&self) -> Permissions {
                unreachable!()
            }
            fn request_permission(&self, _: &str) -> Result<()> {
                unreachable!()
            }
            fn players(&mut self, _: &Settings) -> Result<Vec<Player>> {
                unreachable!()
            }
            fn play(&mut self, _: &str, uri: Option<&str>) -> Result<()> {
                self.calls.push(uri.map(str::to_owned));
                Ok(())
            }
            fn pause(&mut self, _: &str) -> Result<()> {
                Ok(())
            }
            fn volume(&mut self, _: &str, _: f64) -> Result<()> {
                unreachable!()
            }
            fn media_key(&mut self) -> Result<()> {
                unreachable!()
            }
        }
        let mut f = Recording { calls: vec![] };
        let mut c = Controller::default();
        let mut p = Player {
            id: "spotify".into(),
            playing: Some(false),
            can_play: true,
            can_pause: true,
            can_open_uri: true,
            ..Player::default()
        };
        let uri = "spotify:playlist:1234567890123456789012";
        let decision = crate::engine::Decision::Play {
            rule_id: "code".into(),
            name: "Code".into(),
            playlist: Some(uri.into()),
        };
        let cancel = Arc::new(AtomicU64::new(0));
        c.apply(&mut f, &p, &decision, 0, &cancel, 0).unwrap();
        p.playing = Some(true);
        c.apply(
            &mut f,
            &p,
            &crate::engine::Decision::Pause {
                reason: "video".into(),
                rule_id: None,
            },
            0,
            &cancel,
            0,
        )
        .unwrap();
        p.playing = Some(false);
        c.apply(&mut f, &p, &decision, 0, &cancel, 0).unwrap();
        assert_eq!(f.calls, [Some(uri.into()), None]);
    }
}
