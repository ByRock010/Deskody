//! The control tool bundled with Spotify for macOS. No URL activation or OAuth.
use crate::{config::spotify_uri, model::*, process};
use serde::Deserialize;
use std::{
    ffi::{c_char, CStr},
    time::Duration,
};

unsafe extern "C" {
    fn mo_spotify_cli_path(output: *mut *mut c_char) -> i32;
    fn mo_free(pointer: *mut c_char);
}

pub fn play(uri: &str) -> Result<()> {
    // Validate before running any command, even when called outside the engine.
    let uri = spotify_uri(uri)?;
    let mut pointer = std::ptr::null_mut();
    let code = unsafe { mo_spotify_cli_path(&mut pointer) };
    match code {
        0 if !pointer.is_null() => (),
        -600 => return Err(err("Spotify masaüstü uygulamasını açıp hesabına giriş yapın")),
        -43 => return Err(err("Spotify’ın bu sürümünde arka plan kontrol aracı yok. Spotify masaüstü uygulamasını güncelleyip yeniden açın.")),
        _ => return Err(err(format!("Spotify arka plan kontrol aracı bulunamadı ({code})"))),
    }
    let path = unsafe {
        let path = CStr::from_ptr(pointer).to_str().map(str::to_owned);
        mo_free(pointer);
        path.map_err(|_| err("Spotify uygulama yolu okunamadı"))?
    };
    play_with(&uri, |args| {
        process::run(&path, args, Duration::from_secs(4))
            .map_err(|e| err(format!("Spotify arka plan komutu başarısız: {e}")))
    })
}

#[derive(Deserialize)]
struct Devices {
    active_device_id: Option<String>,
    devices: Vec<Device>,
}
#[derive(Deserialize)]
struct Device {
    device_id: String,
    is_self: bool,
}

fn local_device(json: &str) -> Result<(String, bool)> {
    let devices: Devices = serde_json::from_str(json)
        .map_err(|_| err("Spotify cihaz bilgisi okunamadı. Spotify’ı güncelleyip yeniden açın."))?;
    let mut local = devices.devices.iter().filter(|d| d.is_self);
    let device = local.next().ok_or_else(|| err("Bu Mac’in Spotify oturumu bulunamadı. Spotify’da hesabına giriş yapıp bir kez Çal’a bas."))?;
    if local.next().is_some()
        || !device
            .device_id
            .starts_with(|c: char| c.is_ascii_alphanumeric())
        || device.device_id.len() > 256
        || !device
            .device_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(err("Spotify yerel cihaz kimliği doğrulanamadı"));
    }
    Ok((
        device.device_id.clone(),
        devices.active_device_id.as_deref() == Some(&device.device_id),
    ))
}

fn play_with(uri: &str, mut run: impl FnMut(&[&str]) -> Result<String>) -> Result<()> {
    let uri = spotify_uri(uri)?;
    let (local, active) = local_device(&run(&["devices", "list", "--format", "json"])?)?;
    if !active {
        // In Spotify CLI 1.2.99, `play URI --device ID` only transfers playback
        // and ignores URI. Transfer explicitly, confirm the local target, then play.
        run(&["devices", "transfer", &local, "--format", "json"])?;
        let (confirmed, active) = local_device(&run(&["devices", "list", "--format", "json"])?)?;
        if confirmed != local || !active {
            return Err(err(
                "Oynatma bu Mac’e aktarılamadı. Spotify’da cihaz olarak bu bilgisayarı seçin.",
            ));
        }
    }
    // A successful play returns empty stdout (even with --format json).
    // Never fall back to PCtx/open: those activate Spotify on affected versions.
    let response = run(&["play", &uri, "--format", "json"])?;
    if !response.trim().is_empty() {
        return Err(err(
            "Spotify beklenmeyen bir oynatma yanıtı verdi. Spotify’ı güncelleyip yeniden açın.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const URI: &str = "spotify:track:4LhgwcTWwJQc6DFTkLXVEc";
    fn devices(active: &str) -> String {
        serde_json::json!({"active_device_id":active,"devices":[
            {"device_id":"remote","is_self":false},
            {"device_id":"local","is_self":true}
        ]})
        .to_string()
    }
    #[test]
    fn plays_canonical_target_on_local_desktop_without_transfer_when_already_active() {
        let mut calls = Vec::new();
        play_with(
            "https://open.spotify.com/track/4LhgwcTWwJQc6DFTkLXVEc?si=test",
            |args| {
                calls.push(args.iter().map(|s| s.to_string()).collect::<Vec<_>>());
                Ok(if calls.len() == 1 {
                    devices("local")
                } else {
                    String::new()
                })
            },
        )
        .unwrap();
        assert_eq!(
            calls,
            vec![
                vec!["devices", "list", "--format", "json"],
                vec!["play", URI, "--format", "json"]
            ]
        );
    }
    #[test]
    fn transfers_and_confirms_local_device_before_playing() {
        let mut calls = Vec::new();
        play_with(URI, |args| {
            calls.push(args.iter().map(|s| s.to_string()).collect::<Vec<_>>());
            Ok(match calls.len() {
                1 => devices("remote"),
                2 => "Playback transferred".into(),
                3 => devices("local"),
                _ => String::new(),
            })
        })
        .unwrap();
        assert_eq!(
            calls[1],
            ["devices", "transfer", "local", "--format", "json"]
        );
        assert_eq!(calls[2], ["devices", "list", "--format", "json"]);
        assert_eq!(calls[3], ["play", URI, "--format", "json"]);
    }
    #[test]
    fn unconfirmed_transfer_never_plays_on_remote_device() {
        let mut calls = 0;
        assert!(play_with(URI, |args| {
            calls += 1;
            assert_ne!(args[0], "play");
            Ok(devices("remote"))
        })
        .is_err());
        assert_eq!(calls, 3);
    }
    #[test]
    fn invalid_or_missing_or_ambiguous_local_device_fails_closed() {
        for json in [
            "{}",
            "not json",
            r#"{"devices":[]}"#,
            r#"{"devices":[{"device_id":"remote","is_self":false}]}"#,
            r#"{"devices":[{"device_id":"--bad","is_self":true}]}"#,
            r#"{"devices":[{"device_id":"x","is_self":true},{"device_id":"y","is_self":true}]}"#,
        ] {
            let mut calls = 0;
            assert!(play_with(URI, |_| {
                calls += 1;
                Ok(json.into())
            })
            .is_err());
            assert_eq!(calls, 1);
        }
    }
    #[test]
    fn invalid_uri_does_not_run_any_process() {
        assert!(play_with("https://example.com/track/x", |_| panic!(
            "must not execute"
        ))
        .is_err());
    }
    #[test]
    fn command_errors_stop_without_url_or_apple_event_fallback() {
        for fail_at in 1..=4 {
            let mut calls = 0;
            let error = play_with(URI, |_| {
                calls += 1;
                if calls == fail_at {
                    return Err(err("timeout / permission / exit failure"));
                }
                Ok(if calls < 3 {
                    devices("remote")
                } else {
                    devices("local")
                })
            })
            .unwrap_err();
            assert!(error.to_string().contains("timeout"));
            assert_eq!(calls, fail_at);
        }
    }
    #[test]
    fn unexpected_success_output_is_not_a_play_acknowledgement() {
        let mut calls = 0;
        assert!(play_with(URI, |_| {
            calls += 1;
            Ok(if calls == 1 {
                devices("local")
            } else {
                r#"{"error":"not logged in"}"#.into()
            })
        })
        .is_err());
        assert_eq!(calls, 2);
    }
}
