use anyhow::{Context, Result, anyhow};
use tauri::AppHandle;

/// iOS's save dialog copies a file of that name from the app's Documents folder, and leaves one already there as it is (tauri-plugin-dialog 2.8). So the export is written there before the dialog opens.
#[cfg(target_os = "ios")]
pub fn write(app: &AppHandle, target: &str, text: &str) -> Result<()> {
    let path = staged(app, target)?;
    std::fs::write(&path, text).with_context(|| format!("cannot write {}", path.display()))
}

/// Android's save dialog returns a `content://` address, which only the fs plugin opens.
#[cfg(target_os = "android")]
pub fn write(app: &AppHandle, target: &str, text: &str) -> Result<()> {
    use std::io::Write;
    use std::str::FromStr;
    use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};
    let mut options = OpenOptions::new();
    options.write(true).truncate(true);
    let destination = FilePath::from_str(target).unwrap_or_else(|never| match never {});
    let mut file = app.fs().open(destination, options).context("cannot open the chosen file")?;
    file.write_all(text.as_bytes()).context("cannot write the export")
}

/// Removes what `write` left in Documents once the dialog closed.
pub fn discard(app: &AppHandle, target: &str) -> Result<()> {
    if cfg!(target_os = "ios") {
        let path = staged(app, target)?;
        if path.exists() {
            std::fs::remove_file(&path).with_context(|| format!("cannot remove {}", path.display()))?;
        }
    }
    Ok(())
}

fn staged(app: &AppHandle, target: &str) -> Result<std::path::PathBuf> {
    use tauri::Manager;
    let name = std::path::Path::new(target).file_name().filter(|name| *name == std::ffi::OsStr::new(target)).ok_or_else(|| anyhow!("not a file name: {target}"))?;
    Ok(app.path().document_dir()?.join(name))
}
