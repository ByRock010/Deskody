pub mod applications;
pub mod browser;
pub mod config;
#[cfg(feature = "desktop")]
mod desktop;
pub mod engine;
pub mod media;
pub mod model;
pub mod platform;
pub mod process;
pub mod runtime;
pub mod spotify;
#[cfg(target_os = "macos")]
pub mod spotify_desktop;
#[cfg(feature = "desktop")]
pub use desktop::run;
