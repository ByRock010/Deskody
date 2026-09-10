//! Live-test driver: invokes the same entry point as the macOS media adapter.
#[cfg(target_os = "macos")]
fn main() {
    let uri = std::env::args().nth(1).expect("Spotify URI required");
    if let Err(error) = deskody::spotify_desktop::play(&uri) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("This live test requires macOS");
    std::process::exit(1);
}
