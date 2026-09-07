fn main() {
    let apps = deskody::applications::list().expect("application discovery");
    println!("{} applications discovered", apps.len());
    for app in apps.iter().filter(|app| {
        [
            "com.microsoft.VSCode",
            "com.apple.Preview",
            "com.microsoft.Word",
            "com.microsoft.Excel",
        ]
        .contains(&app.id.as_str())
    }) {
        println!("{}: {}", app.name, app.id);
    }
}
