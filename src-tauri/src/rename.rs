use std::ffi::OsString;
use std::path::Path;

const FORMER: &str = "tlansclaib";
const STARTUP_ONLY: [&str; 2] = ["logs", "EBWebView"];

#[derive(Debug, PartialEq)]
pub enum Step {
    Nothing,
    Move,
    Replace,
    Keep,
}

pub fn plan(old: Option<&[OsString]>, new: Option<&[OsString]>) -> Step {
    match (old, new) {
        (None, _) => Step::Nothing,
        (Some(_), None) => Step::Move,
        (Some(_), Some(new)) if new.iter().all(|name| STARTUP_ONLY.iter().any(|startup| name == *startup)) => Step::Replace,
        (Some(_), Some(_)) => Step::Keep,
    }
}

fn entries(dir: &Path) -> Option<Vec<OsString>> {
    Some(std::fs::read_dir(dir).ok()?.flatten().map(|entry| entry.file_name()).collect())
}

pub fn move_folder(root: &Path, identifier: &str) -> std::io::Result<Step> {
    let old = root.join(FORMER);
    let new = root.join(identifier);
    let step = plan(entries(&old).as_deref(), entries(&new).as_deref());
    match step {
        Step::Move => std::fs::rename(&old, &new)?,
        Step::Replace => {
            std::fs::remove_dir_all(&new)?;
            std::fs::rename(&old, &new)?;
        }
        Step::Nothing | Step::Keep => {}
    }
    Ok(step)
}

pub fn rebase(path: &str, old: &Path, new: &Path) -> Option<String> {
    let rest = Path::new(path).strip_prefix(old).ok()?;
    Some(new.join(rest).to_string_lossy().into_owned())
}

fn rewrite_history(old: &Path, new: &Path) -> anyhow::Result<bool> {
    let file = new.join("history.json");
    let text = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    let mut entries: serde_json::Value = serde_json::from_str(&text)?;
    let mut changed = false;
    for entry in entries.as_array_mut().into_iter().flatten() {
        for key in ["file", "audio"] {
            let Some(moved) = entry.get(key).and_then(|value| value.as_str()).and_then(|path| rebase(path, old, new)) else {
                continue;
            };
            entry[key] = moved.into();
            changed = true;
        }
    }
    if changed {
        let part = file.with_extension("json.part");
        std::fs::write(&part, serde_json::to_vec_pretty(&entries)?)?;
        std::fs::rename(&part, &file)?;
    }
    Ok(changed)
}

/// Moves the data of the app's former name into the folders of `identifier`. Runs before Tauri starts, which creates them.
pub fn migrate(identifier: &str) -> Vec<String> {
    let mut notes = Vec::new();
    let data = dirs::data_dir();
    let mut roots: Vec<_> = [data.clone(), dirs::data_local_dir()].into_iter().flatten().collect();
    roots.dedup();
    for root in &roots {
        match move_folder(root, identifier) {
            Ok(Step::Nothing) => {}
            Ok(Step::Keep) => notes.push("a data folder of the former name stays, because the current one already holds data".into()),
            Ok(step) => {
                notes.push(format!("moved a data folder of the former name ({step:?})"));
                if Some(root) == data.as_ref() {
                    match rewrite_history(&root.join(FORMER), &root.join(identifier)) {
                        Ok(true) => notes.push("updated the paths in the history to the moved folder".into()),
                        Ok(false) => {}
                        Err(error) => notes.push(format!("could not update the paths in the history: {error:#}")),
                    }
                }
            }
            Err(error) => notes.push(format!("could not move a data folder of the former name: {error}")),
        }
    }
    // WKWebView keeps local storage, and so the settings, under the bundle id. Linux and Windows keep it in the local data folder.
    #[cfg(target_os = "macos")]
    if let Some(webkit) = dirs::home_dir().map(|home| home.join("Library").join("WebKit")) {
        match move_folder(&webkit, identifier) {
            Ok(Step::Nothing) => {}
            Ok(Step::Keep) => notes.push("the webview data of the former name stays, because the current one already holds data".into()),
            Ok(step) => notes.push(format!("moved the webview data of the former name ({step:?})")),
            Err(error) => notes.push(format!("could not move the webview data of the former name: {error}")),
        }
    }
    notes
}

/// The bundle to rename when an in-app update kept the former name, and its new path.
#[cfg(any(target_os = "macos", test))]
pub fn bundle_move(exe: &Path, product: &str) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    if macos.file_name()? != "MacOS" || contents.file_name()? != "Contents" || bundle.file_name()? != format!("{FORMER}.app").as_str() {
        return None;
    }
    Some((bundle.to_path_buf(), bundle.with_file_name(format!("{product}.app"))))
}

#[cfg(target_os = "macos")]
pub fn rename_bundle(product: &str) -> Option<String> {
    let (from, to) = bundle_move(&std::env::current_exe().ok()?, product)?;
    if to.exists() {
        return Some("kept the app's former file name, because one with the new name is already there".into());
    }
    Some(match std::fs::rename(&from, &to) {
        Ok(()) => "renamed the app's file to the new name".into(),
        Err(error) => format!("could not rename the app's file to the new name: {error}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn names(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn plans_each_case() {
        assert_eq!(plan(None, None), Step::Nothing);
        assert_eq!(plan(None, Some(&names(&["history.json"]))), Step::Nothing);
        assert_eq!(plan(Some(&names(&["models"])), None), Step::Move);
        assert_eq!(plan(Some(&names(&["models"])), Some(&names(&["logs", "EBWebView"]))), Step::Replace);
        assert_eq!(plan(Some(&names(&["models"])), Some(&names(&[]))), Step::Replace);
        assert_eq!(plan(Some(&names(&["models"])), Some(&names(&["logs", "history.json"]))), Step::Keep);
    }

    #[test]
    fn rebases_only_paths_inside_the_old_folder() {
        let old = Path::new("/data/former");
        let new = Path::new("/data/current");
        assert_eq!(rebase("/data/former/transcripts/7.json", old, new).map(PathBuf::from), Some(new.join("transcripts").join("7.json")));
        assert_eq!(rebase("/recordings/meeting.m4a", old, new), None);
        assert_eq!(rebase("/data/former-notes/meeting.m4a", old, new), None);
    }

    #[test]
    fn renames_only_a_bundle_of_the_former_name() {
        let exe = Path::new("/Applications/tlansclaib.app/Contents/MacOS/wavetyper");
        assert_eq!(bundle_move(exe, "wavetyper"), Some((PathBuf::from("/Applications/tlansclaib.app"), PathBuf::from("/Applications/wavetyper.app"))));
        assert_eq!(bundle_move(Path::new("/Applications/wavetyper.app/Contents/MacOS/wavetyper"), "wavetyper"), None);
        assert_eq!(bundle_move(Path::new("/code/tlansclaib.app/target/debug/wavetyper"), "wavetyper"), None);
        assert_eq!(bundle_move(Path::new("/code/target/debug/wavetyper"), "wavetyper"), None);
    }

    #[test]
    fn moves_the_folder_and_its_history_paths() {
        let root = std::env::temp_dir().join(format!("wavetyper-former-name-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let old = root.join(FORMER);
        std::fs::create_dir_all(old.join("transcripts")).unwrap();
        std::fs::write(old.join("transcripts/7.json"), "{}").unwrap();
        let entries = serde_json::json!([
            { "id": 7, "file": old.join("transcripts/7.json"), "audio": old.join("recordings/7/meeting.m4a") },
            { "id": 8, "file": "/recordings/notes.txt", "audio": "/recordings/notes.m4a" }
        ]);
        std::fs::write(old.join("history.json"), entries.to_string()).unwrap();
        std::fs::create_dir_all(root.join("current/logs")).unwrap();

        assert_eq!(move_folder(&root, "current").unwrap(), Step::Replace);
        assert!(!old.exists());
        let new = root.join("current");
        assert!(new.join("transcripts/7.json").is_file());
        assert!(rewrite_history(&old, &new).unwrap());
        let moved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(new.join("history.json")).unwrap()).unwrap();
        assert_eq!(moved[0]["file"], new.join("transcripts/7.json").to_string_lossy().as_ref());
        assert_eq!(moved[0]["audio"], new.join("recordings/7/meeting.m4a").to_string_lossy().as_ref());
        assert_eq!(moved[1]["file"], "/recordings/notes.txt");
        assert_eq!(move_folder(&root, "current").unwrap(), Step::Nothing);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
