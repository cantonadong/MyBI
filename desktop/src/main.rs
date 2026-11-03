#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod service;

use slint::ComponentHandle;
use std::{collections::HashMap, path::Path, sync::mpsc, time::Duration};

slint::include_modules!();

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
    let ui = ManagerWindow::new()?;
    let (commands, receiver) = mpsc::channel();
    let (updates, messages) = mpsc::channel();
    for (action, start) in [
        (service::Action::Start, true),
        (service::Action::Stop, false),
    ] {
        let tx = commands.clone();
        let weak = ui.as_weak();
        let callback = move || {
            if tx.send(action).is_ok() {
                if let Some(ui) = weak.upgrade() {
                    ui.set_busy(true);
                }
            }
        };
        if start {
            ui.on_start_service(callback);
        } else {
            ui.on_stop_service(callback);
        }
    }
    let open_updates = updates.clone();
    ui.on_open_report(move || {
        if let Err(error) = service::open_browser() {
            let _ = open_updates.send(service::Update {
                phase: "运行中",
                running: true,
                busy: false,
                error: Some(error),
            });
        }
    });
    let weak = ui.as_weak();
    let ui_root = root.clone();
    let timer = slint::Timer::default();
    let mut state = service::Update {
        phase: "启动中…",
        running: false,
        busy: true,
        error: None,
    };
    let refresh = move || {
        while let Ok(message) = messages.try_recv() {
            state = message;
        }
        if let Some(ui) = weak.upgrade() {
            let language = locale(&ui_root);
            let t = |text| translate(&dictionary, &language, text);
            ui.set_heading(t("服务管理").into());
            ui.set_start_text(t("启动服务").into());
            ui.set_stop_text(t("停止服务").into());
            ui.set_open_text(t("打开 MyBI").into());
            ui.set_close_hint(t("关闭此窗口后服务继续运行；请使用停止服务按钮停止。").into());
            ui.set_logs_text(
                format!(
                    "{} {}",
                    t("日志目录："),
                    ui_root.join("data/logs").display()
                )
                .into(),
            );
            ui.set_status_text(t(state.phase).into());
            ui.set_running(state.running);
            ui.set_busy(state.busy);
            ui.set_error_text(
                state
                    .error
                    .as_ref()
                    .map(|e| format!("{}\n{}", t(e.key), e.detail))
                    .unwrap_or_default()
                    .into(),
            );
        }
    };
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(150),
        refresh,
    );
    let worker = std::thread::spawn(move || service::run(root, receiver, updates));
    let result = ui.run();
    drop(timer);
    drop(ui);
    drop(commands);
    let _ = worker.join();
    result?;
    Ok(())
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
