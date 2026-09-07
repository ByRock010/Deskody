use crate::{
    model::Settings,
    runtime::{QuickChange, Service, Snapshot},
};
#[cfg(not(target_os = "macos"))]
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
#[cfg(not(target_os = "macos"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State,
};

#[cfg(not(target_os = "macos"))]
#[derive(Default)]
struct PanelState(Mutex<Option<Instant>>);

#[cfg(target_os = "macos")]
mod mac_menu {
    use super::*;
    use std::{
        ffi::{c_char, c_void, CStr, CString},
        sync::OnceLock,
    };
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    unsafe extern "C" {
        pub fn deskody_menu_create(
            item: *mut c_void,
            callback: unsafe extern "C" fn(*const c_char, *const c_char, bool),
        ) -> bool;
        pub fn deskody_menu_hide();
        pub fn deskody_menu_destroy();
        fn deskody_menu_snapshot(json: *const c_char);
        fn deskody_menu_result(error: *const c_char);
    }
    pub fn initialize(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
    }
    pub fn publish(snapshot: &Snapshot) {
        if let Some(json) = serde_json::to_string(snapshot)
            .ok()
            .and_then(|s| CString::new(s).ok())
        {
            unsafe {
                deskody_menu_snapshot(json.as_ptr());
            }
        }
    }
    pub unsafe extern "C" fn action(action: *const c_char, rule: *const c_char, enabled: bool) {
        if action.is_null() || rule.is_null() {
            return;
        }
        let Some(app) = APP.get().cloned() else {
            return;
        };
        // Native callback strings are valid for this call only; copy before spawning.
        let action = unsafe { CStr::from_ptr(action) }
            .to_string_lossy()
            .into_owned();
        let rule = unsafe { CStr::from_ptr(rule) }
            .to_string_lossy()
            .into_owned();
        if action == "open" {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || show(&handle));
            return;
        }
        if action == "refresh" {
            app.state::<Service>().refresh();
            return;
        }
        tauri::async_runtime::spawn(async move {
            let service = app.state::<Service>();
            if action == "quit" {
                service.stop().await;
                app.exit(0);
                return;
            }
            let result = match action.as_str() {
                "enabled" => service
                    .quick_change(QuickChange::Enabled { enabled })
                    .await
                    .map(|_| ()),
                "rule" => service
                    .quick_change(QuickChange::Rule { id: rule, enabled })
                    .await
                    .map(|_| ()),
                "play" | "pause" | "resumeAutomation" => service.media(action).await,
                _ => Err(crate::model::err("Bilinmeyen menü komutu")),
            };
            if let Ok(snapshot) = service.get() {
                publish(&snapshot);
            }
            let error = result
                .err()
                .map(|e| CString::new(e.to_string().replace('\0', "")).unwrap_or_default());
            unsafe {
                deskody_menu_result(error.as_ref().map_or(std::ptr::null(), |s| s.as_ptr()));
            }
        });
    }
}

#[tauri::command]
async fn quick_change(
    change: QuickChange,
    service: State<'_, Service>,
) -> Result<Settings, String> {
    service
        .quick_change(change)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_main(app: tauri::AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || show(&handle))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn close_panel(app: tauri::AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || hide_panel(&handle))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn quit_app(app: tauri::AppHandle) {
    app.state::<Service>().stop().await;
    app.exit(0);
}

#[cfg(target_os = "macos")]
fn hide_panel(_: &tauri::AppHandle) {
    // Called exclusively by setup/window/tray events or run_on_main_thread.
    unsafe {
        mac_menu::deskody_menu_hide();
    }
}

#[cfg(not(target_os = "macos"))]
fn hide_panel(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("tray-panel") {
        if window.is_visible().unwrap_or(false) {
            if let Ok(mut closed) = app.state::<PanelState>().0.lock() {
                *closed = Some(Instant::now());
            }
            let _ = window.hide();
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn toggle_panel(app: &tauri::AppHandle, rect: Option<tauri::Rect>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("tray-panel") else {
        return Ok(());
    };
    if window.is_visible()? {
        hide_panel(app);
        return Ok(());
    }
    // Clicking the tray can send blur before mouse-up; do not reopen on that click.
    if app
        .state::<PanelState>()
        .0
        .lock()
        .ok()
        .and_then(|closed| *closed)
        .is_some_and(|t| t.elapsed() < Duration::from_millis(250))
    {
        return Ok(());
    }
    let fallback = app.primary_monitor()?;
    let monitor = if let Some(rect) = rect {
        let scale = fallback.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
        let position = rect.position.to_physical::<f64>(scale);
        app.monitor_from_point(position.x, position.y)?.or(fallback)
    } else {
        fallback
    };
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let margin = 8.0 * scale;
        let width = (380.0 * scale).min((area.size.width as f64 - 2.0 * margin).max(1.0));
        let height = (580.0 * scale).min((area.size.height as f64 - 2.0 * margin).max(1.0));
        let left = area.position.x as f64 + margin;
        let top = area.position.y as f64 + margin;
        let right = (area.position.x as f64 + area.size.width as f64 - width - margin).max(left);
        let bottom = (area.position.y as f64 + area.size.height as f64 - height - margin).max(top);
        let (x, y) = rect
            .map(|rect| {
                let pos = rect.position.to_physical::<f64>(scale);
                let size = rect.size.to_physical::<f64>(scale);
                let below = pos.y + size.height + margin;
                let y = if below + height <= area.position.y as f64 + area.size.height as f64 {
                    below
                } else {
                    pos.y - height - margin
                };
                (
                    (pos.x + size.width / 2.0 - width / 2.0).clamp(left, right),
                    y.clamp(top, bottom),
                )
            })
            .unwrap_or((right, top));
        window.set_size(tauri::PhysicalSize::new(width as u32, height as u32))?;
        window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32))?;
    }
    window.show()?;
    window.set_focus()?;
    // A disabled engine polls slowly, so opening the panel requests fresh player state.
    app.state::<Service>().refresh();
    Ok(())
}

#[tauri::command]
async fn list_applications() -> Result<Vec<crate::model::InstalledApplication>, String> {
    tauri::async_runtime::spawn_blocking(crate::applications::list)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn get_snapshot(service: State<'_, Service>) -> Result<Snapshot, String> {
    service.get().map_err(|e| e.to_string())
}
#[tauri::command]
async fn save_settings(
    settings: Settings,
    service: State<'_, Service>,
) -> Result<Settings, String> {
    service.save(settings).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn request_permission(
    kind: String,
    service: State<'_, Service>,
) -> Result<crate::model::Permissions, String> {
    service.permission(kind).await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn media_action(action: String, service: State<'_, Service>) -> Result<(), String> {
    service.media(action).await.map_err(|e| e.to_string())
}
#[tauri::command]
fn refresh_status(service: State<'_, Service>) {
    service.refresh();
}
#[tauri::command]
fn get_pairing_token(service: State<'_, Service>) -> Result<String, String> {
    service
        .bridge
        .lock()
        .map(|b| b.token())
        .map_err(|_| "Kilit hatası".into())
}

#[tauri::command]
async fn spotify_connect(disconnect: bool, service: State<'_, Service>) -> Result<(), String> {
    let id = service
        .get()
        .map_err(|e| e.to_string())?
        .settings
        .spotify_client_id;
    tauri::async_runtime::spawn_blocking(move || {
        if disconnect {
            crate::spotify::logout(&id)
        } else {
            crate::spotify::login(&id)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    service.refresh();
    Ok(())
}

fn show(app: &tauri::AppHandle) {
    hide_panel(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if let Some(service) = app.try_state::<Service>() {
        service.refresh();
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || show(&handle));
        }))
        .invoke_handler(tauri::generate_handler![
            quick_change,
            open_main,
            close_panel,
            quit_app,
            get_snapshot,
            list_applications,
            save_settings,
            request_permission,
            media_action,
            refresh_status,
            get_pairing_token,
            spotify_connect
        ])
        .setup(|app| {
            #[cfg(not(target_os = "macos"))]
            {
                app.manage(PanelState::default());
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == "tray-panel")
                    .ok_or("Hızlı panel yapılandırması bulunamadı")?;
                tauri::WebviewWindowBuilder::from_config(app, config)?.build()?;
            }
            #[cfg(target_os = "macos")]
            mac_menu::initialize(app.handle());
            let handle = app.handle().clone();
            let directory = std::env::var_os("DESKODY_CONFIG_DIR")
                .or_else(|| std::env::var_os("MUSIC_OPTIMIZER_CONFIG_DIR"))
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_config_dir()?);
            let first_run = !directory.join("settings.json").exists();
            let service = Service::start(directory, move |snapshot| {
                #[cfg(target_os = "macos")]
                mac_menu::publish(&snapshot);
                let _ = handle.emit("deskody://status", snapshot);
            })?;
            let bridge = service.bridge.clone();
            app.manage(service);
            tauri::async_runtime::spawn(crate::browser::serve(bridge));
            let panel = MenuItem::with_id(app, "panel", "Hızlı kontrol", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Deskody’yi aç", true, None::<&str>)?;
            let toggle =
                MenuItem::with_id(app, "toggle", "Otomasyonu aç / kapat", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&panel, &toggle, &open, &quit])?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            let tray = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("Deskody")
                .menu(&menu)
                .show_menu_on_left_click(cfg!(target_os = "macos"))
                .on_menu_event(|app, event| match event.id.as_ref() {
                    #[cfg(not(target_os = "macos"))]
                    "panel" => {
                        let rect = app
                            .tray_by_id("main-tray")
                            .and_then(|tray| tray.rect().ok().flatten());
                        if let Err(error) = toggle_panel(app, rect) {
                            eprintln!("Hızlı panel: {error}");
                        }
                    }
                    "open" => show(app),
                    "toggle" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let service = handle.state::<Service>();
                            let _ = service.quick_change(QuickChange::ToggleEnabled).await;
                        });
                    }
                    "quit" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            handle.state::<Service>().stop().await;
                            handle.exit(0);
                        });
                    }
                    _ => (),
                })
                .on_tray_icon_event(|_tray, _event| {
                    #[cfg(not(target_os = "macos"))]
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = _event
                    {
                        if let Err(error) = toggle_panel(_tray.app_handle(), Some(rect)) {
                            eprintln!("Hızlı panel: {error}");
                        }
                    }
                })
                .build(app)?;
            #[cfg(target_os = "macos")]
            {
                mac_menu::publish(&app.state::<Service>().get()?);
                let attached = tray.with_inner_tray_icon(|tray| {
                    tray.ns_status_item().is_some_and(|item| unsafe {
                        mac_menu::deskody_menu_create(
                            &*item as *const _ as *mut std::ffi::c_void,
                            mac_menu::action,
                        )
                    })
                })?;
                if !attached {
                    return Err("macOS menüsü oluşturulamadı".into());
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = tray;
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            if first_run {
                show(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(target_os = "macos"))]
            if window.label() == "tray-panel" && matches!(event, tauri::WindowEvent::Focused(false))
            {
                hide_panel(window.app_handle());
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Deskody başlatılamadı");
    app.run(|handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => show(handle),
        tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            api.prevent_exit();
            let handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                handle.state::<Service>().stop().await;
                handle.exit(0);
            });
        }
        tauri::RunEvent::Exit => {
            #[cfg(target_os = "macos")]
            unsafe {
                mac_menu::deskody_menu_destroy();
            }
            handle.state::<Service>().shutdown();
        }
        _ => (),
    });
}
