//! Partidas guardadas en la carpeta de la instalación: `saves/progress.json` (la partida actual), `saves/progress.bak.json` (la anterior) y
//! `saves/backups/` (copias con fecha). Si la carpeta de instalación no se puede escribir (por ejemplo en Archivos de programa) se usa
//! `%LOCALAPPDATA%\Boo-Vicemi`.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// carpeta donde viven `saves/` y `data/`: la de la instalación si se puede escribir, si no la del usuario
pub fn base_dir() -> PathBuf {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())).unwrap_or_else(|| PathBuf::from("."));
    let probe = exe_dir.join("data");
    if fs::create_dir_all(&probe).is_ok() {
        let t = probe.join(".write-test");
        if fs::write(&t, b"ok").is_ok() {
            let _ = fs::remove_file(t);
            return exe_dir;
        }
    }
    let fallback = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("Boo-Vicemi");
    let _ = fs::create_dir_all(&fallback);
    fallback
}

pub fn saves_dir(base: &Path) -> PathBuf {
    base.join("saves")
}

/// la última partida guardada (el texto del archivo), si existe y es válida; si la principal está dañada prueba con la anterior
pub fn load_progress(base: &Path) -> Option<String> {
    let dir = saves_dir(base);
    for name in ["progress.json", "progress.bak.json"] {
        if let Ok(text) = fs::read_to_string(dir.join(name)) {
            if is_valid(&text) {
                return Some(text);
            }
        }
    }
    None
}

fn is_valid(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).map(|v| v.get("game").and_then(|g| g.as_str()) == Some("boo") && v.get("files").map(|f| f.is_object()).unwrap_or(false)).unwrap_or(false)
}

/// guarda la partida de forma segura: escribe un archivo temporal, conserva el anterior como .bak y hace una copia con fecha cada 10 minutos
pub fn save_progress(base: &Path, text: &str) {
    if !is_valid(text) {
        return;
    }
    let dir = saves_dir(base);
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let main = dir.join("progress.json");
    let tmp = dir.join("progress.tmp");
    if fs::write(&tmp, text).is_err() {
        return;
    }
    if main.exists() {
        let _ = fs::copy(&main, dir.join("progress.bak.json"));
    }
    if fs::rename(&tmp, &main).is_err() {
        let _ = fs::copy(&tmp, &main);
        let _ = fs::remove_file(&tmp);
    }
    backup(&dir, text);
}

fn backup(dir: &Path, text: &str) {
    let folder = dir.join("backups");
    if fs::create_dir_all(&folder).is_err() {
        return;
    }
    let mut files: Vec<(SystemTime, PathBuf)> = fs::read_dir(&folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    files.sort();
    if let Some((last, _)) = files.last() {
        if last.elapsed().unwrap_or(Duration::ZERO) < Duration::from_secs(600) {
            return;
        }
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let _ = fs::write(folder.join(format!("progreso-{stamp}.json")), text);
    while files.len() >= 10 {
        let (_, old) = files.remove(0);
        let _ = fs::remove_file(old);
    }
}

/// "Guardar una copia como...": el usuario elige dónde
pub fn save_copy_dialog(base: &Path, text: &str) {
    let dir = saves_dir(base);
    let _ = fs::create_dir_all(&dir);
    let name = format!("boo-progreso-{}.json", chrono::Local::now().format("%Y-%m-%d"));
    if let Some(path) = rfd::FileDialog::new().set_title("Guardar una copia de la partida").set_file_name(name).add_filter("Progreso de Boo", &["json"]).set_directory(&dir).save_file() {
        if let Err(e) = fs::write(&path, text) {
            let _ = rfd::MessageDialog::new().set_title("Guardar").set_description(format!("No se pudo guardar: {e}")).set_level(rfd::MessageLevel::Error).show();
        }
    }
}
