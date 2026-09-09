use super::*;
use crate::{config::spotify_uri, process};
use std::{
    ffi::{c_char, CStr, CString},
    time::{Duration, Instant},
};

unsafe extern "C" {
    fn mo_context(excluded: *const c_char) -> *mut c_char;
    fn mo_accessibility() -> bool;
    fn mo_audio_supported() -> bool;
    fn mo_request_accessibility();
    fn mo_media_key();
    fn mo_spotify_play(uri: *const c_char) -> i32;
    fn mo_free(pointer: *mut c_char);
}

#[derive(Default)]
pub struct MacOs {
    browser_cache: Option<(String, String, Instant, Option<String>)>,
    automation: String,
}

fn script(code: &str, args: &[&str]) -> Result<String> {
    let mut command = vec!["-l", "JavaScript", "-e", code];
    command.extend_from_slice(args);
    process::run("/usr/bin/osascript", &command, Duration::from_secs(4))
}

impl Platform for MacOs {
    fn context(&mut self, settings: &Settings) -> Result<Context> {
        let excluded = if settings.provider == Provider::Spotify {
            "com.spotify.client"
        } else {
            &settings.target_player
        };
        let excluded = CString::new(excluded).map_err(|_| err("Geçersiz oynatıcı kimliği"))?;
        // Native returns an owned UTF-8 JSON buffer; copy before releasing it exactly once.
        let mut context: Context = unsafe {
            let pointer = mo_context(excluded.as_ptr());
            if pointer.is_null() {
                return Err(err("Aktif pencere okunamadı"));
            }
            let parsed = serde_json::from_slice(CStr::from_ptr(pointer).to_bytes());
            mo_free(pointer);
            parsed?
        };
        context.is_browser = browser_app(&context.app_id, &context.app);
        // Fixed allowlist: user data is passed as argv, never interpolated into scripts.
        if matches!(
            context.app_id.as_str(),
            "com.apple.Safari"
                | "com.google.Chrome"
                | "com.brave.Browser"
                | "com.microsoft.edgemac"
                | "com.vivaldi.Vivaldi"
                | "company.thebrowser.Browser"
        ) {
            let cached = self.browser_cache.as_ref().filter(|(id, title, time, _)| {
                id == &context.app_id
                    && title == &context.title
                    && time.elapsed() < Duration::from_secs(3)
            });
            if let Some((_, _, _, url)) = cached {
                context.url = url.clone().or(context.url);
            } else {
                let result = script("function run(a) { const b=Application(a[0]); if(!b.running() || b.windows.length===0)return ''; return a[0]==='com.apple.Safari' ? b.windows[0].currentTab.url() : b.windows[0].activeTab.url(); }", &[&context.app_id]);
                let url = match result {
                    Ok(u) if !u.is_empty() => Some(u),
                    Ok(_) => None,
                    Err(e) => {
                        self.automation = e.to_string();
                        None
                    }
                };
                self.browser_cache = Some((
                    context.app_id.clone(),
                    context.title.clone(),
                    Instant::now(),
                    url.clone(),
                ));
                context.url = url.or(context.url);
            }
        }
        Ok(context)
    }
    fn permissions(&self) -> Permissions {
        Permissions {
            accessibility: unsafe { mo_accessibility() },
            automation: if self.automation.is_empty() {
                "Spotify ve tarayıcı erişimi ilk kullanımda macOS tarafından sorulur".into()
            } else {
                self.automation.clone()
            },
            platform: "macOS".into(),
            capabilities: vec![
                Capability {
                    name: "Aktif uygulama".into(),
                    available: true,
                    detail: "NSWorkspace; pencere ve dosya için Erişilebilirlik izni".into(),
                },
                Capability {
                    name: "Tarayıcı sekmesi".into(),
                    available: true,
                    detail: "Safari/Chromium: Automation izni; Firefox: tarayıcı eklentisi".into(),
                },
                Capability {
                    name: "Diğer uygulama sesi".into(),
                    available: unsafe { mo_audio_supported() },
                    detail:
                        "macOS 14.2+ CoreAudio çıkış oturumları; sessiz akış da aktif sayılabilir"
                            .into(),
                },
                Capability {
                    name: "Yumuşak geçiş".into(),
                    available: true,
                    detail: "Spotify ve Apple Music uygulama ses seviyesi".into(),
                },
            ],
        }
    }
    fn request_permission(&self, kind: &str) -> Result<()> {
        match kind {
            "accessibility" => {
                unsafe {
                    mo_request_accessibility();
                }
                Ok(())
            }
            "automation" => {
                script("function run(){ const s=Application('com.spotify.client'); return s.running() ? s.playerState() : 'Spotify uygulamasını açın'; }", &[])?;
                Ok(())
            }
            "settings" => {
                process::run("/usr/bin/open", &["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"], Duration::from_secs(2))?;
                Ok(())
            }
            _ => Err(err("Bilinmeyen izin")),
        }
    }
    fn players(&mut self, _: &Settings) -> Result<Vec<Player>> {
        let output = script(
            r#"function run(){ let result=[]; for(const id of ['com.spotify.client','com.apple.Music']) { const a=Application(id); if(!a.running())continue; const state=a.playerState(); let name='',artist=''; try { name=a.currentTrack.name();artist=a.currentTrack.artist(); }catch(_){} result.push({id:id,name:id==='com.spotify.client'?'Spotify':'Apple Music',playing:state==='playing',volume:a.soundVolume()/100,track:name,artist:artist,canPlay:true,canPause:true,canOpenUri:id==='com.spotify.client'}); }return JSON.stringify(result); }"#,
            &[],
        );
        match output {
            Ok(output) => {
                self.automation.clear();
                Ok(serde_json::from_str(&output)?)
            }
            Err(e) => {
                self.automation = e.to_string();
                Err(e)
            }
        }
    }
    fn play(&mut self, player: &str, uri: Option<&str>) -> Result<()> {
        ensure_player(player)?;
        if let Some(uri) = uri {
            if player != "com.spotify.client" {
                return Err(err("Bu oynatıcı liste açmayı desteklemiyor"));
            }
            let uri =
                CString::new(spotify_uri(uri)?).map_err(|_| err("Spotify bağlantısı geçersiz"))?;
            // A direct, non-interactive Apple Event to the running PID avoids
            // script bridge launch/reopen behavior and never opens a Spotify URL.
            let code = unsafe { mo_spotify_play(uri.as_ptr()) };
            match code {
                0 => (),
                -600 => return Err(err("Spotify uygulamasını açıp hesabına giriş yapın")),
                -1743 | -1744 => return Err(err("Spotify kontrol izni gerekli. System Settings → Privacy & Security → Automation bölümünde Deskody için Spotify iznini açın.")),
                -1712 => return Err(err("Spotify oynatma komutuna zamanında yanıt vermedi")),
                _ => return Err(err(format!("Spotify içeriği başlatılamadı (Apple Event {code}). Oturumunu ve içerik erişimini kontrol et."))),
            }
        } else {
            script("function run(a){ const s=Application(a[0]); if(!s.running())throw Error('Oynatıcı kapalı'); s.play(); }", &[player])?;
        }
        Ok(())
    }
    fn pause(&mut self, player: &str) -> Result<()> {
        ensure_player(player)?;
        script(
            "function run(a){ const s=Application(a[0]); if(s.running())s.pause(); }",
            &[player],
        )?;
        Ok(())
    }
    fn volume(&mut self, player: &str, value: f64) -> Result<()> {
        ensure_player(player)?;
        let value = (value.clamp(0.0, 1.0) * 100.0).round().to_string();
        script("function run(a){ const s=Application(a[0]); if(s.running())s.soundVolume=Number(a[1]); }", &[player, &value])?;
        Ok(())
    }
    fn media_key(&mut self) -> Result<()> {
        if !unsafe { mo_accessibility() } {
            return Err(err("Medya tuşu için Erişilebilirlik izni gerekli"));
        }
        unsafe {
            mo_media_key();
        }
        Ok(())
    }
}
fn ensure_player(player: &str) -> Result<()> {
    if matches!(player, "com.spotify.client" | "com.apple.Music") {
        Ok(())
    } else {
        Err(err(
            "Bu macOS oynatıcısı doğrudan kontrol edilemiyor; manuel medya tuşunu kullanın",
        ))
    }
}
