use crate::{locale, service, translate};
use std::{
    collections::HashMap,
    mem::size_of,
    path::PathBuf,
    ptr::{null, null_mut},
    sync::mpsc,
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{Shell::*, WindowsAndMessaging::*},
};

const CALLBACK: u32 = WM_APP + 1;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

struct Tray {
    root: PathBuf,
    dictionary: HashMap<String, String>,
    commands: mpsc::Sender<service::Action>,
    messages: mpsc::Receiver<service::Update>,
    state: service::Update,
    icon: NOTIFYICONDATAW,
    taskbar_created: u32,
}

impl Tray {
    fn label(&self, text: &str) -> Vec<u16> {
        wide(translate(&self.dictionary, &locale(&self.root), text))
    }

    unsafe fn refresh(&mut self) {
        while let Ok(message) = self.messages.try_recv() {
            if let Some(error) = &message.error {
                if self
                    .state
                    .error
                    .as_ref()
                    .map(|previous| (previous.key, &previous.detail))
                    != Some((error.key, &error.detail))
                {
                    let language = locale(&self.root);
                    service::message_box(&format!(
                        "{}\n{}",
                        translate(&self.dictionary, &language, error.key),
                        error.detail
                    ));
                }
            }
            self.state = message;
        }
        let language = locale(&self.root);
        let t = |text| translate(&self.dictionary, &language, text);
        let detail = self
            .state
            .error
            .as_ref()
            .map(|error| t(error.key))
            .unwrap_or(t(self.state.phase));
        self.icon.szTip.fill(0);
        for (slot, unit) in self
            .icon
            .szTip
            .iter_mut()
            .take(127)
            .zip(format!("MyBI — {detail}").encode_utf16())
        {
            *slot = unit;
        }
        unsafe {
            Shell_NotifyIconW(NIM_MODIFY, &self.icon);
        }
    }

    unsafe fn menu(pointer: *mut Self, window: HWND) {
        unsafe {
            let tray = &*pointer;
            let menu = CreatePopupMenu();
            if menu.is_null() {
                return;
            }
            let disabled = if tray.state.busy {
                MF_GRAYED
            } else {
                MF_ENABLED
            };
            let language = locale(&tray.root);
            let status = wide(&format!(
                "{}: {}",
                translate(&tray.dictionary, &language, "运行状态"),
                translate(
                    &tray.dictionary,
                    &language,
                    tray.state
                        .error
                        .as_ref()
                        .map(|error| error.key)
                        .unwrap_or(tray.state.phase)
                )
            ));
            AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, status.as_ptr());
            AppendMenuW(menu, MF_SEPARATOR, 0, null());
            let available = if tray.state.busy || !tray.state.running {
                MF_GRAYED
            } else {
                MF_ENABLED
            };
            AppendMenuW(
                menu,
                MF_STRING | available,
                3,
                tray.label("打开 MyBI").as_ptr(),
            );
            AppendMenuW(
                menu,
                MF_STRING | disabled,
                1,
                tray.label("重启服务").as_ptr(),
            );
            AppendMenuW(
                menu,
                MF_STRING | available,
                2,
                tray.label("停止服务").as_ptr(),
            );
            AppendMenuW(menu, MF_SEPARATOR, 0, null());
            AppendMenuW(menu, MF_STRING | disabled, 4, tray.label("退出").as_ptr());
            let mut point = POINT::default();
            GetCursorPos(&mut point);
            SetForegroundWindow(window);
            let selected = TrackPopupMenu(
                menu,
                TPM_RETURNCMD | TPM_RIGHTBUTTON,
                point.x,
                point.y,
                0,
                window,
                null(),
            );
            DestroyMenu(menu);
            PostMessageW(window, WM_NULL, 0, 0);
            match selected {
                1 | 2 => {
                    let action = if selected == 1 {
                        service::Action::Restart
                    } else {
                        service::Action::Stop
                    };
                    if (*pointer).commands.send(action).is_ok() {
                        (*pointer).state.busy = true;
                        (*pointer).state.error = None;
                    }
                }
                3 => (*pointer).open(),
                4 => {
                    if (*pointer).commands.send(service::Action::Exit).is_ok() {
                        (*pointer).state.busy = true;
                        (*pointer).state.error = None;
                    }
                }
                _ => {}
            }
        }
    }

    fn open(&self) {
        if let Err(error) = service::open_browser() {
            let language = locale(&self.root);
            service::message_box(&format!(
                "{}\n{}",
                translate(&self.dictionary, &language, error.key),
                error.detail
            ));
        }
    }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        let pointer = GetWindowLongPtrW(window, GWLP_USERDATA) as *mut Tray;
        if !pointer.is_null() {
            if message == (*pointer).taskbar_created {
                Shell_NotifyIconW(NIM_ADD, &(*pointer).icon);
                return 0;
            }
            match message {
                WM_TIMER => {
                    (*pointer).refresh();
                    if (*pointer).state.exiting {
                        DestroyWindow(window);
                    }
                    return 0;
                }
                CALLBACK => {
                    if lparam as u32 == WM_RBUTTONUP || lparam as u32 == WM_CONTEXTMENU {
                        Tray::menu(pointer, window);
                    }
                    if lparam as u32 == WM_LBUTTONDBLCLK && (*pointer).state.running {
                        (*pointer).open();
                    }
                    return 0;
                }
                WM_DESTROY => {
                    KillTimer(window, 1);
                    Shell_NotifyIconW(NIM_DELETE, &(*pointer).icon);
                    PostQuitMessage(0);
                    return 0;
                }
                _ => {}
            }
        }
        DefWindowProcW(window, message, wparam, lparam)
    }
}

pub fn run(
    root: PathBuf,
    dictionary: HashMap<String, String>,
) -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        let instance = GetModuleHandleW(null());
        let class_name = wide("MyBI.Tray");
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: class_name.as_ptr(),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let window = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            class_name.as_ptr(),
            wide("MyBI").as_ptr(),
            WS_POPUP,
            0,
            0,
            0,
            0,
            null_mut(),
            null_mut(),
            instance,
            null(),
        );
        if window.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let (commands, receiver) = mpsc::channel();
        let (updates, messages) = mpsc::channel();
        let mut tray = Box::new(Tray {
            root: root.clone(),
            dictionary,
            commands,
            messages,
            state: service::Update {
                phase: "启动中…",
                running: false,
                busy: true,
                exiting: false,
                error: None,
            },
            icon: NOTIFYICONDATAW {
                cbSize: size_of::<NOTIFYICONDATAW>() as u32,
                hWnd: window,
                uID: 1,
                uFlags: NIF_ICON | NIF_MESSAGE | NIF_TIP,
                uCallbackMessage: CALLBACK,
                hIcon: LoadIconW(instance, 1usize as *const u16),
                ..Default::default()
            },
            taskbar_created: RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()),
        });
        SetWindowLongPtrW(window, GWLP_USERDATA, &mut *tray as *mut Tray as isize);
        tray.refresh();
        if Shell_NotifyIconW(NIM_ADD, &tray.icon) == 0 || SetTimer(window, 1, 200, None) == 0 {
            let error = std::io::Error::last_os_error();
            DestroyWindow(window);
            return Err(error.into());
        }
        let worker = std::thread::spawn(move || service::run(root, receiver, updates));
        let mut message = MSG::default();
        let mut result;
        loop {
            result = GetMessageW(&mut message, null_mut(), 0, 0);
            if result <= 0 {
                break;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        let error = if result < 0 {
            Some(std::io::Error::last_os_error())
        } else {
            None
        };
        if result < 0 {
            DestroyWindow(window);
        }
        drop(tray);
        let _ = worker.join();
        if let Some(error) = error {
            return Err(error.into());
        }
        Ok(())
    }
}
