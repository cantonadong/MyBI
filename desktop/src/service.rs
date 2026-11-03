use serde::Deserialize;
use std::{
    collections::hash_map::DefaultHasher,
    fs::{self, File},
    hash::{Hash, Hasher},
    io,
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    ptr::{null, null_mut},
    sync::mpsc::{Receiver, RecvTimeoutError, Sender},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::{ERROR_ALREADY_EXISTS, GetLastError, HWND, LPARAM, WAIT_OBJECT_0},
    Networking::WinHttp::*,
    System::Threading::{
        CREATE_NO_WINDOW, CreateMutexW, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_TERMINATE, QueryFullProcessImageNameW, TerminateProcess, WaitForSingleObject,
    },
    UI::{
        Shell::ShellExecuteW,
        WindowsAndMessaging::{
            EnumWindows, FlashWindow, GW_OWNER, GetWindow, GetWindowTextW,
            GetWindowThreadProcessId, MB_ICONINFORMATION, MessageBoxW, SW_RESTORE, SW_SHOWNORMAL,
            SetForegroundWindow, ShowWindowAsync,
        },
    },
};

#[derive(Clone)]
pub struct Failure {
    pub key: &'static str,
    pub detail: String,
}
type Result<T> = std::result::Result<T, Failure>;
fn failure(key: &'static str, detail: impl ToString) -> Failure {
    Failure {
        key,
        detail: detail.to_string(),
    }
}
fn os_error() -> Failure {
    failure("操作失败", io::Error::last_os_error())
}
fn wide(text: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    text.as_ref().encode_wide().chain(Some(0)).collect()
}

#[derive(Clone, Copy)]
pub enum Action {
    Start,
    Stop,
}
pub struct Update {
    pub phase: &'static str,
    pub running: bool,
    pub busy: bool,
    pub error: Option<Failure>,
}

#[derive(Deserialize)]
struct Health {
    status: String,
    project_root: String,
    pid: u32,
}

fn validate_health(bytes: &[u8], root: &Path) -> Result<Health> {
    let health: Health =
        serde_json::from_slice(bytes).map_err(|e| failure("端口 8000 被其他服务占用", e))?;
    if health.status != "ok"
        || health.pid == 0
        || !health
            .project_root
            .replace('/', "\\")
            .trim_end_matches('\\')
            .eq_ignore_ascii_case(
                &root
                    .to_string_lossy()
                    .replace('/', "\\")
                    .trim_end_matches('\\'),
            )
    {
        return Err(failure("端口 8000 被其他服务占用", "http://127.0.0.1:8000"));
    }
    Ok(health)
}

struct HttpHandle(*mut std::ffi::c_void);
impl HttpHandle {
    fn new(handle: *mut std::ffi::c_void) -> Result<Self> {
        if handle.is_null() {
            Err(os_error())
        } else {
            Ok(Self(handle))
        }
    }
}
impl Drop for HttpHandle {
    fn drop(&mut self) {
        unsafe {
            WinHttpCloseHandle(self.0);
        }
    }
}

fn health(root: &Path) -> Result<Option<Health>> {
    let deadline = Instant::now() + Duration::from_secs(3);
    unsafe {
        let session = HttpHandle::new(WinHttpOpen(
            wide("MyBI/1.0").as_ptr(),
            WINHTTP_ACCESS_TYPE_NO_PROXY,
            null(),
            null(),
            0,
        ))?;
        if WinHttpSetTimeouts(session.0, 1000, 1000, 1000, 1000) == 0 {
            return Err(os_error());
        }
        let connection = HttpHandle::new(WinHttpConnect(
            session.0,
            wide("127.0.0.1").as_ptr(),
            8000,
            0,
        ))?;
        let request = HttpHandle::new(WinHttpOpenRequest(
            connection.0,
            wide("GET").as_ptr(),
            wide("/api/health").as_ptr(),
            null(),
            null(),
            null(),
            0,
        ))?;
        let redirect = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        if WinHttpSetOption(
            request.0,
            WINHTTP_OPTION_REDIRECT_POLICY,
            &redirect as *const _ as _,
            size_of_val(&redirect) as u32,
        ) == 0
        {
            return Err(os_error());
        }
        if WinHttpSendRequest(request.0, null(), 0, null(), 0, 0, 0) == 0 {
            let error = GetLastError();
            if error == ERROR_WINHTTP_CANNOT_CONNECT {
                return Ok(None);
            }
            return Err(failure(
                "无法检查服务状态",
                io::Error::from_raw_os_error(error as i32),
            ));
        }
        if WinHttpReceiveResponse(request.0, null_mut()) == 0 {
            return Err(os_error());
        }
        let mut status: u32 = 0;
        let mut length = size_of_val(&status) as u32;
        if WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            null(),
            &mut status as *mut _ as _,
            &mut length,
            null_mut(),
        ) == 0
        {
            return Err(os_error());
        }
        if status != 200 {
            return Err(failure(
                "端口 8000 被其他服务占用",
                format!("HTTP {status}"),
            ));
        }
        let mut bytes = Vec::new();
        loop {
            if Instant::now() >= deadline {
                return Err(failure("无法检查服务状态", "HTTP timeout"));
            }
            let mut buffer = [0u8; 2048];
            let mut read = 0;
            if WinHttpReadData(
                request.0,
                buffer.as_mut_ptr() as _,
                buffer.len() as u32,
                &mut read,
            ) == 0
            {
                return Err(os_error());
            }
            if read == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..read as usize]);
            if bytes.len() > 16384 {
                return Err(failure("无法检查服务状态", "HTTP response > 16 KiB"));
            }
        }
        validate_health(&bytes, root).map(Some)
    }
}

fn restore_existing_window(root: &Path) -> bool {
    struct Search<'a> {
        root: &'a Path,
        window: HWND,
    }
    unsafe extern "system" fn find(window: HWND, context: LPARAM) -> i32 {
        unsafe {
            let search = &mut *(context as *mut Search<'_>);
            let mut title = [0u16; 64];
            let length = GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32);
            if String::from_utf16_lossy(&title[..length as usize]) != "MyBI"
                || !GetWindow(window, GW_OWNER).is_null()
            {
                return 1;
            }
            let mut pid = 0;
            GetWindowThreadProcessId(window, &mut pid);
            let raw = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if raw.is_null() {
                return 1;
            }
            let process = OwnedHandle::from_raw_handle(raw);
            let mut image = [0u16; 32768];
            let mut size = image.len() as u32;
            if QueryFullProcessImageNameW(process.as_raw_handle(), 0, image.as_mut_ptr(), &mut size)
                == 0
            {
                return 1;
            }
            let image = PathBuf::from(String::from_utf16_lossy(&image[..size as usize]));
            if !image.parent().is_some_and(|parent| {
                parent
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&search.root.to_string_lossy())
            }) {
                return 1;
            }
            search.window = window;
            0
        }
    }
    let mut search = Search {
        root,
        window: null_mut(),
    };
    unsafe {
        EnumWindows(Some(find), &mut search as *mut _ as LPARAM);
        if search.window.is_null() {
            return false;
        }
        ShowWindowAsync(search.window, SW_RESTORE);
        if SetForegroundWindow(search.window) == 0 {
            FlashWindow(search.window, 1);
        }
    }
    true
}

pub fn single_instance(root: &Path) -> Result<Option<OwnedHandle>> {
    let mut hash = DefaultHasher::new();
    root.to_string_lossy().to_lowercase().hash(&mut hash);
    let name = wide(format!("Local\\MyBI-{:x}", hash.finish()));
    unsafe {
        let handle = CreateMutexW(null(), 0, name.as_ptr());
        if handle.is_null() {
            return Err(os_error());
        }
        let exists = GetLastError() == ERROR_ALREADY_EXISTS;
        let handle = OwnedHandle::from_raw_handle(handle);
        if exists {
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                if restore_existing_window(root) {
                    return Ok(None);
                }
                if Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(failure("MyBI 服务管理窗口已经打开，请从任务栏切换。", ""))
        } else {
            Ok(Some(handle))
        }
    }
}

pub fn message_box(message: &str) {
    unsafe {
        MessageBoxW(
            null_mut(),
            wide(message).as_ptr(),
            wide("MyBI").as_ptr(),
            MB_ICONINFORMATION,
        );
    }
}

pub fn open_browser() -> Result<()> {
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            wide("open").as_ptr(),
            wide("http://127.0.0.1:8000").as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        Err(failure(
            "无法打开浏览器",
            format!("Windows Shell: {}", result as isize),
        ))
    } else {
        Ok(())
    }
}

fn python(root: &Path) -> Result<PathBuf> {
    [
        root.join("runtime/python.exe"),
        root.join(".venv/Scripts/python.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| failure("缺少 Python 运行环境，请使用完整便携包。", root.display()))
}

pub fn check(root: &Path) -> Result<()> {
    if !root.join("frontend/dist/index.html").is_file() {
        return Err(failure(
            "缺少网页构建文件，请重新构建或使用完整便携包。",
            root.display(),
        ));
    }
    let output = Command::new(python(root)?)
        .current_dir(root)
        .args([
            "-c",
            "import fastapi, duckdb, pyarrow, python_calamine, sqlalchemy, uvicorn",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| failure("操作失败", e))?;
    if !output.status.success() {
        return Err(failure(
            "服务启动失败",
            String::from_utf8_lossy(&output.stderr),
        ));
    }
    Ok(())
}

fn start(root: &Path, child: &mut Option<Child>, updates: &Sender<Update>) -> Result<()> {
    if health(root)?.is_some() {
        return Ok(());
    }
    let python = python(root)?;
    if !root.join("frontend/dist/index.html").is_file() {
        return Err(failure(
            "缺少网页构建文件，请重新构建或使用完整便携包。",
            root.display(),
        ));
    }
    let logs = root.join("data/logs");
    fs::create_dir_all(&logs).map_err(|e| failure("无法创建服务日志", e))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let stdout = logs.join(format!("{stamp}-out.log"));
    let stderr = logs.join(format!("{stamp}-error.log"));
    let output = File::create(&stdout).map_err(|e| failure("无法创建服务日志", e))?;
    let error = File::create(&stderr).map_err(|e| failure("无法创建服务日志", e))?;
    let process = Command::new(python)
        .current_dir(root)
        .args([
            "-m",
            "uvicorn",
            "app.main:app",
            "--app-dir",
            "backend",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(output)
        .stderr(error)
        .spawn()
        .map_err(|e| failure("服务启动失败", e))?;
    *child = Some(process);
    let _ = updates.send(Update {
        phase: "启动中…",
        running: false,
        busy: true,
        error: None,
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(code) = child
            .as_mut()
            .unwrap()
            .try_wait()
            .map_err(|e| failure("服务启动失败", e))?
        {
            return Err(failure(
                "服务启动失败，请查看日志。",
                format!("{code}\n{}", stderr.display()),
            ));
        }
        match health(root) {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => (),
            Err(error) => {
                // Only terminate the child created by this invocation if readiness fails.
                let _ = child.as_mut().unwrap().kill();
                let _ = child.as_mut().unwrap().wait();
                return Err(error);
            }
        }
        if Instant::now() >= deadline {
            child
                .as_mut()
                .unwrap()
                .kill()
                .map_err(|e| failure("无法停止服务", e))?;
            child
                .as_mut()
                .unwrap()
                .wait()
                .map_err(|e| failure("无法停止服务", e))?;
            return Err(failure("服务启动超时，请查看日志。", stderr.display()));
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

fn stop(root: &Path) -> Result<()> {
    let Some(before) = health(root)? else {
        return Ok(());
    };
    unsafe {
        let raw = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | 0x00100000,
            0,
            before.pid,
        );
        if raw.is_null() {
            return Err(os_error());
        }
        let process = OwnedHandle::from_raw_handle(raw);
        let mut image = [0u16; 32768];
        let mut size = image.len() as u32;
        if QueryFullProcessImageNameW(process.as_raw_handle(), 0, image.as_mut_ptr(), &mut size)
            == 0
        {
            return Err(os_error());
        }
        let image = PathBuf::from(String::from_utf16_lossy(&image[..size as usize]));
        if !image
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("python.exe"))
            || !health(root)?.is_some_and(|after| after.pid == before.pid)
        {
            return Err(failure("服务进程不匹配", image.display()));
        }
        if TerminateProcess(process.as_raw_handle(), 0) == 0 {
            return Err(os_error());
        }
        if WaitForSingleObject(process.as_raw_handle(), 5000) != WAIT_OBJECT_0 {
            return Err(failure("无法停止服务", "Windows process wait timeout"));
        }
    }
    Ok(())
}

pub fn run(root: PathBuf, commands: Receiver<Action>, updates: Sender<Update>) {
    let mut child = None;
    let mut action = Some(Action::Start);
    let mut last_error = None;
    loop {
        let result = match action {
            Some(Action::Start) => start(&root, &mut child, &updates),
            Some(Action::Stop) => stop(&root),
            None => Ok(()),
        };
        if action.is_some() {
            last_error = result.err();
        }
        let running = match health(&root) {
            Ok(value) => value.is_some(),
            Err(error) => {
                last_error = last_error.or(Some(error));
                false
            }
        };
        if let Some(process) = child.as_mut() {
            if let Ok(Some(code)) = process.try_wait() {
                if !code.success() && last_error.is_none() {
                    last_error = Some(failure(
                        "服务启动失败，请查看日志。",
                        format!("{code}\n{}", root.join("data/logs").display()),
                    ));
                }
                child = None;
            }
        }
        if updates
            .send(Update {
                phase: if running { "运行中" } else { "已停止" },
                running,
                busy: false,
                error: last_error.clone(),
            })
            .is_err()
        {
            break;
        }
        action = match commands.recv_timeout(Duration::from_secs(3)) {
            Ok(action) => Some(action),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => break,
        };
    }
    // Dropping Child closes our handles without stopping the browser's service.
}

#[cfg(test)]
mod checks {
    use super::*;

    #[test]
    fn rejects_other_projects_bad_health_and_zero_pid() {
        let root = Path::new("C:\\Program\\MyBI");
        let body = |status: &str, project: &str, pid: u32| {
            serde_json::to_vec(
                &serde_json::json!({"status": status, "project_root": project, "pid": pid}),
            )
            .unwrap()
        };
        assert_eq!(
            validate_health(&body("ok", "c:/program/mybi/", 42), root)
                .unwrap_or_else(|_| panic!("valid health rejected"))
                .pid,
            42
        );
        assert!(validate_health(&body("ok", "C:/Program/Other", 42), root).is_err());
        assert!(validate_health(&body("ok", "C:/Program/MyBI", 0), root).is_err());
        assert!(validate_health(&body("error", "C:/Program/MyBI", 42), root).is_err());
        assert!(validate_health(b"not json", root).is_err());
    }
}
