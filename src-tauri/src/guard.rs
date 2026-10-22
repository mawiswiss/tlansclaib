const GIB: u64 = 1 << 30;
const MIB: u64 = 1 << 20;

pub const RUN_HEADROOM: u64 = GIB;
pub const DISK_MINIMUM: u64 = GIB;
pub const DISK_RESERVE: u64 = 10 * GIB;
pub const DEFAULT_MEMORY_FLOOR: u64 = 400 * MIB;
pub const SWAP_GROWTH_LIMIT: u64 = 2 * GIB;

pub const DETECTION_RAM: u64 = 3 << 29;

const AUDIO_BYTES_PER_SECOND: u64 = 16_000 * 4 * 3;
const TRANSCRIPT_BYTES_PER_SECOND: u64 = 4096;

pub fn can_store_transcript(free_disk: u64, sample_seconds: Option<f64>) -> Result<(), String> {
    let bytes = sample_seconds
        .map(|seconds| {
            if !seconds.is_finite() || seconds < 0.0 {
                return u64::MAX;
            }
            (seconds.ceil() * (TRANSCRIPT_BYTES_PER_SECOND * 2) as f64) as u64
        })
        .unwrap_or(0);
    if bytes.checked_add(DISK_MINIMUM).is_some_and(|minimum| free_disk >= minimum) {
        return Ok(());
    }
    Err(format!(
        "This transcription needs about {} of free disk space and {} is free. Make room on the app data disk first.",
        gb(bytes.saturating_add(DISK_MINIMUM)),
        gb(free_disk)
    ))
}

pub fn decoded_audio_bytes(sample_seconds: f64) -> u64 {
    if !sample_seconds.is_finite() || sample_seconds < 0.0 {
        return u64::MAX;
    }
    (sample_seconds.ceil() * (AUDIO_BYTES_PER_SECOND + TRANSCRIPT_BYTES_PER_SECOND) as f64) as u64
}

pub fn can_start_recording(free: u64, model: u64, detection: u64, sample_seconds: Option<f64>) -> Result<(), String> {
    let audio = sample_seconds.map(decoded_audio_bytes).unwrap_or(0);
    can_start(free, model.max(detection).saturating_add(audio))
}

pub fn can_start(free: u64, needed: u64) -> Result<(), String> {
    let minimum = needed.saturating_add(RUN_HEADROOM);
    if needed.checked_add(RUN_HEADROOM).is_some_and(|minimum| free >= minimum) {
        return Ok(());
    }
    Err(format!(
        "This transcription needs about {} of free RAM and {} is free. Close other programs, choose a smaller model, or use a shorter recording.",
        gb(minimum),
        gb(free)
    ))
}

#[cfg(any(windows, test))]
pub fn can_use_gpu(free: u64, needed: u64) -> bool {
    needed.checked_add(RUN_HEADROOM).is_some_and(|minimum| free >= minimum)
}

pub fn can_download(free_disk: u64, size: u64) -> Result<(), String> {
    if free_disk >= size + DISK_MINIMUM {
        return Ok(());
    }
    Err(format!(
        "Not enough disk space: the model needs {} plus {} to spare, and {} is free. Make room on the disk first.",
        gb(size),
        gb(DISK_MINIMUM),
        gb(free_disk)
    ))
}

pub fn can_update(free_disk: u64) -> Result<(), String> {
    if free_disk >= DISK_MINIMUM {
        return Ok(());
    }
    Err(format!(
        "Not enough disk space for the update: it needs {} to spare, and {} is free. Make room on the disk first.",
        gb(DISK_MINIMUM),
        gb(free_disk)
    ))
}

pub fn should_stop(free: u64, swap_used: u64, swap_at_start: u64, floor: u64) -> Option<String> {
    if free < floor {
        return Some(format!(
            "Stopped before the computer ran out of memory: only {} was left. Close other programs or choose a smaller model.",
            gb(free)
        ));
    }
    if swap_used > swap_at_start + SWAP_GROWTH_LIMIT {
        return Some(format!(
            "Stopped because the computer started swapping heavily ({} more than at the start). Close other programs or choose a smaller model.",
            gb(swap_used - swap_at_start)
        ));
    }
    None
}

pub fn memory_floor() -> u64 {
    std::env::var("TLANSCLAIB_MEMORY_FLOOR_MB")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(|mb| mb * MIB)
        .unwrap_or(DEFAULT_MEMORY_FLOOR)
}

pub fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / GIB as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_needs_the_model_plus_headroom() {
        assert!(can_start(4 * GIB, 2 * GIB).is_ok());
        assert!(can_start(3 * GIB, 2 * GIB).is_ok());
        let refused = can_start(3 * GIB - 1, 2 * GIB).unwrap_err();
        assert!(refused.contains("3.0 GB of free RAM"), "{refused}");
        assert!(refused.contains("smaller model"));
    }

    #[test]
    fn long_audio_adds_to_model_memory_without_overflow() {
        assert_eq!(decoded_audio_bytes(3600.0), 705_945_600);
        assert!(can_start_recording(3 * GIB, GIB, 0, Some(3600.0)).is_ok());
        assert!(can_start_recording(2 * GIB, GIB, 0, Some(3600.0)).is_err());
        assert!(can_start_recording(u64::MAX, GIB, 0, Some(f64::INFINITY)).is_err());
        assert!(can_start_recording(GIB, GIB, 0, Some(f64::INFINITY)).is_err());
    }

    #[test]
    fn speaker_detection_reserves_memory_before_loading_whisper() {
        assert!(can_start_recording(3 * GIB, GIB, DETECTION_RAM, Some(1059.0)).is_ok());
        assert!(can_start_recording(2 * GIB, GIB, DETECTION_RAM, Some(1059.0)).is_err());
    }

    #[test]
    fn a_gpu_needs_the_model_plus_headroom() {
        assert!(can_use_gpu(3 * GIB, 2 * GIB));
        assert!(!can_use_gpu(3 * GIB - 1, 2 * GIB));
        assert!(!can_use_gpu(u64::MAX, u64::MAX));
    }

    #[test]
    fn a_download_needs_the_file_plus_one_gigabyte() {
        assert!(can_download(2 * GIB, GIB).is_ok());
        let refused = can_download(2 * GIB - 1, GIB).unwrap_err();
        assert!(refused.contains("plus 1.0 GB to spare"), "{refused}");
    }

    #[test]
    fn an_update_needs_one_gigabyte_to_spare() {
        assert!(can_update(GIB).is_ok());
        let refused = can_update(GIB - 1).unwrap_err();
        assert!(refused.contains("needs 1.0 GB to spare"), "{refused}");
    }

    #[test]
    fn private_transcript_storage_needs_room_for_scratch_and_json() {
        let hour = 3600.0;
        let needed = DISK_MINIMUM + 3600 * TRANSCRIPT_BYTES_PER_SECOND * 2;
        assert!(can_store_transcript(needed, Some(hour)).is_ok());
        assert!(can_store_transcript(needed - 1, Some(hour)).is_err());
        assert!(can_store_transcript(DISK_MINIMUM, None).is_ok());
    }

    #[test]
    fn stops_on_low_memory_or_swap_growth() {
        assert_eq!(should_stop(GIB, 0, 0, DEFAULT_MEMORY_FLOOR), None);
        assert!(should_stop(300 * MIB, 0, 0, DEFAULT_MEMORY_FLOOR).unwrap().contains("ran out of memory"));
        assert_eq!(should_stop(GIB, 3 * GIB, 2 * GIB, DEFAULT_MEMORY_FLOOR), None);
        assert!(should_stop(GIB, 5 * GIB, 2 * GIB, DEFAULT_MEMORY_FLOOR).unwrap().contains("swapping"));
    }

    #[test]
    fn the_floor_is_overridable_for_tests() {
        assert_eq!(memory_floor(), DEFAULT_MEMORY_FLOOR);
    }
}
