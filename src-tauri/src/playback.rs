//! Android's webview applies a range request again to the part Tauri's asset protocol already cut out,
//! so there the page reads a recording through this protocol in chunks and plays its own copy.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use tauri::http::{Request, Response, StatusCode, header};

pub const SCHEME: &str = "audio";
const CHUNK: u64 = 4 << 20;

pub fn respond(request: &Request<Vec<u8>>, allowed: impl Fn(&Path) -> bool) -> Response<Vec<u8>> {
    let (status, body) = match chunk(request, allowed) {
        Ok(body) => (StatusCode::OK, body),
        Err(status) => (status, Vec::new()),
    };
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_default()
}

fn chunk(request: &Request<Vec<u8>>, allowed: impl Fn(&Path) -> bool) -> Result<Vec<u8>, StatusCode> {
    let uri = request.uri();
    let offset: u64 = uri.query().and_then(|q| q.strip_prefix("offset=")).and_then(|o| o.parse().ok()).ok_or(StatusCode::BAD_REQUEST)?;
    let path = percent_encoding::percent_decode(uri.path().trim_start_matches('/').as_bytes()).decode_utf8_lossy();
    let path = Path::new(path.as_ref());
    if !allowed(path) {
        return Err(StatusCode::FORBIDDEN);
    }
    let read = || -> std::io::Result<Vec<u8>> {
        let mut file = std::fs::File::open(path)?;
        file.seek(SeekFrom::Start(offset))?;
        let mut chunk = Vec::new();
        file.take(CHUNK).read_to_end(&mut chunk)?;
        Ok(chunk)
    };
    read().map_err(|_| StatusCode::NOT_FOUND)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &Path, query: &str) -> Request<Vec<u8>> {
        let encoded = percent_encoding::utf8_percent_encode(&path.to_string_lossy(), percent_encoding::NON_ALPHANUMERIC).to_string();
        Request::builder().uri(format!("http://{SCHEME}.localhost/{encoded}{query}")).body(Vec::new()).unwrap()
    }

    #[test]
    fn a_recording_comes_in_chunks_from_the_offset_asked_for() {
        let path = std::env::temp_dir().join(format!("wavetyper playback {}.bin", std::process::id()));
        let data: Vec<u8> = (0..CHUNK + 10).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &data).unwrap();
        let first = respond(&request(&path, "?offset=0"), |_| true);
        let rest = respond(&request(&path, &format!("?offset={CHUNK}")), |_| true);
        let past = respond(&request(&path, &format!("?offset={}", data.len())), |_| true);
        let refused = respond(&request(&path, "?offset=0"), |_| false);
        let unasked = respond(&request(&path, ""), |_| true);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!([first.body().as_slice(), rest.body()].concat(), data);
        assert!(past.body().is_empty());
        assert_eq!(refused.status(), StatusCode::FORBIDDEN);
        assert_eq!(unasked.status(), StatusCode::BAD_REQUEST);
    }
}
