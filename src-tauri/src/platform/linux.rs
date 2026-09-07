use super::*;
use crate::process;
use std::time::Duration;
use x11rb::{connection::Connection as XConnection, protocol::xproto::ConnectionExt};
use zbus::blocking::{Connection, Proxy};

#[derive(Default)]
pub struct Linux {
    bus: Option<Connection>,
    x11: Option<(x11rb::rust_connection::RustConnection, usize)>,
}
fn native(e: impl std::fmt::Display) -> Error {
    err(format!("Linux: {e}"))
}
impl Linux {
    fn bus(&mut self) -> Result<&Connection> {
        if self.bus.is_none() {
            self.bus = Some(
                zbus::blocking::connection::Builder::session()
                    .map_err(native)?
                    .method_timeout(Duration::from_secs(2))
                    .build()
                    .map_err(native)?,
            );
        }
        self.bus.as_ref().ok_or_else(|| err("D-Bus oturumu yok"))
    }
    fn player<'a>(&'a mut self, id: &'a str) -> Result<Proxy<'a>> {
        if !id.starts_with("org.mpris.MediaPlayer2.") {
            return Err(err("Geçersiz MPRIS kimliği"));
        }
        Proxy::new(
            self.bus()?,
            id,
            "/org/mpris/MediaPlayer2",
            "org.mpris.MediaPlayer2.Player",
        )
        .map_err(native)
    }
    fn x_context(&mut self) -> Result<Context> {
        if self.x11.is_none() {
            self.x11 = Some(x11rb::connect(None).map_err(native)?);
        }
        let (connection, screen) = self.x11.as_ref().ok_or_else(|| err("X11 bağlantısı yok"))?;
        let atom = |name: &[u8]| -> Result<u32> {
            Ok(connection
                .intern_atom(false, name)
                .map_err(native)?
                .reply()
                .map_err(native)?
                .atom)
        };
        let get = |window: u32, name: &[u8]| -> Result<x11rb::protocol::xproto::GetPropertyReply> {
            connection
                .get_property(
                    false,
                    window,
                    atom(name)?,
                    x11rb::protocol::xproto::AtomEnum::ANY,
                    0,
                    4096,
                )
                .map_err(native)?
                .reply()
                .map_err(native)
        };
        let root = connection.setup().roots[*screen].root;
        let window = get(root, b"_NET_ACTIVE_WINDOW")?
            .value32()
            .and_then(|mut x| x.next())
            .unwrap_or(0);
        if window == 0 {
            return Ok(Context::default());
        }
        let title = get(window, b"_NET_WM_NAME").or_else(|_| get(window, b"WM_NAME"))?;
        let class = get(window, b"WM_CLASS")?;
        let names: Vec<_> = class
            .value
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).to_string())
            .collect();
        let app_id = names.first().cloned().unwrap_or_default();
        let app = names.last().cloned().unwrap_or_default();
        Ok(Context {
            is_browser: browser_app(&app_id, &app),
            app,
            app_id,
            title: String::from_utf8_lossy(&title.value).to_string(),
            source: "X11 / EWMH".into(),
            ..Context::default()
        })
    }
}

fn sway_focused(value: &serde_json::Value) -> Option<&serde_json::Value> {
    if value["focused"].as_bool() == Some(true) && value["type"].as_str() == Some("con") {
        return Some(value);
    }
    for key in ["nodes", "floating_nodes"] {
        if let Some(nodes) = value[key].as_array() {
            for child in nodes {
                if let Some(found) = sway_focused(child) {
                    return Some(found);
                }
            }
        }
    }
    None
}

impl Platform for Linux {
    fn context(&mut self, _: &Settings) -> Result<Context> {
        if std::env::var_os("WAYLAND_DISPLAY").is_none() {
            return self.x_context();
        }
        let (app, title, source) = if std::env::var_os("SWAYSOCK").is_some() {
            let text = process::run("swaymsg", &["-t", "get_tree", "-r"], Duration::from_secs(2))?;
            let tree: serde_json::Value = serde_json::from_str(&text)?;
            let node = sway_focused(&tree).ok_or_else(|| err("Sway aktif penceresi bulunamadı"))?;
            (
                node["app_id"]
                    .as_str()
                    .or(node["window_properties"]["class"].as_str())
                    .unwrap_or("")
                    .to_owned(),
                node["name"].as_str().unwrap_or("").to_owned(),
                "Wayland / Sway",
            )
        } else if std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some() {
            let text = process::run("hyprctl", &["activewindow", "-j"], Duration::from_secs(2))?;
            let node: serde_json::Value = serde_json::from_str(&text)?;
            (
                node["class"].as_str().unwrap_or("").to_owned(),
                node["title"].as_str().unwrap_or("").to_owned(),
                "Wayland / Hyprland",
            )
        } else {
            return Err(err("Bu Wayland compositor'ı aktif pencere paylaşmıyor. Tarayıcı eklentisiyle sekme kurallarını kullanabilirsiniz; uygulama kuralları için X11/Sway/Hyprland gerekir."));
        };
        Ok(Context {
            is_browser: browser_app(&app, &app),
            app_id: app.clone(),
            app,
            title,
            source: source.into(),
            ..Context::default()
        })
    }
    fn permissions(&self) -> Permissions {
        let focus = std::env::var_os("WAYLAND_DISPLAY").is_none()
            || std::env::var_os("SWAYSOCK").is_some()
            || std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some();
        Permissions {
            accessibility: focus,
            automation: "Root gerekmez. D-Bus kullanıcı oturumu ve masaüstü tray desteği gerekir."
                .into(),
            platform: "Linux".into(),
            capabilities: vec![
                Capability {
                    name: "Aktif pencere".into(),
                    available: focus,
                    detail: "X11, Sway ve Hyprland; diğer Wayland ortamlarında eklenti".into(),
                },
                Capability {
                    name: "Medya kontrolü".into(),
                    available: true,
                    detail: "MPRIS / D-Bus; Spotify ve destekleyen tarayıcı/PWA'lar".into(),
                },
                Capability {
                    name: "Diğer medya".into(),
                    available: true,
                    detail: "MPRIS Playing durumu + tarayıcı eklentisi; ham sistem sesi ölçülmez"
                        .into(),
                },
                Capability {
                    name: "Yumuşak geçiş".into(),
                    available: true,
                    detail: "MPRIS Volume özelliğini destekleyen oynatıcılar".into(),
                },
            ],
        }
    }
    fn request_permission(&self, kind: &str) -> Result<()> {
        if matches!(kind, "settings" | "accessibility" | "automation") {
            Ok(())
        } else {
            Err(err("Bilinmeyen izin"))
        }
    }
    fn players(&mut self, _: &Settings) -> Result<Vec<Player>> {
        let bus = self.bus()?;
        let dbus = Proxy::new(
            bus,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
        )
        .map_err(native)?;
        let names: Vec<String> = dbus.call("ListNames", &()).map_err(native)?;
        let mut result = Vec::new();
        for id in names
            .into_iter()
            .filter(|n| n.starts_with("org.mpris.MediaPlayer2."))
            .take(32)
        {
            let proxy = match Proxy::new(
                bus,
                id.as_str(),
                "/org/mpris/MediaPlayer2",
                "org.mpris.MediaPlayer2.Player",
            ) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let state: String = match proxy.get_property("PlaybackStatus") {
                Ok(p) => p,
                Err(_) => continue,
            };
            let metadata = proxy
                .get_property::<std::collections::HashMap<String, zbus::zvariant::OwnedValue>>(
                    "Metadata",
                )
                .unwrap_or_default();
            let track = metadata
                .get("xesam:title")
                .and_then(|v| <&str>::try_from(v).ok())
                .unwrap_or("")
                .to_owned();
            let artist = metadata
                .get("xesam:artist")
                .and_then(|v| v.try_clone().ok())
                .and_then(|v| Vec::<String>::try_from(v).ok())
                .unwrap_or_default()
                .join(", ");
            let root = Proxy::new(
                bus,
                id.as_str(),
                "/org/mpris/MediaPlayer2",
                "org.mpris.MediaPlayer2",
            )
            .map_err(native)?;
            result.push(Player {
                name: root.get_property("Identity").unwrap_or_else(|_| id.clone()),
                playing: Some(state == "Playing"),
                volume: proxy
                    .get_property::<f64>("Volume")
                    .ok()
                    .filter(|v| v.is_finite() && (0.0..=1.0).contains(v)),
                track,
                artist,
                can_play: proxy.get_property("CanPlay").unwrap_or(false),
                can_pause: proxy.get_property("CanPause").unwrap_or(false),
                can_open_uri: root
                    .get_property::<Vec<String>>("SupportedUriSchemes")
                    .unwrap_or_default()
                    .iter()
                    .any(|s| s == "spotify"),
                id: id.clone(),
            });
        }
        result.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(result)
    }
    fn play(&mut self, player: &str, uri: Option<&str>) -> Result<()> {
        let proxy = self.player(player)?;
        if let Some(uri) = uri {
            let uri = crate::config::spotify_uri(uri)?;
            proxy.call::<_, _, ()>("OpenUri", &(uri,)).map_err(native)?;
        } else {
            proxy.call::<_, _, ()>("Play", &()).map_err(native)?;
        }
        Ok(())
    }
    fn pause(&mut self, player: &str) -> Result<()> {
        self.player(player)?
            .call::<_, _, ()>("Pause", &())
            .map_err(native)
    }
    fn volume(&mut self, player: &str, value: f64) -> Result<()> {
        self.player(player)?
            .set_property("Volume", value.clamp(0.0, 1.0))
            .map_err(native)
    }
    fn media_key(&mut self) -> Result<()> {
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return Err(err(
                "Wayland global tuş enjeksiyonunu kısıtlar; MPRIS oynatıcı seçin",
            ));
        }
        use x11rb::protocol::xtest::ConnectionExt as _;
        let (connection, _) = x11rb::connect(None).map_err(native)?;
        let first = connection.setup().min_keycode;
        let last = connection.setup().max_keycode;
        let map = connection
            .get_keyboard_mapping(first, last - first + 1)
            .map_err(native)?
            .reply()
            .map_err(native)?;
        let index = map
            .keysyms
            .chunks(map.keysyms_per_keycode as usize)
            .position(|keys| keys.contains(&0x1008ff14))
            .ok_or_else(|| err("XF86AudioPlay tuşu bulunamadı"))?;
        let key = first + index as u8;
        connection
            .xtest_fake_input(2, key, 0, 0, 0, 0, 0)
            .map_err(native)?
            .check()
            .map_err(native)?;
        connection
            .xtest_fake_input(3, key, 0, 0, 0, 0, 0)
            .map_err(native)?
            .check()
            .map_err(native)?;
        connection.flush().map_err(native)
    }
}
