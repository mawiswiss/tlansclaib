use std::io::ErrorKind;
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::Value;

const FILE: &str = "settings.json";

pub fn write(dir: &Path, settings: &Value) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let part = dir.join(format!("{FILE}.part"));
    std::fs::write(&part, serde_json::to_vec_pretty(settings)?)?;
    std::fs::rename(&part, dir.join(FILE))?;
    Ok(())
}

pub fn read(dir: &Path) -> Result<Option<Value>> {
    let text = match std::fs::read(dir.join(FILE)) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).context("cannot read the saved settings"),
    };
    Ok(Some(serde_json::from_slice(&text).context("the saved settings are damaged")?))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn folder(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tlansclaib-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn saved_settings_read_back_unchanged() {
        let dir = folder("round-trip");
        let settings = json!({ "theme": "dark", "dismissed": ["better:small"], "transcribed": 3 });
        write(&dir, &settings).unwrap();
        assert_eq!(read(&dir).unwrap(), Some(settings));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn no_file_means_no_saved_settings() {
        assert_eq!(read(&folder("missing")).unwrap(), None);
    }

    #[test]
    fn a_second_save_replaces_the_first_and_leaves_no_part_file() {
        let dir = folder("replace");
        write(&dir, &json!({ "theme": "dark" })).unwrap();
        write(&dir, &json!({ "theme": "light" })).unwrap();
        assert_eq!(read(&dir).unwrap(), Some(json!({ "theme": "light" })));
        assert!(!dir.join("settings.json.part").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_damaged_file_is_an_error_not_missing_settings() {
        let dir = folder("damaged");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), "{\"theme\":").unwrap();
        assert!(read(&dir).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
