//! Sirve los archivos de `game/` al webview por el protocolo `boo` (http://boo.localhost/...), con soporte de `Range` (el juego lee de sus
//! paquetes de imágenes por tramos).
use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use wry::http::{header, Request, Response, StatusCode};

fn plain(status: StatusCode, msg: &'static str) -> Response<Cow<'static, [u8]>> {
    Response::builder().status(status).header(header::CONTENT_TYPE, "text/plain; charset=utf-8").body(Cow::Borrowed(msg.as_bytes())).unwrap()
}

fn mime(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "m4a" => "audio/mp4".into(),
        "ogg" => "audio/ogg".into(),
        "webmanifest" => "application/manifest+json".into(),
        _ => mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string(),
    }
}

pub fn respond(game_dir: &Path, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let raw = request.uri().path();
    let decoded = percent_encoding::percent_decode_str(raw).decode_utf8_lossy().to_string();
    let rel = decoded.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    if rel.split('/').any(|p| p == ".." || p.contains('\\') || p.contains(':')) {
        return plain(StatusCode::BAD_REQUEST, "bad path");
    }
    let path = game_dir.join(rel);
    let Ok(mut file) = File::open(&path) else { return plain(StatusCode::NOT_FOUND, "not found") };
    let Ok(meta) = file.metadata() else { return plain(StatusCode::NOT_FOUND, "not found") };
    if !meta.is_file() {
        return plain(StatusCode::NOT_FOUND, "not found");
    }
    let len = meta.len();
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes=")).and_then(|v| {
        let (a, b) = v.split_once('-')?;
        let start: u64 = if a.is_empty() { len.saturating_sub(b.parse::<u64>().ok()?) } else { a.parse().ok()? };
        let end: u64 = if a.is_empty() || b.is_empty() { len.saturating_sub(1) } else { b.parse::<u64>().ok()?.min(len.saturating_sub(1)) };
        if start > end || start >= len { None } else { Some((start, end)) }
    });
    let builder = Response::builder().header(header::CONTENT_TYPE, mime(&path)).header(header::ACCEPT_RANGES, "bytes").header(header::CACHE_CONTROL, "no-cache");
    match range {
        Some((start, end)) => {
            let mut buf = vec![0u8; (end - start + 1) as usize];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
                return plain(StatusCode::INTERNAL_SERVER_ERROR, "read error");
            }
            builder.status(StatusCode::PARTIAL_CONTENT).header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}")).body(Cow::Owned(buf)).unwrap()
        }
        None => {
            let mut buf = Vec::with_capacity(len as usize);
            if file.read_to_end(&mut buf).is_err() {
                return plain(StatusCode::INTERNAL_SERVER_ERROR, "read error");
            }
            builder.status(StatusCode::OK).body(Cow::Owned(buf)).unwrap()
        }
    }
}
