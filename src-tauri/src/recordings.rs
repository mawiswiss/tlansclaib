#![cfg_attr(not(mobile), allow(dead_code))]

use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

use crate::history::{History, Kind};

/// iOS hands the app a temporary copy and Android a content URI, so the app keeps a copy of its own for playback and transcribing again.
pub fn keep(app: &AppHandle, picked: &str) -> Result<PathBuf> {
    let source = FilePath::from_str(picked).unwrap_or_else(|never| match never {});
    let fallback = file_name(&source);
    let mut options = OpenOptions::new();
    options.read(true);
    let mut file = app.fs().open(source, options).context("cannot open the recording")?;
    let name = opened_name(&file).unwrap_or(fallback);
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let dir = folder(app)?;
    std::fs::create_dir_all(&dir)?;
    crate::guard::can_keep_recording(crate::models::free_disk(&dir), size).map_err(|e| anyhow!(e))?;
    let id = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let target = dir.join(id.to_string()).join(name);
    std::fs::create_dir_all(target.parent().unwrap_or(&dir))?;
    let copied = std::io::copy(&mut file, &mut std::fs::File::create(&target)?);
    if let Err(error) = copied {
        let _ = std::fs::remove_dir_all(target.parent().unwrap_or(&target));
        return Err(error).context("cannot copy the recording");
    }
    Ok(target)
}

/// Deletes the app's copy of a recording once no history entry needs it.
pub fn forget(app: &AppHandle, audio: &Path) {
    let (Ok(dir), Ok(entries)) = (folder(app), app.state::<History>().list()) else { return };
    let Some(copy) = current(audio, &dir) else { return };
    if entries.iter().any(|listed| current(&listed.entry.audio, &dir).as_ref() == Some(&copy)) {
        return;
    }
    if let Some(own) = copy.parent() {
        let _ = std::fs::remove_dir_all(own);
    }
}

/// Points history entries back at their copies after iOS moved the app's data folder, which it does on a reinstall.
pub fn rebase(app: &AppHandle) {
    let history = app.state::<History>();
    let (Ok(dir), Ok(entries)) = (folder(app), history.list()) else { return };
    for listed in entries.iter().filter(|listed| !listed.audio_exists) {
        let Some(copy) = current(&listed.entry.audio, &dir).filter(|copy| copy.is_file()) else { continue };
        if let Err(error) = history.relocate(listed.entry.id, Kind::Audio, &copy) {
            log::warn!("could not point a history entry at its kept recording: {error:#}");
        }
    }
}

/// Deletes copies left behind by a recording that was picked but never transcribed, or dropped from a full history.
pub fn prune(app: &AppHandle) {
    let (Ok(dir), Ok(entries)) = (folder(app), app.state::<History>().list()) else { return };
    let Ok(folders) = std::fs::read_dir(&dir) else { return };
    for own in folders.flatten().map(|entry| entry.path()) {
        if !entries.iter().any(|listed| current(&listed.entry.audio, &dir).is_some_and(|copy| copy.starts_with(&own))) {
            let _ = std::fs::remove_dir_all(&own);
        }
    }
}

fn folder(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("recordings"))
}

/// Where a kept copy is now, whichever data folder the history recorded it in.
fn current(audio: &Path, dir: &Path) -> Option<PathBuf> {
    let own = audio.parent()?;
    if own.parent()?.file_name()? != "recordings" {
        return None;
    }
    Some(dir.join(own.file_name()?).join(audio.file_name()?))
}

/// Android's Downloads URIs end in a document id, but the descriptor of a local file links to its path.
#[cfg(target_os = "android")]
fn opened_name(file: &std::fs::File) -> Option<String> {
    use std::os::fd::AsRawFd;
    let target = std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd())).ok()?;
    target.extension()?;
    Some(name_from(&target.file_name()?.to_string_lossy()))
}

#[cfg(not(target_os = "android"))]
fn opened_name(_: &std::fs::File) -> Option<String> {
    None
}

fn file_name(source: &FilePath) -> String {
    let raw = match source {
        FilePath::Path(path) => path.file_name().map(|n| n.to_string_lossy().into_owned()),
        FilePath::Url(url) => url.path_segments().and_then(|mut segments| segments.next_back()).map(|last| percent_encoding::percent_decode_str(last).decode_utf8_lossy().into_owned()),
    };
    name_from(raw.as_deref().unwrap_or_default())
}

// An Android document id such as primary:Download/a.m4a carries the folder in front of the name.
fn name_from(raw: &str) -> String {
    let name = raw.rsplit(['/', ':']).next().unwrap_or_default().trim();
    if name.is_empty() || name == "." || name == ".." { "recording".into() } else { name.to_string() }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{current, name_from};

    #[test]
    fn a_kept_copy_takes_the_name_the_picker_shows() {
        assert_eq!(name_from("meeting.m4a"), "meeting.m4a");
        assert_eq!(name_from("primary:Download/meeting.m4a"), "meeting.m4a");
        assert_eq!(name_from("msf:1000000034"), "1000000034");
        assert_eq!(name_from(".."), "recording");
        assert_eq!(name_from(""), "recording");
    }

    #[test]
    fn a_kept_copy_is_found_after_the_data_folder_moved() {
        let dir = Path::new("/data/new/recordings");
        assert_eq!(current(Path::new("/data/old/recordings/17/meeting.m4a"), dir), Some(PathBuf::from("/data/new/recordings/17/meeting.m4a")));
        assert_eq!(current(Path::new("/data/old/Documents/meeting.m4a"), dir), None);
    }
}
