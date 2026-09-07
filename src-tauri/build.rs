fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/macos.m")
            .file("native/panel.m")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=12.0")
            .compile("deskody_native");
        for framework in ["Cocoa", "ApplicationServices", "CoreAudio", "QuartzCore"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rerun-if-changed=native/macos.m");
        println!("cargo:rerun-if-changed=native/panel.m");
        println!("cargo:rerun-if-changed=native/panel.h");
    }
    if std::env::var_os("CARGO_FEATURE_DESKTOP").is_some() {
        tauri_build::build();
    }
}
