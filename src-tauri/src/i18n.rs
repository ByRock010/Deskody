//! Presentation-only translation: never translate rule names or media metadata.
use crate::model::Language;
use regex::Regex;
use std::{collections::BTreeMap, sync::OnceLock};

pub fn catalogue() -> &'static BTreeMap<String, String> {
    static MESSAGES: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    MESSAGES.get_or_init(|| {
        serde_json::from_str(include_str!("../../locales/en.json"))
            .expect("valid translation catalogue")
    })
}
fn placeholders() -> &'static Regex {
    static PLACEHOLDERS: OnceLock<Regex> = OnceLock::new();
    PLACEHOLDERS.get_or_init(|| Regex::new(r"\{([^{}]*)\}").unwrap())
}
struct Pattern {
    pattern: Regex,
    target: String,
    names: Vec<String>,
}
fn patterns() -> &'static Vec<Pattern> {
    static PATTERNS: OnceLock<Vec<Pattern>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        let mut entries: Vec<_> = catalogue()
            .iter()
            .filter(|(key, _)| key.contains('{'))
            .collect();
        entries.sort_by_key(|(key, _)| std::cmp::Reverse(key.len()));
        entries
            .into_iter()
            .map(|(source, target)| {
                let mut pattern = String::from("(?s)^");
                let mut end = 0;
                let mut names = Vec::new();
                for (index, capture) in placeholders().captures_iter(source).enumerate() {
                    let m = capture.get(0).unwrap();
                    pattern.push_str(&regex::escape(&source[end..m.start()]));
                    pattern.push_str("(.*?)");
                    end = m.end();
                    names.push(if capture[1].is_empty() {
                        index.to_string()
                    } else {
                        capture[1].into()
                    });
                }
                pattern.push_str(&regex::escape(&source[end..]));
                pattern.push('$');
                Pattern {
                    pattern: Regex::new(&pattern).unwrap(),
                    target: target.clone(),
                    names,
                }
            })
            .collect()
    })
}
pub fn text(language: Language, message: &str) -> String {
    translate(language, message, 0)
}
fn translate(language: Language, message: &str, depth: usize) -> String {
    if language == Language::Tr {
        return message.into();
    }
    if let Some(value) = catalogue().get(message) {
        return value.clone();
    }
    if depth < 4 {
        for item in patterns() {
            if let Some(captures) = item.pattern.captures(message) {
                let mut index = 0;
                return placeholders()
                    .replace_all(&item.target, |capture: &regex::Captures<'_>| {
                        let key = if capture[1].is_empty() {
                            let key = index.to_string();
                            index += 1;
                            key
                        } else {
                            capture[1].to_owned()
                        };
                        let value = item
                            .names
                            .iter()
                            .position(|name| *name == key)
                            .and_then(|i| captures.get(i + 1))
                            .map_or("", |m| m.as_str());
                        if matches!(key.as_str(), "e" | "error") {
                            translate(language, value, depth + 1)
                        } else {
                            value.to_owned()
                        }
                    })
                    .into_owned();
            }
        }
    }
    message.into()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn translates_errors_without_changing_unknown_user_data() {
        assert_eq!(text(Language::En, "Otomasyon kapalı"), "Automation is off");
        assert_eq!(text(Language::Tr, "Otomasyon kapalı"), "Otomasyon kapalı");
        assert_eq!(
            text(
                Language::En,
                "Spotify arka plan komutu başarısız: Oynatıcı yok"
            ),
            "Spotify background command failed: No player"
        );
        assert_eq!(
            text(Language::En, "Özel çalışma listem"),
            "Özel çalışma listem"
        );
    }
}
