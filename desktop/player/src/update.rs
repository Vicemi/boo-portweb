//! Actualizaciones de la versión de escritorio: mira la última release del repositorio en GitHub, y si es más nueva que la instalada ofrece
//! descargar el instalador (con el registro de cambios = la descripción de la release). La web no necesita esto: se actualiza sola al recargar.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

pub const REPO: &str = "Vicemi/boo-portweb";
pub const CURRENT: &str = env!("CARGO_PKG_VERSION");

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Release {
    pub version: String,
    pub name: String,
    pub body: String,
    pub page: String,
    pub asset_url: String,
    pub asset_name: String,
    pub size: u64,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(20))).user_agent(format!("Boo-Vicemi/{CURRENT}")).build().into()
}

/// "v1.2.3" -> [1, 2, 3]
fn parts(v: &str) -> Vec<u64> {
    v.trim().trim_start_matches(['v', 'V']).split(['.', '-', '+']).map(|p| p.parse::<u64>().unwrap_or(0)).collect()
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    let (a, b) = (parts(candidate), parts(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

/// la última release publicada (None si no hay ninguna con un instalador adjunto)
pub fn latest() -> Result<Option<Release>, String> {
    // BOO_UPDATE_API: otra dirección con el mismo formato que la API de GitHub (para probar las actualizaciones)
    let url = std::env::var("BOO_UPDATE_API").unwrap_or_else(|_| format!("https://api.github.com/repos/{REPO}/releases/latest"));
    let mut resp = agent().get(&url).header("Accept", "application/vnd.github+json").call().map_err(|e| match e {
        ureq::Error::StatusCode(404) => "NOREL".to_string(),
        other => other.to_string(),
    });
    if let Err(e) = &resp {
        if e == "NOREL" {
            return Ok(None);
        }
    }
    let text = resp.as_mut().map_err(|e| e.clone())?.body_mut().read_to_string().map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let tag = v["tag_name"].as_str().unwrap_or("").to_string();
    let asset = v["assets"].as_array().and_then(|list| {
        list.iter().find(|a| {
            let n = a["name"].as_str().unwrap_or("").to_lowercase();
            n.ends_with(".exe") && (n.contains("instalador") || n.contains("setup") || n.contains("install"))
        })
    });
    let Some(asset) = asset else { return Ok(None) };
    Ok(Some(Release {
        version: tag.trim_start_matches(['v', 'V']).to_string(),
        name: v["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(&tag).to_string(),
        body: v["body"].as_str().unwrap_or("").to_string(),
        page: v["html_url"].as_str().unwrap_or("").to_string(),
        asset_url: asset["browser_download_url"].as_str().unwrap_or("").to_string(),
        asset_name: asset["name"].as_str().unwrap_or("Boo-Instalador.exe").to_string(),
        size: asset["size"].as_u64().unwrap_or(0),
    }))
}

/// descarga el instalador a la carpeta temporal avisando del progreso (0.0 - 1.0)
pub fn download(rel: &Release, progress: &dyn Fn(f64)) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("boo-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = rel.asset_name.chars().filter(|c| c.is_ascii_alphanumeric() || ".-_".contains(*c)).collect();
    let path = dir.join(if safe.is_empty() { "Boo-Instalador.exe".to_string() } else { safe });
    let ag = ureq::Agent::config_builder().timeout_connect(Some(Duration::from_secs(20))).timeout_recv_body(Some(Duration::from_secs(60))).user_agent(format!("Boo-Vicemi/{CURRENT}")).build().into();
    let ag: ureq::Agent = ag;
    let mut resp = ag.get(&rel.asset_url).call().map_err(|e| e.to_string())?;
    let total = resp.body().content_length().unwrap_or(rel.size).max(1);
    let mut reader = resp.body_mut().as_reader();
    let tmp = path.with_extension("part");
    let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 64 * 1024];
    let (mut done, mut last) = (0u64, Instant::now());
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if last.elapsed() > Duration::from_millis(200) {
            progress((done as f64 / total as f64).min(1.0));
            last = Instant::now();
        }
    }
    drop(out);
    if rel.size > 0 && done != rel.size {
        let _ = std::fs::remove_file(&tmp);
        return Err("La descarga quedó incompleta. Inténtalo de nuevo.".into());
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    progress(1.0);
    Ok(path)
}

// ---- estado guardado en data/update.json: versión omitida y novedades pendientes de mostrar después de actualizar
#[derive(Serialize, Deserialize, Default)]
pub struct State {
    pub skipped: Option<String>,
    pub pending_version: Option<String>,
    pub pending_name: Option<String>,
    pub pending_body: Option<String>,
}

fn state_path(base: &Path) -> PathBuf {
    base.join("data").join("update.json")
}

pub fn load_state(base: &Path) -> State {
    std::fs::read(state_path(base)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save_state(base: &Path, st: &State) {
    let p = state_path(base);
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(p, serde_json::to_vec_pretty(st).unwrap_or_default());
}
