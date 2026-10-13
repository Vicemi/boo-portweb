//! Instalador / desinstalador de Boo (versión de escritorio), por Vicemi Dev (https://vicemi.dev).
//!
//! Lleva dentro el juego (`payload.zip`: boo.exe + game/) y lo instala por usuario (sin permisos de administrador) en
//! `%LOCALAPPDATA%\Programs\Boo Vicemi`, con accesos directos y entrada en "Aplicaciones instaladas". Copia este mismo programa como
//! `uninstall.exe` en la carpeta de instalación: ese archivo, o `--uninstall`, abre la pantalla de desinstalación.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

// con la característica `stub` se compila el desinstalador (sin el juego dentro): el instalador completo lo lleva y lo copia como uninstall.exe
#[cfg(not(feature = "stub"))]
const PAYLOAD: &[u8] = include_bytes!("../../payload/payload.zip");
#[cfg(feature = "stub")]
const PAYLOAD: &[u8] = &[];
#[cfg(not(feature = "stub"))]
const UNINSTALLER: &[u8] = include_bytes!("../../payload/uninstall.exe");
#[cfg(feature = "stub")]
const UNINSTALLER: &[u8] = &[];
const UI: &str = include_str!("ui.html");
const ICON_PNG: &[u8] = include_bytes!("../../assets/icon.png");
const APP_NAME: &str = "Boo";
const REG_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Boo-Vicemi";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug)]
enum Ev {
    Ipc(String),
    Script(String),
    Quit,
}

#[derive(Deserialize)]
struct Msg {
    t: String,
    data: Option<serde_json::Value>,
}

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len() * 4 / 3 + 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn default_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(r"C:\Users\Public")).join("Programs").join("Boo Vicemi")
}

fn registered_dir() -> Option<PathBuf> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey(REG_KEY).ok()?;
    let s: String = key.get_value("InstallLocation").ok()?;
    Some(PathBuf::from(s))
}

fn start_menu_link() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(r"Microsoft\Windows\Start Menu\Programs").join(format!("{APP_NAME}.lnk")))
}

fn desktop_link() -> Option<PathBuf> {
    Some(dirs::desktop_dir()?.join(format!("{APP_NAME}.lnk")))
}

fn js(proxy: &EventLoopProxy<Ev>, value: serde_json::Value) {
    let _ = proxy.send_event(Ev::Script(format!("window.onHost({});", value)));
}

fn make_link(target: &Path, workdir: &Path, link: &Path) -> Result<(), String> {
    if let Some(parent) = link.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut sl = mslnk::ShellLink::new(target).map_err(|e| e.to_string())?;
    sl.set_working_dir(Some(workdir.to_string_lossy().to_string()));
    sl.set_name(Some(APP_NAME.to_string()));
    sl.create_lnk(link).map_err(|e| e.to_string())
}

fn install(progress: &dyn Fn(&str, f64), dir: PathBuf, desktop: bool, start: bool) -> Result<(), String> {
    progress("Preparando la carpeta…", 0.0);
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta de instalación: {e}"))?;
    let mut zip = zip::ZipArchive::new(Cursor::new(PAYLOAD)).map_err(|e| e.to_string())?;
    let total: u64 = (0..zip.len()).filter_map(|i| zip.by_index(i).ok().map(|f| f.size())).sum::<u64>().max(1);
    let mut done: u64 = 0;
    let mut buf = Vec::new();
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = file.enclosed_name() else { continue };
        let out = dir.join(&rel);
        if file.is_dir() {
            let _ = std::fs::create_dir_all(&out);
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        buf.clear();
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out, &buf).map_err(|e| {
            if rel.file_name().map(|n| n == "boo.exe").unwrap_or(false) {
                format!("No se pudo escribir boo.exe: cierra el juego si está abierto e inténtalo de nuevo ({e})")
            } else {
                format!("No se pudo escribir {}: {e}", rel.display())
            }
        })?;
        done += buf.len() as u64;
        if i % 20 == 0 {
            progress("Copiando los archivos del juego…", 0.05 + 0.85 * done as f64 / total as f64);
        }
    }
    progress("Creando el desinstalador y los accesos directos…", 0.93);
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let uninstaller = dir.join("uninstall.exe");
    if !UNINSTALLER.is_empty() {
        let _ = std::fs::write(&uninstaller, UNINSTALLER);
    } else if me != uninstaller {
        let _ = std::fs::copy(&me, &uninstaller);
    }
    let exe = dir.join("boo.exe");
    if desktop {
        if let Some(l) = desktop_link() {
            let _ = make_link(&exe, &dir, &l);
        }
    }
    if start {
        if let Some(l) = start_menu_link() {
            let _ = make_link(&exe, &dir, &l);
        }
    }
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(REG_KEY).map_err(|e| e.to_string())?;
        let set = |k: &str, v: String| key.set_value(k, &v);
        let _ = set("DisplayName", APP_NAME.to_string());
        let _ = set("DisplayVersion", VERSION.to_string());
        let _ = set("Publisher", "Vicemi Dev".to_string());
        let _ = set("URLInfoAbout", "https://vicemi.dev".to_string());
        let _ = set("InstallLocation", dir.to_string_lossy().to_string());
        let _ = set("DisplayIcon", exe.to_string_lossy().to_string());
        let _ = set("UninstallString", format!("\"{}\" --uninstall", uninstaller.display()));
        let _ = key.set_value("NoModify", &1u32);
        let _ = key.set_value("NoRepair", &1u32);
        let _ = key.set_value("EstimatedSize", &((total / 1024) as u32));
    }
    progress("Listo", 1.0);
    Ok(())
}

fn uninstall(dir: &Path, keep_saves: bool) -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    for l in [desktop_link(), start_menu_link()].into_iter().flatten() {
        let _ = std::fs::remove_file(l);
    }
    let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(REG_KEY);
    let me = std::env::current_exe().ok();
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(()) };
    for e in entries.flatten() {
        let p = e.path();
        if Some(&p) == me.as_ref() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_lowercase();
        if keep_saves && name == "saves" {
            continue;
        }
        let r = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
        if let Err(err) = r {
            return Err(format!("No se pudo borrar {}: {err}. ¿Está abierto el juego?", p.display()));
        }
    }
    // este programa se borra a sí mismo cuando termina
    if let Some(me) = me {
        if me.parent() == Some(dir) {
            let cmd = format!("ping -n 3 127.0.0.1 >nul & del /f /q \"{}\" & rmdir \"{}\"", me.display(), dir.display());
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("cmd").raw_arg(format!("/C \"{cmd}\"")).creation_flags_hidden().spawn();
        }
    }
    Ok(())
}

trait Hidden {
    fn creation_flags_hidden(&mut self) -> &mut Self;
}
impl Hidden for std::process::Command {
    fn creation_flags_hidden(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
    }
}

/// modo silencioso: `--silent [--dir <carpeta>] [--no-shortcuts]` instala y `--uninstall --silent [--remove-saves]` desinstala, sin ventana
fn silent(uninstall_mode: bool) -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == "--silent") {
        return None;
    }
    let dir = args.iter().position(|a| a == "--dir").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    if uninstall_mode {
        let dir = dir.or_else(registered_dir).or_else(|| std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()))).unwrap_or_else(default_dir);
        return Some(match uninstall(&dir, !args.iter().any(|a| a == "--remove-saves")) {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("{e}");
                1
            }
        });
    }
    let dir = dir.or_else(registered_dir).unwrap_or_else(default_dir);
    let shortcuts = !args.iter().any(|a| a == "--no-shortcuts");
    Some(match install(&|_, _| {}, dir, shortcuts, shortcuts) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            1
        }
    })
}

fn main() {
    let uninstall_mode = std::env::args().any(|a| a == "--uninstall")
        || std::env::current_exe().ok().and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_lowercase() == "uninstall")).unwrap_or(false);
    if let Some(code) = silent(uninstall_mode) {
        std::process::exit(code);
    }

    let event_loop = EventLoopBuilder::<Ev>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let title = if uninstall_mode { "Desinstalar - Boo" } else { "Instalar - Boo" };
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(560.0, 520.0))
        .with_resizable(false)
        .build(&event_loop)
        .expect("ventana");

    let ipc_proxy = proxy.clone();
    let html = UI.replace("__ICON__", &b64(ICON_PNG));
    let tmp = std::env::temp_dir().join("boo-installer-webview");
    let mut ctx = wry::WebContext::new(Some(tmp));
    let webview = WebViewBuilder::new_with_web_context(&mut ctx)
        .with_html(html)
        .with_ipc_handler(move |req| {
            let _ = ipc_proxy.send_event(Ev::Ipc(req.into_body()));
        })
        .with_devtools(false)
        .build(&window)
        .expect("webview (¿falta WebView2?)");

    let mut dir = if uninstall_mode { registered_dir().or_else(|| std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()))).unwrap_or_else(default_dir) } else { registered_dir().unwrap_or_else(default_dir) };
    let mut launch_after: Option<PathBuf> = None;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        let _keep = &ctx;
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } | Event::UserEvent(Ev::Quit) => *control_flow = ControlFlow::Exit,
            Event::UserEvent(Ev::Script(s)) => {
                let _ = webview.evaluate_script(&s);
            }
            Event::UserEvent(Ev::Ipc(body)) => {
                let Ok(m) = serde_json::from_str::<Msg>(&body) else { return };
                match m.t.as_str() {
                    "ready" => {
                        let existing = dir.join("boo.exe").exists();
                        js(&proxy, serde_json::json!({ "type": "init", "mode": if uninstall_mode { "uninstall" } else { "install" }, "path": dir.to_string_lossy(), "existing": existing && !uninstall_mode }));
                    }
                    "browse" => {
                        let start = m.data.as_ref().and_then(|d| d.as_str()).map(PathBuf::from).filter(|p| p.exists());
                        let mut d = rfd::FileDialog::new().set_title("Elige la carpeta donde instalar el juego");
                        if let Some(s) = start {
                            d = d.set_directory(s);
                        }
                        if let Some(p) = d.pick_folder() {
                            // si eligen una carpeta cualquiera, se instala dentro de una subcarpeta propia
                            let p = if p.join("boo.exe").exists() || p.file_name().map(|n| n.to_string_lossy().to_lowercase().contains("boo")).unwrap_or(false) { p } else { p.join("Boo Vicemi") };
                            dir = p.clone();
                            js(&proxy, serde_json::json!({ "type": "path", "path": p.to_string_lossy() }));
                        }
                    }
                    "install" => {
                        let Some(d) = m.data else { return };
                        let path = PathBuf::from(d["path"].as_str().unwrap_or(""));
                        if path.as_os_str().is_empty() {
                            js(&proxy, serde_json::json!({ "type": "error", "text": "Elige una carpeta de instalación." }));
                            return;
                        }
                        dir = path.clone();
                        let (desktop, start) = (d["desktop"].as_bool().unwrap_or(true), d["start"].as_bool().unwrap_or(true));
                        launch_after = Some(path.join("boo.exe"));
                        let p = proxy.clone();
                        std::thread::spawn(move || match install(&|text, value| js(&p, serde_json::json!({ "type": "progress", "text": text, "value": value })), path.clone(), desktop, start) {
                            Ok(()) => js(
                                &p,
                                serde_json::json!({ "type": "done", "text": format!("El juego quedó instalado en {}", path.display()), "items": [
                                    "Funciona sin internet.",
                                    "Tus partidas se guardan solas en la carpeta saves de la instalación.",
                                    "Dentro del juego: menú Pantalla (resoluciones y pantalla completa) y menú Juego (guardar y cargar).",
                                    "Para quitarlo: Configuración > Aplicaciones, o uninstall.exe en la carpeta."
                                ] }),
                            ),
                            Err(e) => js(&p, serde_json::json!({ "type": "error", "text": e })),
                        });
                    }
                    "uninstall" => {
                        let keep = m.data.as_ref().and_then(|d| d["keepSaves"].as_bool()).unwrap_or(true);
                        match uninstall(&dir, keep) {
                            Ok(()) => js(&proxy, serde_json::json!({ "type": "done", "uninstall": true, "text": if keep { "El juego se quitó. Tus partidas guardadas siguen en la carpeta saves." } else { "El juego y sus partidas se quitaron." }, "items": [] })),
                            Err(e) => js(&proxy, serde_json::json!({ "type": "error", "uninstall": true, "text": e })),
                        }
                    }
                    "play" => {
                        if let Some(exe) = &launch_after {
                            let _ = std::process::Command::new(exe).current_dir(exe.parent().unwrap_or(Path::new("."))).spawn();
                        }
                        let _ = proxy.send_event(Ev::Quit);
                    }
                    "site" => {
                        let _ = open::that("https://vicemi.dev");
                    }
                    "close" => {
                        let _ = proxy.send_event(Ev::Quit);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    });
}
