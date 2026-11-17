use super::*;
use ::windows::{
    core::Interface,
    Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Playback,
    },
    Win32::{
        Foundation::*,
        Media::Audio::{Endpoints::IAudioMeterInformation, *},
        System::{Com::*, Threading::*},
        UI::{Accessibility::*, Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    },
};

#[derive(Default)]
pub struct Windows {
    initialized: bool,
    cover: Option<(String, std::time::Instant, Option<String>)>,
}
fn native(e: ::windows::core::Error) -> Error {
    err(format!("Windows: {e}"))
}

impl Windows {
    fn init(&mut self) -> Result<()> {
        if !self.initialized {
            unsafe {
                CoInitializeEx(None, COINIT_MULTITHREADED)
                    .ok()
                    .map_err(native)?;
            }
            self.initialized = true;
        }
        Ok(())
    }
    fn session(&mut self, id: &str) -> Result<Session> {
        self.init()?;
        let sessions = SessionManager::RequestAsync()
            .map_err(native)?
            .get()
            .map_err(native)?
            .GetSessions()
            .map_err(native)?;
        for session in sessions {
            if session.SourceAppUserModelId().map_err(native)? == id {
                return Ok(session);
            }
        }
        Err(err("Seçili medya oturumu kapandı"))
    }
}
impl Drop for Windows {
    fn drop(&mut self) {
        if self.initialized {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

impl Platform for Windows {
    fn context(&mut self, settings: &Settings) -> Result<Context> {
        self.init()?;
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return Ok(Context::default());
            }
            let mut text = vec![0u16; 4096];
            let count = GetWindowTextW(hwnd, &mut text);
            let title = String::from_utf16_lossy(&text[..count.max(0) as usize]);
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let mut app_id = String::new();
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buffer = vec![0u16; 32768];
                let mut length = buffer.len() as u32;
                if QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_WIN32,
                    ::windows::core::PWSTR(buffer.as_mut_ptr()),
                    &mut length,
                )
                .is_ok()
                {
                    app_id = String::from_utf16_lossy(&buffer[..length as usize]);
                }
                let _ = CloseHandle(handle);
            }
            let app = app_id
                .rsplit('\\')
                .next()
                .unwrap_or("")
                .trim_end_matches(".exe")
                .to_owned();
            let is_browser = browser_app(&app_id, &app);
            let mut url = None;
            // Address bar ValuePattern; browser extension is preferred for localized/virtual trees.
            if is_browser {
                if let Ok(automation) =
                    CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                {
                    if let Ok(root) = automation.ElementFromHandle(hwnd) {
                        if let Ok(condition) = automation.CreatePropertyCondition(
                            UIA_ControlTypePropertyId,
                            &::windows::core::VARIANT::from(UIA_EditControlTypeId.0),
                        ) {
                            if let Ok(elements) = root.FindAll(TreeScope_Descendants, &condition) {
                                for index in 0..elements.Length().unwrap_or(0).min(40) {
                                    if let Ok(element) = elements.GetElement(index) {
                                        let id = element
                                            .CurrentAutomationId()
                                            .unwrap_or_default()
                                            .to_string();
                                        let name = element
                                            .CurrentName()
                                            .unwrap_or_default()
                                            .to_string()
                                            .to_lowercase();
                                        if !(id == "addressEditBox"
                                            || id == "urlbar-input"
                                            || name.contains("address")
                                            || name.contains("adres"))
                                        {
                                            continue;
                                        }
                                        if let Ok(pattern) = element
                                            .GetCurrentPatternAs::<IUIAutomationValuePattern>(
                                                UIA_ValuePatternId,
                                            )
                                        {
                                            let value = pattern
                                                .CurrentValue()
                                                .unwrap_or_default()
                                                .to_string();
                                            if value.starts_with("https://")
                                                || value.starts_with("http://")
                                                || value.starts_with("file://")
                                            {
                                                url = Some(value);
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let other_audio = audio_active(settings).ok();
            Ok(Context {
                app,
                app_id,
                title,
                url,
                document: None,
                is_browser,
                other_audio,
                source: "Win32 / UIAutomation".into(),
            })
        }
    }
    fn permissions(&self) -> Permissions {
        Permissions { accessibility: true, automation: "Standart kullanıcı yeterlidir. Yükseltilmiş uygulamalar UIAutomation erişimini kısıtlayabilir.".into(), platform: "Windows".into(), capabilities: vec![
            Capability { name: "Aktif pencere".into(), available: true, detail: "GetForegroundWindow + UIAutomation; URL için eklenti önerilir".into() },
            Capability { name: "Medya kontrolü".into(), available: true, detail: "Windows.Media.Control; yalnızca seçili oturum".into() },
            Capability { name: "Diğer uygulama sesi".into(), available: true, detail: "WASAPI uygulama oturumları / peak meter".into() },
            Capability { name: "Yumuşak geçiş".into(), available: true, detail: "Spotify WASAPI oturum ses seviyesi; diğer GSMTC oynatıcılarında desteklenmez".into() },
        ] }
    }
    fn request_permission(&self, kind: &str) -> Result<()> {
        if matches!(kind, "accessibility" | "automation" | "settings") {
            Ok(())
        } else {
            Err(err("Bilinmeyen izin"))
        }
    }
    fn players(&mut self, settings: &Settings) -> Result<Vec<Player>> {
        self.init()?;
        let manager = SessionManager::RequestAsync()
            .map_err(native)?
            .get()
            .map_err(native)?;
        let mut result = Vec::new();
        for session in manager.GetSessions().map_err(native)? {
            let id = session.SourceAppUserModelId().map_err(native)?.to_string();
            let info = session.GetPlaybackInfo().map_err(native)?;
            let controls = info.Controls().map_err(native)?;
            let metadata = session
                .TryGetMediaPropertiesAsync()
                .map_err(native)?
                .get()
                .map_err(native)?;
            let volume = if id.to_lowercase().contains("spotify") {
                unsafe { spotify_volume(None).ok() }
            } else {
                None
            };
            let can_open_uri = false;
            let track_id = media_identity(&metadata);
            let playing = info.PlaybackStatus().map_err(native)? == Playback::Playing;
            let timeline = session.GetTimelineProperties().ok();
            let start = timeline
                .as_ref()
                .and_then(|t| t.StartTime().ok())
                .map_or(0.0, |t| t.Duration as f64 / 10_000_000.0);
            let duration = timeline
                .as_ref()
                .and_then(|t| t.EndTime().ok())
                .map(|t| t.Duration as f64 / 10_000_000.0 - start);
            let position = timeline.as_ref().and_then(|t| t.Position().ok()).map(|t| {
                let updated = timeline
                    .as_ref()
                    .and_then(|t| t.LastUpdatedTime().ok())
                    .map(|t| t.UniversalTime as f64 / 10_000_000.0 - 11_644_473_600.0);
                let elapsed = if playing {
                    updated.map_or(0.0, |at| (timestamp() - at).clamp(0.0, 604800.0))
                } else {
                    0.0
                };
                t.Duration as f64 / 10_000_000.0 - start
                    + elapsed * info.PlaybackRate().and_then(|r| r.Value()).unwrap_or(1.0)
            });
            let selected = (settings.provider == Provider::Spotify && is_spotify_id(&id))
                || id == settings.target_player;
            let artwork =
                if selected && !track_id.is_empty() {
                    let key = format!("{id}:{track_id}");
                    if !self.cover.as_ref().is_some_and(|c| {
                        c.0 == key && (c.2.is_some() || c.1.elapsed().as_secs() < 15)
                    }) {
                        self.cover = Some((key, std::time::Instant::now(), thumbnail(&metadata)));
                    }
                    self.cover.as_ref().and_then(|c| c.2.clone())
                } else {
                    None
                };
            result.push(Player {
                display_duration: None,
                name: id.clone(),
                id,
                playing: Some(info.PlaybackStatus().map_err(native)? == Playback::Playing),
                volume,
                track: metadata.Title().map_err(native)?.to_string(),
                artist: metadata.Artist().map_err(native)?.to_string(),
                can_play: controls.IsPlayEnabled().map_err(native)?,
                can_pause: controls.IsPauseEnabled().map_err(native)?,
                can_open_uri,
                track_id,
                artwork,
                duration,
                position,
                sampled_at: Some(timestamp()),
                can_seek: controls.IsPlaybackPositionEnabled().unwrap_or(false),
                can_next: controls.IsNextEnabled().unwrap_or(false),
                can_previous: controls.IsPreviousEnabled().unwrap_or(false),
            });
        }
        Ok(result)
    }
    fn play(&mut self, player: &str, uri: Option<&str>) -> Result<()> {
        if uri.is_some() {
            return Err(err(
                "Windows'ta liste başlatmak için Ayarlar → Spotify Web API bağlantısını kurun",
            ));
        }
        if !self
            .session(player)?
            .TryPlayAsync()
            .map_err(native)?
            .get()
            .map_err(native)?
        {
            return Err(err("Oynatıcı çalma isteğini reddetti"));
        }
        Ok(())
    }
    fn pause(&mut self, player: &str) -> Result<()> {
        if !self
            .session(player)?
            .TryPauseAsync()
            .map_err(native)?
            .get()
            .map_err(native)?
        {
            return Err(err("Oynatıcı duraklatma isteğini reddetti"));
        }
        Ok(())
    }
    fn volume(&mut self, player: &str, value: f64) -> Result<()> {
        if !player.to_lowercase().contains("spotify") {
            return Err(err("Bu oturumun ses kontrolü desteklenmiyor"));
        }
        unsafe {
            spotify_volume(Some(value as f32))?;
        }
        Ok(())
    }
    fn transport(&mut self, player: &str, action: &TransportAction) -> Result<()> {
        let session = self.session(player)?;
        let accepted = match action {
            TransportAction::Next => session.TrySkipNextAsync(),
            TransportAction::Previous => session.TrySkipPreviousAsync(),
            TransportAction::Seek { position, track_id } => {
                let metadata = session
                    .TryGetMediaPropertiesAsync()
                    .map_err(native)?
                    .get()
                    .map_err(native)?;
                if media_identity(&metadata) != *track_id {
                    return Err(err("Parça değişti; tekrar deneyin"));
                }
                let timeline = session.GetTimelineProperties().map_err(native)?;
                let target = timeline.StartTime().map_err(native)?.Duration
                    + (position * 10_000_000.0) as i64;
                if target < timeline.MinSeekTime().map_err(native)?.Duration
                    || target > timeline.MaxSeekTime().map_err(native)?.Duration
                {
                    return Err(err("Bu parçada konum değiştirme desteklenmiyor"));
                }
                session.TryChangePlaybackPositionAsync(target)
            }
        }
        .map_err(native)?
        .get()
        .map_err(native)?;
        if !accepted {
            return Err(err("Oynatıcı medya komutunu reddetti"));
        }
        Ok(())
    }
    fn media_key(&mut self) -> Result<()> {
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_MEDIA_PLAY_PAUSE,
                        ..Default::default()
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_MEDIA_PLAY_PAUSE,
                        dwFlags: KEYEVENTF_KEYUP,
                        ..Default::default()
                    },
                },
            },
        ];
        if unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) } != 2 {
            return Err(err("Medya tuşu gönderilemedi"));
        }
        Ok(())
    }
}

unsafe fn sessions() -> Result<IAudioSessionEnumerator> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(native)?;
    let device = enumerator
        .GetDefaultAudioEndpoint(eRender, eMultimedia)
        .map_err(native)?;
    let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).map_err(native)?;
    manager.GetSessionEnumerator().map_err(native)
}
unsafe fn process_name(pid: u32) -> String {
    if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
        let mut buffer = vec![0u16; 32768];
        let mut count = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            ::windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut count,
        );
        let _ = CloseHandle(handle);
        if result.is_ok() {
            return String::from_utf16_lossy(&buffer[..count as usize]).to_lowercase();
        }
    }
    String::new()
}
unsafe fn spotify_volume(value: Option<f32>) -> Result<f64> {
    let list = sessions()?;
    let mut result = None;
    for i in 0..list.GetCount().map_err(native)? {
        let session = list.GetSession(i).map_err(native)?;
        let details: IAudioSessionControl2 = session.cast().map_err(native)?;
        if !process_name(details.GetProcessId().map_err(native)?).ends_with("\\spotify.exe") {
            continue;
        }
        let volume: ISimpleAudioVolume = session.cast().map_err(native)?;
        if let Some(value) = value {
            volume
                .SetMasterVolume(value.clamp(0.0, 1.0), std::ptr::null())
                .map_err(native)?;
        }
        result = Some(volume.GetMasterVolume().map_err(native)? as f64);
    }
    result.ok_or_else(|| err("Spotify ses oturumu bulunamadı"))
}
unsafe fn audio_active(settings: &Settings) -> Result<bool> {
    let list = sessions()?;
    for i in 0..list.GetCount().map_err(native)? {
        let session = list.GetSession(i).map_err(native)?;
        let details: IAudioSessionControl2 = session.cast().map_err(native)?;
        let pid = details.GetProcessId().map_err(native)?;
        if pid == std::process::id() || pid == 0 {
            continue;
        }
        let name = process_name(pid);
        if settings.provider == Provider::Spotify && name.ends_with("\\spotify.exe") {
            continue;
        }
        // Non-Spotify sources have no stable GSMTC->PID mapping; session-state detection is used by runtime.
        if settings.provider == Provider::System {
            return Err(err("GSMTC oturum algılaması kullanılıyor"));
        }
        if let Ok(meter) = session.cast::<IAudioMeterInformation>() {
            if meter.GetPeakValue().map_err(native)? > 0.001 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn media_identity(
    metadata: &::windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> String {
    let title = metadata.Title().unwrap_or_default().to_string();
    if title.is_empty() {
        return String::new();
    }
    format!(
        "{}|{}|{}",
        title,
        metadata.Artist().unwrap_or_default(),
        metadata.AlbumTitle().unwrap_or_default()
    )
}
fn thumbnail(
    metadata: &::windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    use ::windows::Storage::Streams::DataReader;
    let stream = metadata
        .Thumbnail()
        .ok()?
        .OpenReadAsync()
        .ok()?
        .get()
        .ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > crate::artwork::MAX_BYTES as u64 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    let count = reader.LoadAsync(size as u32).ok()?.get().ok()?;
    let mut bytes = vec![0; count as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    crate::artwork::data_uri(&bytes)
}
