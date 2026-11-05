#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod service;
mod tray;

use std::{collections::HashMap, path::Path};

fn locale(root: &Path) -> String {
    match std::fs::read_to_string(root.join("data/manager-locale.txt")).as_deref() {
        Ok("zh-CN") => "zh-CN".into(),
        Ok("en") => "en".into(),
        _ => sys_locale::get_locale().unwrap_or_else(|| "en".into()),
    }
}

fn translate<'a>(dictionary: &'a HashMap<String, String>, locale: &str, text: &'a str) -> &'a str {
    if locale.to_ascii_lowercase().starts_with("zh") {
        text
    } else {
        dictionary.get(text).map(String::as_str).unwrap_or(text)
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::current_exe()?
        .parent()
        .ok_or("Missing application directory")?
        .to_path_buf();
    let dictionary: HashMap<String, String> =
        serde_json::from_str(include_str!("../../frontend/src/locales/en.json"))?;
    let initial_locale = locale(&root);
    let t = |text| translate(&dictionary, &initial_locale, text);
    if std::env::args().nth(1).as_deref() == Some("--check") {
        match service::check(&root) {
            Ok(()) => println!("READY"),
            Err(error) => {
                eprintln!("{}\n{}", t(error.key), error.detail);
                std::process::exit(1);
            }
        }
        return Ok(());
    }
    let _instance = match service::single_instance(&root) {
        Ok(Some(instance)) => instance,
        Ok(None) => return Ok(()),
        Err(error) => {
            service::message_box(&format!("{}\n{}", t(error.key), error.detail));
            return Ok(());
        }
    };
    tray::run(root, dictionary)
}

#[cfg(test)]
mod checks {
    use super::*;

    #[test]
    fn shared_dictionary_and_language_fallback() {
        let dictionary =
            serde_json::from_str(include_str!("../../frontend/src/locales/en.json")).unwrap();
        assert_eq!(translate(&dictionary, "en-NZ", "停止服务"), "Stop service");
        assert_eq!(translate(&dictionary, "zh-CN", "停止服务"), "停止服务");
        assert_eq!(translate(&dictionary, "en", "MyBI"), "MyBI");
    }
}
