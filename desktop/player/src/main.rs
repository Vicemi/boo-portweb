//! Boo - versión de escritorio, por Vicemi Dev (https://vicemi.dev).
//!
//! Un programa en Rust que abre el juego en su propia ventana (WebView2 de Windows) y lo sirve desde la carpeta `game/` de la instalación, así que
//! funciona sin internet. Aporta lo que el navegador no da: menú de pantalla (resoluciones, pantalla completa), partidas guardadas en la carpeta de
//! instalación (`saves/`), guardado automático y copias de seguridad.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod saves;
mod server;
mod update;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use muda::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, accelerator::Accelerator};
use serde::{Deserialize, Serialize};
use tao::dpi::{LogicalSize, PhysicalSize};
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::platform::windows::WindowExtWindows;
use tao::window::{Fullscreen, Icon, WindowBuilder};
use wry::{WebContext, WebViewBuilder};

const TITLE: &str = "Boo - Vicemi Dev";
const ICON_PNG: &[u8] = include_bytes!("../../assets/icon.png");
const START_URL: &str = "http://boo.localhost/index.html";

#[derive(Debug)]
enum UserEvent {
    Menu(MenuEvent),
    Ipc(String),
    /// hay una release más nueva que la instalada
    UpdateFound(update::Release),
    UpdateNone,
    UpdateError(String),
    UpdateProgress(f64),
    UpdateReady(std::path::PathBuf),
}

#[derive(Serialize, Deserialize, Clone)]
struct Settings {
    width: u32,
    height: u32,
    fullscreen: bool,
    maximized: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { width: 1024, height: 768, fullscreen: false, maximized: false }
    }
}

#[derive(Deserialize)]
struct Message {
    t: String,
    data: Option<serde_json::Value>,
}

/// carpeta de la instalación (donde está el .exe)
fn install_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())).unwrap_or_else(|| PathBuf::from("."))
}

fn icon() -> Option<Icon> {
    let decoder = png::Decoder::new(std::io::Cursor::new(ICON_PNG));
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    buf.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf.chunks(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        _ => return None,
    };
    Icon::from_rgba(rgba, info.width, info.height).ok()
}

fn about() {
    let _ = rfd::MessageDialog::new()
        .set_title("Créditos")
        .set_description(
            "Boo\n\
             Juego original de Trojan Chicken para el Plan Ceibal (OLPC).\n\n\
             Versión recreada (web y escritorio) por Vicemi Dev\n\
             https://vicemi.dev\n\n\
             El motor se reescribió en TypeScript y ejecuta el código Lua original del juego, con todos sus recursos originales.",
        )
        .set_level(rfd::MessageLevel::Info)
        .show();
}

fn main() {
    let base = saves::base_dir();
    let settings_path = base.join("data").join("settings.json");
    let mut settings: Settings = std::fs::read(&settings_path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    settings.width = settings.width.clamp(640, 7680);
    settings.height = settings.height.clamp(480, 4320);

    let game_dir = install_dir().join("game");
    if !game_dir.join("index.html").exists() {
        let _ = rfd::MessageDialog::new()
            .set_title("Boo")
            .set_description(format!("No se encontró el juego en:\n{}\n\nVuelve a instalarlo con el instalador.", game_dir.display()))
            .set_level(rfd::MessageLevel::Error)
            .show();
        return;
    }

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    {
        let p = proxy.clone();
        MenuEvent::set_event_handler(Some(move |e| {
            let _ = p.send_event(UserEvent::Menu(e));
        }));
    }

    let mut wb = WindowBuilder::new()
        .with_title(TITLE)
        .with_min_inner_size(LogicalSize::new(640.0, 480.0))
        .with_window_icon(icon());
    if settings.maximized {
        wb = wb.with_maximized(true);
    }
    let window = wb.build(&event_loop).expect("no se pudo crear la ventana");

    // ---- menú
    let m_save = MenuItem::with_id("save", "Guardar ahora", true, "Ctrl+S".parse::<Accelerator>().ok());
    let m_saveas = MenuItem::with_id("saveas", "Guardar una copia como...", true, None);
    let m_load = MenuItem::with_id("load", "Cargar partida desde un archivo...", true, None);
    let m_folder = MenuItem::with_id("folder", "Abrir la carpeta de partidas guardadas", true, None);
    let m_quit = MenuItem::with_id("quit", "Salir", true, "Alt+F4".parse::<Accelerator>().ok());
    let game_menu = Submenu::with_items("&Juego", true, &[&m_save, &m_saveas, &m_load, &m_folder, &PredefinedMenuItem::separator(), &m_quit]).unwrap();

    let m_full = MenuItem::with_id("fullscreen", "Pantalla completa", true, "F11".parse::<Accelerator>().ok());
    let sizes: [(u32, u32); 6] = [(800, 600), (1024, 768), (1280, 960), (1440, 1080), (1600, 1200), (1920, 1440)];
    let size_items: Vec<MenuItem> = sizes.iter().map(|(w, h)| MenuItem::with_id(format!("size:{w}x{h}"), format!("Ventana {w} x {h}"), true, None)).collect();
    let m_max = MenuItem::with_id("maximize", "Maximizar la ventana", true, None);
    let screen_menu = Submenu::new("&Pantalla", true);
    screen_menu.append(&m_full).unwrap();
    screen_menu.append(&PredefinedMenuItem::separator()).unwrap();
    for it in &size_items {
        screen_menu.append(it).unwrap();
    }
    screen_menu.append(&PredefinedMenuItem::separator()).unwrap();
    screen_menu.append(&m_max).unwrap();

    let m_update = MenuItem::with_id("update", "Buscar actualizaciones...", true, None);
    let m_about = MenuItem::with_id("about", "Créditos...", true, None);
    let m_site = MenuItem::with_id("site", "Visitar vicemi.dev", true, None);
    let m_web = MenuItem::with_id("web", "Jugar la versión web", true, None);
    let help_menu = Submenu::with_items("&Ayuda", true, &[&m_update, &PredefinedMenuItem::separator(), &m_about, &m_site, &m_web]).unwrap();

    let menu = Menu::new();
    menu.append_items(&[&game_menu, &screen_menu, &help_menu]).unwrap();
    let hwnd = window.hwnd() as isize;
    unsafe {
        let _ = menu.init_for_hwnd(hwnd);
    }
    // el tamaño se aplica con el menú ya puesto, así lo que se guarda y lo que se abre es lo mismo
    window.set_inner_size(LogicalSize::new(settings.width as f64, settings.height as f64));

    // ---- la partida de la carpeta de instalación llega a la página antes de que empiece el juego
    let saved = saves::load_progress(&base);
    let init_script = format!(
        "window.__BOO_DESKTOP__ = true; window.__BOO_SAVE__ = {};",
        serde_json::to_string(&saved).unwrap_or_else(|_| "null".into())
    );

    let mut context = WebContext::new(Some(base.join("data").join("webview")));
    let ipc_proxy = proxy.clone();
    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_url(START_URL)
        .with_initialization_script(init_script)
        .with_custom_protocol("boo".into(), {
            let game_dir = game_dir.clone();
            move |_id, request| server::respond(&game_dir, request)
        })
        .with_ipc_handler(move |req| {
            let _ = ipc_proxy.send_event(UserEvent::Ipc(req.into_body()));
        })
        .with_navigation_handler(|url| url.starts_with("http://boo.localhost") || url.starts_with("about:"))
        .with_new_window_req_handler(|url, _| {
            let _ = open::that(url);
            wry::NewWindowResponse::Deny
        })
        .with_devtools(false)
        .with_background_color((0, 0, 0, 255))
        .build(&window)
        .expect("no se pudo crear el webview (¿falta WebView2?)");

    if settings.fullscreen {
        window.set_fullscreen(Some(Fullscreen::Borderless(None)));
        hide_menu(&menu, hwnd);
    }

    let mut closing_deadline: Option<Instant> = None;
    let mut found: Option<update::Release> = None;

    // las novedades de la versión que se acaba de instalar, o la búsqueda automática de una versión más nueva
    {
        let mut st = update::load_state(&base);
        let just_updated = st.pending_version.clone().filter(|v| !update::is_newer(v, update::CURRENT) && !update::is_newer(update::CURRENT, v));
        if let Some(v) = just_updated {
            let info = serde_json::json!({ "whatsNew": true, "version": v, "name": st.pending_name.clone().unwrap_or_default(), "body": st.pending_body.clone().unwrap_or_default() });
            st.pending_version = None;
            st.pending_name = None;
            st.pending_body = None;
            update::save_state(&base, &st);
            let p = proxy.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(5));
                let _ = p.send_event(UserEvent::Ipc(serde_json::json!({ "t": "whatsnew", "data": info }).to_string()));
            });
        } else {
            let p = proxy.clone();
            let skipped = st.skipped.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(8));
                if let Ok(Some(rel)) = update::latest() {
                    if update::is_newer(&rel.version, update::CURRENT) && skipped.as_deref() != Some(rel.version.as_str()) {
                        let _ = p.send_event(UserEvent::UpdateFound(rel));
                    }
                }
            });
        }
    }
    let spawn_check = {
        let p = proxy.clone();
        move || {
            let p = p.clone();
            std::thread::spawn(move || match update::latest() {
                Ok(Some(rel)) if update::is_newer(&rel.version, update::CURRENT) => {
                    let _ = p.send_event(UserEvent::UpdateFound(rel));
                }
                Ok(_) => {
                    let _ = p.send_event(UserEvent::UpdateNone);
                }
                Err(e) => {
                    let _ = p.send_event(UserEvent::UpdateError(e));
                }
            });
        }
    };

    let toggle_fullscreen = move |window: &tao::window::Window, menu: &Menu| {
        if window.fullscreen().is_some() {
            window.set_fullscreen(None);
            show_menu(&menu, hwnd);
        } else {
            window.set_fullscreen(Some(Fullscreen::Borderless(None)));
            hide_menu(&menu, hwnd);
        }
    };

    event_loop.run(move |event, _, control_flow| {
        *control_flow = match closing_deadline {
            Some(d) => ControlFlow::WaitUntil(d),
            None => ControlFlow::Wait,
        };
        let _keep = (&context, &menu);
        match event {
            Event::NewEvents(StartCause::ResumeTimeReached { .. }) | Event::NewEvents(StartCause::Poll) => {
                if let Some(d) = closing_deadline {
                    if Instant::now() >= d {
                        *control_flow = ControlFlow::Exit;
                    }
                }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                if closing_deadline.is_none() {
                    // el juego guarda lo último que tenga pendiente y se cierra
                    let _ = webview.evaluate_script("window.__booSaveNow && window.__booSaveNow();");
                    closing_deadline = Some(Instant::now() + Duration::from_millis(700));
                    *control_flow = ControlFlow::WaitUntil(closing_deadline.unwrap());
                    let size = window.inner_size();
                    let s = Settings {
                        width: if window.is_maximized() || window.fullscreen().is_some() { settings.width } else { (size.width as f64 / window.scale_factor()) as u32 },
                        height: if window.is_maximized() || window.fullscreen().is_some() { settings.height } else { (size.height as f64 / window.scale_factor()) as u32 },
                        fullscreen: window.fullscreen().is_some(),
                        maximized: window.is_maximized(),
                    };
                    if let Some(parent) = settings_path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::write(&settings_path, serde_json::to_vec_pretty(&s).unwrap_or_default());
                }
            }
            Event::UserEvent(UserEvent::Menu(e)) => {
                let id = e.id().0.as_str();
                match id {
                    "save" => {
                        let _ = webview.evaluate_script("window.__booSaveNow && window.__booSaveNow();");
                    }
                    "saveas" => {
                        let _ = webview.evaluate_script("window.__booSaveAs && window.__booSaveAs();");
                    }
                    "load" => load_dialog(&webview, &base),
                    "folder" => {
                        let dir = saves::saves_dir(&base);
                        let _ = std::fs::create_dir_all(&dir);
                        let _ = open::that(dir);
                    }
                    "quit" => {
                        let _ = proxy.send_event(UserEvent::Ipc("{\"t\":\"quit\"}".into()));
                    }
                    "fullscreen" => toggle_fullscreen(&window, &menu),
                    "maximize" => {
                        window.set_fullscreen(None);
                        show_menu(&menu, hwnd);
                        window.set_maximized(true);
                    }
                    "update" => spawn_check(),
                    "about" => about(),
                    "site" => {
                        let _ = open::that("https://vicemi.dev");
                    }
                    "web" => {
                        let _ = open::that("https://boo.vicemi.dev");
                    }
                    s if s.starts_with("size:") => {
                        if let Some((w, h)) = s[5..].split_once('x') {
                            if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                                window.set_fullscreen(None);
                                show_menu(&menu, hwnd);
                                window.set_maximized(false);
                                window.set_inner_size(PhysicalSize::new(w, h));
                            }
                        }
                    }
                    _ => {}
                }
            }
            Event::UserEvent(UserEvent::UpdateFound(rel)) => {
                let info = serde_json::json!({ "version": rel.version, "current": update::CURRENT, "name": rel.name, "body": rel.body, "size": rel.size, "page": rel.page });
                let _ = webview.evaluate_script(&format!("window.__booUpdate && window.__booUpdate({info});"));
                found = Some(rel);
            }
            Event::UserEvent(UserEvent::UpdateNone) => {
                let _ = webview.evaluate_script(&format!("window.__booUpdateNone && window.__booUpdateNone({});", serde_json::json!(update::CURRENT)));
            }
            Event::UserEvent(UserEvent::UpdateError(e)) => {
                let _ = webview.evaluate_script(&format!("window.__booUpdateError && window.__booUpdateError({});", serde_json::json!(e)));
            }
            Event::UserEvent(UserEvent::UpdateProgress(v)) => {
                let _ = webview.evaluate_script(&format!("window.__booUpdateProgress && window.__booUpdateProgress({v});"));
            }
            Event::UserEvent(UserEvent::UpdateReady(path)) => {
                // el instalador reemplaza los archivos: el juego se cierra para soltarlos (las partidas y los datos no se tocan)
                let _ = webview.evaluate_script("window.__booSaveNow && window.__booSaveNow();");
                let _ = std::process::Command::new(&path).spawn();
                closing_deadline = Some(Instant::now() + Duration::from_millis(900));
            }
            Event::UserEvent(UserEvent::Ipc(body)) => {
                let Ok(msg) = serde_json::from_str::<Message>(&body) else { return };
                match msg.t.as_str() {
                    "save" => {
                        if let Some(text) = msg.data.as_ref().and_then(|d| d.as_str()) {
                            saves::save_progress(&base, text);
                        }
                    }
                    "saveas" => {
                        if let Some(text) = msg.data.as_ref().and_then(|d| d.as_str()) {
                            saves::save_progress(&base, text);
                            saves::save_copy_dialog(&base, text);
                        }
                    }
                    "load" => load_dialog(&webview, &base),
                    "fullscreen" => toggle_fullscreen(&window, &menu),
                    "whatsnew" => {
                        if let Some(info) = &msg.data {
                            let _ = webview.evaluate_script(&format!("window.__booUpdate && window.__booUpdate({info});"));
                        }
                    }
                    "update_download" => {
                        if let Some(rel) = found.clone() {
                            let p = proxy.clone();
                            let base2 = base.clone();
                            std::thread::spawn(move || {
                                let pp = p.clone();
                                match update::download(&rel, &move |v| {
                                    let _ = pp.send_event(UserEvent::UpdateProgress(v));
                                }) {
                                    Ok(path) => {
                                        // las novedades se muestran en el primer arranque de la versión nueva
                                        let mut st = update::load_state(&base2);
                                        st.pending_version = Some(rel.version.clone());
                                        st.pending_name = Some(rel.name.clone());
                                        st.pending_body = Some(rel.body.clone());
                                        update::save_state(&base2, &st);
                                        let _ = p.send_event(UserEvent::UpdateReady(path));
                                    }
                                    Err(e) => {
                                        let _ = p.send_event(UserEvent::UpdateError(e));
                                    }
                                }
                            });
                        }
                    }
                    "update_skip" => {
                        if let Some(rel) = &found {
                            let mut st = update::load_state(&base);
                            st.skipped = Some(rel.version.clone());
                            update::save_state(&base, &st);
                        }
                    }
                    "update_page" => {
                        if let Some(rel) = &found {
                            let _ = open::that(&rel.page);
                        }
                    }
                    "quit" => {
                        let _ = webview.evaluate_script("window.__booSaveNow && window.__booSaveNow();");
                        closing_deadline = Some(Instant::now() + Duration::from_millis(500));
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    });
}

/// elige un archivo de progreso y se lo da a la página (que lo carga y recarga el juego)
fn load_dialog(webview: &wry::WebView, base: &std::path::Path) {
    let dir = saves::saves_dir(base);
    let _ = std::fs::create_dir_all(&dir);
    let picked = rfd::FileDialog::new().set_title("Cargar partida").add_filter("Progreso de Boo", &["json"]).set_directory(&dir).pick_file();
    let Some(path) = picked else { return };
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            let lit = serde_json::to_string(&text).unwrap_or_else(|_| "\"\"".into());
            let _ = webview.evaluate_script(&format!("try {{ window.__booImport({lit}); }} catch (e) {{ alert('No es un archivo de progreso válido'); }}"));
        }
        Err(e) => {
            let _ = rfd::MessageDialog::new().set_title("Cargar partida").set_description(format!("No se pudo leer el archivo: {e}")).set_level(rfd::MessageLevel::Error).show();
        }
    }
}

fn show_menu(menu: &Menu, hwnd: isize) {
    unsafe {
        let _ = menu.show_for_hwnd(hwnd);
    }
}

fn hide_menu(menu: &Menu, hwnd: isize) {
    unsafe {
        let _ = menu.hide_for_hwnd(hwnd);
    }
}
