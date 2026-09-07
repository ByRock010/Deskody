use crate::{
    browser::{Bridge, SharedBridge, WithBrowser},
    config::Store,
    engine::{self, Decision, Gate},
    media::Controller,
    model::*,
    platform::{self, Platform},
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::oneshot;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub settings: Settings,
    pub status: Status,
    pub permissions: Permissions,
    pub players: Vec<Player>,
}
#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum QuickChange {
    Enabled { enabled: bool },
    Rule { id: String, enabled: bool },
    ToggleEnabled,
}

enum SettingsUpdate {
    Replace(Settings),
    Quick(QuickChange),
}
impl SettingsUpdate {
    fn apply(self, current: &Settings) -> Result<Settings> {
        let mut next = current.clone();
        match self {
            Self::Replace(settings) => next = settings,
            Self::Quick(QuickChange::Enabled { enabled }) => next.enabled = enabled,
            Self::Quick(QuickChange::ToggleEnabled) => next.enabled = !next.enabled,
            Self::Quick(QuickChange::Rule { id, enabled }) => {
                next.rules
                    .iter_mut()
                    .find(|r| r.id == id)
                    .ok_or_else(|| err("Bu kural artık mevcut değil"))?
                    .enabled = enabled;
            }
        }
        crate::config::validate(&next)?;
        Ok(next)
    }
}

enum Command {
    Save(SettingsUpdate, oneshot::Sender<Result<Settings>>),
    Permission(String, oneshot::Sender<Result<Permissions>>),
    Media(String, oneshot::Sender<Result<()>>),
    Refresh,
    Shutdown(Option<oneshot::Sender<()>>),
}

pub struct Service {
    tx: mpsc::SyncSender<Command>,
    pub snapshot: Arc<Mutex<Snapshot>>,
    pub bridge: SharedBridge,
    cancel: Arc<AtomicU64>,
}
impl Service {
    pub fn start(directory: PathBuf, emit: impl Fn(Snapshot) + Send + 'static) -> Result<Self> {
        let store = Store::new(&directory);
        let (settings, error) = match store.load() {
            Ok(s) => (s, None),
            Err(e) => (
                Settings::default(),
                Some(format!(
                    "Ayarlar yüklenemedi; otomasyon kapalı. Dosya korunuyor: {e}"
                )),
            ),
        };
        let bridge = Arc::new(Mutex::new(Bridge::load(
            &directory,
            settings.browser_bridge,
        )?));
        let adapter = platform::create();
        let snapshot = Arc::new(Mutex::new(Snapshot {
            settings: settings.clone(),
            status: Status {
                error,
                decision: "Otomasyon kapalı".into(),
                ..Status::default()
            },
            permissions: adapter.permissions(),
            players: vec![],
        }));
        drop(adapter);
        let (tx, rx) = mpsc::sync_channel(32);
        let cancel = Arc::new(AtomicU64::new(0));
        let service = Self {
            tx,
            snapshot: snapshot.clone(),
            bridge: bridge.clone(),
            cancel: cancel.clone(),
        };
        thread::Builder::new()
            .name("music-automation".into())
            .spawn(move || {
                // Construct COM/D-Bus/AX handles on their owning thread.
                let adapter: Box<dyn Platform> = Box::new(WithBrowser {
                    native: Box::new(crate::spotify::WithSpotify::new(platform::create())),
                    bridge: bridge.clone(),
                    cancel: cancel.clone(),
                });
                worker(
                    store,
                    settings,
                    snapshot,
                    bridge,
                    cancel,
                    rx,
                    (emit, adapter),
                );
            })?;
        Ok(service)
    }
    pub fn get(&self) -> Result<Snapshot> {
        self.snapshot
            .lock()
            .map(|s| s.clone())
            .map_err(|_| err("Durum kilit hatası"))
    }
    pub async fn save(&self, settings: Settings) -> Result<Settings> {
        crate::config::validate(&settings)?;
        let (tx, rx) = oneshot::channel();
        self.cancel.fetch_add(1, Ordering::Relaxed);
        self.tx
            .try_send(Command::Save(SettingsUpdate::Replace(settings), tx))
            .map_err(|_| err("İşlem kuyruğu dolu"))?;
        rx.await
            .map_err(|_| err("Otomasyon iş parçacığı kapandı"))?
    }
    pub async fn quick_change(&self, change: QuickChange) -> Result<Settings> {
        let (tx, rx) = oneshot::channel();
        self.cancel.fetch_add(1, Ordering::Relaxed);
        self.tx
            .try_send(Command::Save(SettingsUpdate::Quick(change), tx))
            .map_err(|_| err("İşlem kuyruğu dolu"))?;
        rx.await
            .map_err(|_| err("Otomasyon iş parçacığı kapandı"))?
    }
    pub async fn permission(&self, kind: String) -> Result<Permissions> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .try_send(Command::Permission(kind, tx))
            .map_err(|_| err("İşlem kuyruğu dolu"))?;
        rx.await.map_err(|_| err("İzin işlemi kapandı"))?
    }
    pub async fn media(&self, action: String) -> Result<()> {
        let (tx, rx) = oneshot::channel();
        self.cancel.fetch_add(1, Ordering::Relaxed);
        self.tx
            .try_send(Command::Media(action, tx))
            .map_err(|_| err("İşlem kuyruğu dolu"))?;
        rx.await.map_err(|_| err("Medya işlemi kapandı"))?
    }
    pub fn refresh(&self) {
        let _ = self.tx.try_send(Command::Refresh);
    }
    pub fn shutdown(&self) {
        self.cancel.fetch_add(1, Ordering::Relaxed);
        let _ = self.tx.try_send(Command::Shutdown(None));
    }
    pub async fn stop(&self) {
        self.cancel.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        let queue = self.tx.clone();
        if tokio::task::spawn_blocking(move || queue.send(Command::Shutdown(Some(tx))))
            .await
            .is_ok_and(|r| r.is_ok())
        {
            let _ = rx.await;
        }
    }
}

fn is_own_context(context: &Context) -> bool {
    context.app_id == "dev.musicoptimizer.desktop"
        || [
            "deskody",
            "deskody.exe",
            "music optimizer",
            "music-optimizer",
            "music-optimizer.exe",
        ]
        .contains(&context.app.to_lowercase().as_str())
}

fn log(status: &mut Status, message: String, level: &str) {
    if status
        .activity
        .first()
        .is_some_and(|a| a.message == message)
    {
        return;
    }
    status.activity.insert(
        0,
        Activity {
            time: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            message,
            level: level.into(),
        },
    );
    status.activity.truncate(40);
}

fn worker(
    store: Store,
    mut settings: Settings,
    shared: Arc<Mutex<Snapshot>>,
    bridge: SharedBridge,
    cancel: Arc<AtomicU64>,
    rx: mpsc::Receiver<Command>,
    (emit, mut adapter): (impl Fn(Snapshot), Box<dyn Platform>),
) {
    let mut controller = Controller::default();
    let mut gate = Gate::default();
    let mut status = shared.lock().map(|s| s.status.clone()).unwrap_or_default();
    let mut players = Vec::new();
    let mut next_poll = Instant::now();
    let mut retry_after = Instant::now();
    let mut refresh = false;
    let mut effect_error = status.error.clone();
    loop {
        let wait = next_poll.saturating_duration_since(Instant::now());
        match rx.recv_timeout(wait) {
            Ok(Command::Shutdown(reply)) => {
                if let Some(reply) = reply {
                    let _ = reply.send(());
                }
                break;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Ok(Command::Save(update, reply)) => {
                let result = update.apply(&settings).and_then(|next| {
                    store.save(&next)?;
                    let reset = next.provider != settings.provider
                        || next.spotify_web != settings.spotify_web
                        || next.spotify_client_id != settings.spotify_client_id
                        || next.target_player != settings.target_player
                        || next.enabled != settings.enabled
                        || (next.rules != settings.rules
                            && engine::evaluate(&next, &status.context)
                                != engine::evaluate(&settings, &status.context));
                    settings = next;
                    if reset {
                        controller.relinquish();
                    }
                    gate.reset();
                    retry_after = Instant::now();
                    if let Ok(mut b) = bridge.lock() {
                        b.set_enabled(settings.browser_bridge);
                    }
                    status.error = None;
                    effect_error = None;
                    log(&mut status, "Ayarlar kaydedildi".into(), "info");
                    // Publish committed settings before acknowledging the command. A second
                    // window must never read the pre-save snapshot after a successful write.
                    let committed = if let Ok(mut state) = shared.lock() {
                        state.settings = settings.clone();
                        Some(state.clone())
                    } else {
                        None
                    };
                    if let Some(snapshot) = committed {
                        emit(snapshot);
                    }
                    Ok(settings.clone())
                });
                let _ = reply.send(result);
                refresh = true;
                next_poll = Instant::now();
            }
            Ok(Command::Permission(kind, reply)) => {
                let result = adapter
                    .request_permission(&kind)
                    .map(|_| adapter.permissions());
                let _ = reply.send(result);
                refresh = true;
                next_poll = Instant::now();
            }
            Ok(Command::Refresh) => {
                effect_error = None;
                gate.reset();
                retry_after = Instant::now();
                refresh = true;
                next_poll = Instant::now();
            }
            Ok(Command::Media(action, reply)) => {
                let result = match action.as_str() {
                    "resumeAutomation" => {
                        controller.relinquish();
                        gate.reset();
                        Ok(())
                    }
                    "mediaKey" => {
                        controller.manual_override = true;
                        adapter.media_key()
                    }
                    "pause" => {
                        if let Some(player) = platform::selected(&players, &settings) {
                            adapter.pause(&player.id).map(|_| {
                                controller.manual_override = true;
                                controller.expected_playing = false;
                            })
                        } else {
                            Err(err("Önce açık bir oynatıcı seçin"))
                        }
                    }
                    "play" => {
                        if let Some(player) = platform::selected(&players, &settings) {
                            adapter.play(&player.id, None).map(|_| {
                                controller.relinquish();
                                gate.reset();
                            })
                        } else {
                            Err(err("Önce açık bir oynatıcı seçin"))
                        }
                    }
                    _ => Err(err("Bilinmeyen medya komutu")),
                };
                if let Err(e) = &result {
                    status.error = Some(e.to_string());
                }
                let _ = reply.send(result);
                refresh = true;
                next_poll = Instant::now();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let generation = cancel.load(Ordering::Relaxed);
                status.error = effect_error.clone();
                if settings.enabled || refresh {
                    match adapter.players(&settings) {
                        Ok(p) => {
                            players = p;
                        }
                        Err(e) => {
                            players.clear();
                            status.error = Some(e.to_string());
                        }
                    }
                    let next_player = platform::selected(&players, &settings).cloned();
                    if status.player.as_ref().map(|p| &p.id) != next_player.as_ref().map(|p| &p.id)
                    {
                        gate.reset();
                        controller.relinquish();
                        retry_after = Instant::now();
                    }
                    status.player = next_player;
                    controller.observe(status.player.as_ref());
                }
                if settings.enabled {
                    match adapter.context(&settings) {
                        Ok(mut context) => {
                            // A quick-control window must not become a new music context.
                            // Keep the last external app while either Deskody window has focus.
                            if is_own_context(&context) {
                                if let Some(previous) = &status.last_context {
                                    let other_audio = context.other_audio;
                                    context = previous.clone();
                                    context.other_audio = other_audio;
                                }
                            }
                            if let Some(url) =
                                context.url.as_ref().and_then(|u| url::Url::parse(u).ok())
                            {
                                let mut url = url;
                                url.set_query(None);
                                url.set_fragment(None);
                                let _ = url.set_username("");
                                let _ = url.set_password(None);
                                context.url = Some(url.to_string());
                            }
                            // Exclude the selected player when detecting competing media sessions.
                            let foreign = players.iter().any(|p| {
                                Some(&p.id) != status.player.as_ref().map(|p| &p.id)
                                    && !p.id.starts_with("spotify:web:")
                                    && p.playing == Some(true)
                            });
                            if foreign {
                                context.other_audio = Some(true);
                            }
                            let decision = engine::evaluate(&settings, &context);
                            if !is_own_context(&context) && !context.app.is_empty() {
                                status.last_context = Some(context.clone());
                            }
                            status.context = context;
                            status.active_rule = decision.rule_id().map(str::to_owned);
                            status.decision = match &decision {
                                Decision::Hold => "Eşleşen kural bekleniyor".into(),
                                Decision::Pause { reason, .. } => reason.clone(),
                                Decision::Play { name, .. } => name.clone(),
                            };
                            if Instant::now() >= retry_after {
                                let changed = gate.update(
                                    decision.clone(),
                                    Instant::now(),
                                    Duration::from_millis(settings.settle_ms),
                                );
                                // Reassert an interrupt if the user/player resumes while video is still active.
                                let interrupt = matches!(decision, Decision::Pause { .. })
                                    && status
                                        .player
                                        .as_ref()
                                        .is_some_and(|p| p.playing == Some(true));
                                if changed.is_some() || interrupt {
                                    let result = if matches!(decision, Decision::Hold) {
                                        controller.leave_context();
                                        Ok(())
                                    } else if let Some(player) = &status.player {
                                        controller.apply(
                                            adapter.as_mut(),
                                            player,
                                            &decision,
                                            settings.fade_ms,
                                            &cancel,
                                            generation,
                                        )
                                    } else {
                                        Err(err("Seçili oynatıcı bulunamadı. Spotify veya seçtiğiniz müzik uygulamasını açın."))
                                    };
                                    match result {
                                        Ok(()) => {
                                            status.error = None;
                                            effect_error = None;
                                            if !matches!(decision, Decision::Hold) {
                                                let message = status.decision.clone();
                                                let app = &status.context.app;
                                                let player = status
                                                    .player
                                                    .as_ref()
                                                    .map(|p| p.name.as_str())
                                                    .unwrap_or("Oynatıcı yok");
                                                let action = if controller.manual_override {
                                                    "Elle duraklatıldı; otomasyon bekliyor"
                                                } else if matches!(decision, Decision::Pause { .. })
                                                {
                                                    "Duraklat"
                                                } else {
                                                    "Çal"
                                                };
                                                let message = format!(
                                                    "{app} · {message} → {player}: {action}"
                                                );
                                                log(&mut status, message, "info");
                                            }
                                        }
                                        Err(e) => {
                                            let message = e.to_string();
                                            status.error = Some(message.clone());
                                            effect_error = Some(message.clone());
                                            log(&mut status, message, "error");
                                            gate.reset();
                                            retry_after = Instant::now() + Duration::from_secs(10);
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            status.context = Context::default();
                            status.active_rule = None;
                            status.error = Some(e.to_string());
                            status.decision = "Bağlam okunamıyor".into();
                            gate.reset();
                        }
                    }
                } else {
                    status.decision = "Otomasyon kapalı".into();
                    status.active_rule = None;
                    status.context = Context::default();
                }
                status.enabled = settings.enabled;
                status.manual_override = controller.manual_override;
                status.bridge_connected = bridge.lock().ok().and_then(|b| b.sample()).is_some();
                if let Some(error) =
                    bridge
                        .lock()
                        .ok()
                        .and_then(|b| if b.enabled { b.error.clone() } else { None })
                {
                    status.error = Some(error);
                }
                let snapshot = Snapshot {
                    settings: settings.clone(),
                    status: status.clone(),
                    permissions: adapter.permissions(),
                    players: players.clone(),
                };
                if let Ok(mut state) = shared.lock() {
                    *state = snapshot.clone();
                }
                emit(snapshot);
                refresh = false;
                next_poll = Instant::now()
                    + Duration::from_millis(if settings.enabled {
                        settings.poll_ms
                    } else {
                        10000
                    });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Input {
        context: Context,
        player: Option<Player>,
        calls: Vec<String>,
    }
    struct Fake(Arc<Mutex<Input>>);
    impl Platform for Fake {
        fn context(&mut self, _: &Settings) -> Result<Context> {
            Ok(self.0.lock().unwrap().context.clone())
        }
        fn permissions(&self) -> Permissions {
            Permissions {
                accessibility: true,
                automation: String::new(),
                platform: "Test".into(),
                capabilities: vec![],
            }
        }
        fn request_permission(&self, _: &str) -> Result<()> {
            Ok(())
        }
        fn players(&mut self, _: &Settings) -> Result<Vec<Player>> {
            Ok(self.0.lock().unwrap().player.iter().cloned().collect())
        }
        fn play(&mut self, id: &str, uri: Option<&str>) -> Result<()> {
            let mut input = self.0.lock().unwrap();
            assert_eq!(input.player.as_ref().unwrap().id, id);
            input
                .calls
                .push(format!("play:{}", uri.unwrap_or("resume")));
            input.player.as_mut().unwrap().playing = Some(true);
            Ok(())
        }
        fn pause(&mut self, id: &str) -> Result<()> {
            let mut input = self.0.lock().unwrap();
            assert_eq!(input.player.as_ref().unwrap().id, id);
            input.calls.push("pause".into());
            input.player.as_mut().unwrap().playing = Some(false);
            Ok(())
        }
        fn volume(&mut self, _: &str, _: f64) -> Result<()> {
            unreachable!("fade disabled in worker tests")
        }
        fn media_key(&mut self) -> Result<()> {
            unreachable!("rules must never send a global toggle")
        }
    }

    struct Harness {
        service: Service,
        input: Arc<Mutex<Input>>,
        events: mpsc::Receiver<Snapshot>,
        directory: tempfile::TempDir,
    }
    impl Harness {
        fn new(mut settings: Settings) -> Self {
            settings.enabled = true;
            settings.poll_ms = 750;
            settings.settle_ms = 500;
            settings.fade_ms = 0;
            let directory = tempfile::tempdir().unwrap();
            let store = Store::new(directory.path());
            store.save(&settings).unwrap();
            let settings = store.load().unwrap();
            let bridge = Arc::new(Mutex::new(Bridge::load(directory.path(), false).unwrap()));
            let input = Arc::new(Mutex::new(Input {
                context: Context {
                    app: "Code".into(),
                    app_id: "com.microsoft.VSCode".into(),
                    ..Context::default()
                },
                player: Some(Player {
                    id: settings.target_player.clone(),
                    name: "Test player".into(),
                    playing: Some(true),
                    can_play: true,
                    can_pause: true,
                    can_open_uri: true,
                    ..Player::default()
                }),
                calls: vec![],
            }));
            let adapter = Fake(input.clone());
            let shared = Arc::new(Mutex::new(Snapshot {
                settings: settings.clone(),
                status: Status::default(),
                permissions: adapter.permissions(),
                players: vec![],
            }));
            let cancel = Arc::new(AtomicU64::new(0));
            let (tx, rx) = mpsc::sync_channel(32);
            let (send, events) = mpsc::channel();
            let service = Service {
                tx,
                snapshot: shared.clone(),
                bridge: bridge.clone(),
                cancel: cancel.clone(),
            };
            thread::spawn(move || {
                worker(
                    store,
                    settings,
                    shared,
                    bridge,
                    cancel,
                    rx,
                    (
                        move |s| {
                            let _ = send.send(s);
                        },
                        Box::new(adapter),
                    ),
                )
            });
            Self {
                service,
                input,
                events,
                directory,
            }
        }
        fn wait(&self, predicate: impl Fn(&Snapshot) -> bool) -> Snapshot {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let snapshot = self
                    .events
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .expect("worker did not reach the expected state");
                if predicate(&snapshot) {
                    return snapshot;
                }
            }
        }
    }
    impl Drop for Harness {
        fn drop(&mut self) {
            self.service.shutdown();
        }
    }

    #[tokio::test]
    async fn quick_switches_preserve_other_settings_and_reject_deleted_rules() {
        let harness = Harness::new(Settings::default());
        harness.wait(|_| true);
        let original = harness.service.get().unwrap().settings;
        let id = original.rules[0].id.clone();
        let (disabled, rule) = tokio::join!(
            harness
                .service
                .quick_change(QuickChange::Enabled { enabled: false }),
            harness
                .service
                .quick_change(QuickChange::Rule { id, enabled: false }),
        );
        disabled.unwrap();
        rule.unwrap();
        let snapshot = harness.service.get().unwrap();
        assert!(!snapshot.settings.enabled);
        assert!(!snapshot.settings.rules[0].enabled);
        assert_eq!(snapshot.settings.rules[1..], original.rules[1..]);
        assert_eq!(snapshot.settings.target_player, original.target_player);
        assert_eq!(
            Store::new(harness.directory.path()).load().unwrap(),
            snapshot.settings
        );
        assert!(harness
            .service
            .quick_change(QuickChange::Rule {
                id: "deleted".into(),
                enabled: true
            })
            .await
            .is_err());
        assert_eq!(harness.service.get().unwrap().settings, snapshot.settings);
        harness.service.stop().await;
    }

    #[tokio::test]
    async fn opening_panel_and_switching_unrelated_rule_does_not_restart_playlist() {
        let mut settings = Settings {
            provider: Provider::System,
            target_player: "com.spotify.client".into(),
            ..Settings::default()
        };
        settings.rules.truncate(2);
        settings.rules[0].action = Action::Play {
            playlist: Some("spotify:playlist:1234567890123456789012".into()),
        };
        let rule = settings.rules[0].id.clone();
        let unrelated = settings.rules[1].id.clone();
        let harness = Harness::new(settings);
        harness.wait(|_| harness.input.lock().unwrap().calls.len() == 1);
        harness.input.lock().unwrap().context = Context {
            app: "Deskody".into(),
            app_id: "dev.musicoptimizer.desktop".into(),
            ..Context::default()
        };
        harness.service.refresh();
        harness.wait(|s| s.status.active_rule.as_deref() == Some(&rule));
        harness
            .service
            .quick_change(QuickChange::Rule {
                id: unrelated,
                enabled: false,
            })
            .await
            .unwrap();
        harness.wait(|s| !s.settings.rules[1].enabled && s.status.context.app == "Code");
        harness.wait(|_| true);
        assert_eq!(harness.input.lock().unwrap().calls.len(), 1);
        harness.service.media("pause".into()).await.unwrap();
        harness.wait(|s| s.status.manual_override);
        harness.service.refresh();
        harness.wait(|s| s.status.manual_override);
        assert_eq!(harness.input.lock().unwrap().calls.last().unwrap(), "pause");
        harness
            .service
            .quick_change(QuickChange::Rule {
                id: rule,
                enabled: false,
            })
            .await
            .unwrap();
        harness.wait(|s| s.status.active_rule.is_none());
        harness.service.stop().await;
    }

    #[tokio::test]
    async fn saved_code_pause_and_terminal_play_reach_the_selected_player() {
        // The user's persisted configuration: Spotify selected in the system picker,
        // a VS Code pause rule, and the normal Code/Linux play rule also enabled.
        let mut settings = Settings {
            provider: Provider::System,
            target_player: "com.spotify.client".into(),
            ..Settings::default()
        };
        settings.rules[0].action = Action::Pause;
        settings.rules[0].priority = 100;
        let pause_id = settings.rules[0].id.clone();
        let terminal_id = settings.rules[1].id.clone();
        let harness = Harness::new(settings);
        harness.wait(|s| {
            s.status.active_rule.as_deref() == Some(&pause_id) && s.status.error.is_none()
        });
        assert_eq!(harness.input.lock().unwrap().calls, ["pause"]);
        harness.input.lock().unwrap().context = Context {
            app: "Terminal".into(),
            app_id: "com.apple.Terminal".into(),
            ..Context::default()
        };
        harness.wait(|s| {
            s.status.active_rule.as_deref() == Some(&terminal_id)
                && harness.input.lock().unwrap().calls.len() == 2
        });
        assert_eq!(
            harness.input.lock().unwrap().calls,
            ["pause", "play:resume"]
        );
        // Highest-priority video interruption must apply immediately on the next poll.
        harness.input.lock().unwrap().context = Context {
            app: "Chrome".into(),
            url: Some("https://youtube.com/watch?v=test".into()),
            is_browser: true,
            ..Context::default()
        };
        harness.wait(|s| {
            s.status.decision.contains("Video izleme")
                && harness.input.lock().unwrap().calls.len() == 3
        });
        assert_eq!(harness.input.lock().unwrap().calls.last().unwrap(), "pause");
        harness.service.stop().await;
    }

    #[tokio::test]
    async fn saving_a_rule_applies_it_without_restart_and_does_not_reopen_each_poll() {
        let mut settings = Settings {
            provider: Provider::System,
            target_player: "com.spotify.client".into(),
            ..Settings::default()
        };
        settings.rules.truncate(1);
        settings.rules[0].action = Action::Play {
            playlist: Some("spotify:playlist:1234567890123456789012".into()),
        };
        let harness = Harness::new(settings);
        harness.wait(|_| harness.input.lock().unwrap().calls.len() == 1);
        harness.wait(|_| true);
        assert_eq!(
            harness.input.lock().unwrap().calls,
            ["play:spotify:playlist:1234567890123456789012"]
        );
        let mut next = harness.service.get().unwrap().settings;
        next.rules[0].action = Action::Pause;
        harness.service.save(next.clone()).await.unwrap();
        harness.wait(|s| s.settings == next && harness.input.lock().unwrap().calls.len() == 2);
        assert_eq!(harness.input.lock().unwrap().calls.last().unwrap(), "pause");
        next.rules[0].action = Action::Play { playlist: None };
        harness.service.save(next.clone()).await.unwrap();
        harness.wait(|s| s.settings == next && harness.input.lock().unwrap().calls.len() == 3);
        assert_eq!(
            harness.input.lock().unwrap().calls.last().unwrap(),
            "play:resume"
        );
        assert_eq!(Store::new(harness.directory.path()).load().unwrap(), next);
        harness.service.stop().await;
    }

    #[tokio::test]
    async fn youtube_music_pdf_rule_recovers_when_the_selected_player_reconnects() {
        let mut settings = Settings {
            provider: Provider::System,
            target_player: "browser:music.youtube.com".into(),
            ..Settings::default()
        };
        settings
            .rules
            .retain(|r| matches!(r.matcher, Matcher::FileExtension(_)));
        let target =
            "https://music.youtube.com/watch?v=LkoXilp7FPY&list=PLDRwTTP8arJ9NSwCujKB7dYA_2fVCNnDg";
        settings.rules[0].action = Action::Play {
            playlist: Some(target.into()),
        };
        let harness = Harness::new(settings);
        let mut player = harness.input.lock().unwrap().player.take().unwrap();
        player.playing = Some(false);
        harness.input.lock().unwrap().context = Context {
            app: "Preview".into(),
            document: Some("file:///tmp/lecture.pdf".into()),
            ..Context::default()
        };
        harness.wait(|s| {
            s.status
                .error
                .as_ref()
                .is_some_and(|e| e.contains("Seçili oynatıcı bulunamadı"))
        });
        harness.input.lock().unwrap().player = Some(player);
        harness
            .wait(|s| s.status.error.is_none() && !harness.input.lock().unwrap().calls.is_empty());
        assert_eq!(
            harness.input.lock().unwrap().calls,
            [format!("play:{target}")]
        );
        harness.service.stop().await;
    }
}
