use engine::speakers::Backend;

const GIB: u64 = 1 << 30;
const MIB: u64 = 1 << 20;

pub const RUN_HEADROOM: u64 = GIB;
pub const DISK_MINIMUM: u64 = GIB;
pub const DISK_RESERVE: u64 = 10 * GIB;
pub const DEFAULT_MEMORY_FLOOR: u64 = 400 * MIB;
pub const SWAP_GROWTH_LIMIT: u64 = 2 * GIB;

/// sherpa-onnx detection peaked at 1.3 GB on a 107-minute recording. It runs before the model loads.
pub const SHERPA_DETECTION_RAM: u64 = 3 << 29;
/// Nemotron on Metal peaked at 0.51 GB for 5 minutes and 3.6 GB for 107, growing linearly with the length.
const NEMOTRON_BASE_RAM: u64 = 512 * MIB;
const NEMOTRON_RAM_PER_SECOND: u64 = 512 << 10;

/// Word timing allocates this buffer for each line, plus a copy of the decoder's attention.
pub const WORD_TIMING_RAM: u64 = engine::words::ALIGNMENT_BYTES as u64 + 64 * MIB;

pub fn model_run_ram(model: u64) -> u64 {
    model.saturating_add(WORD_TIMING_RAM)
}

pub fn detection_ram(backend: Backend, sample_seconds: Option<f64>) -> u64 {
    match backend {
        Backend::Sherpa => SHERPA_DETECTION_RAM,
        Backend::Nemotron => match sample_seconds {
            Some(seconds) if !seconds.is_finite() || seconds < 0.0 => u64::MAX,
            Some(seconds) => NEMOTRON_BASE_RAM.saturating_add((seconds.ceil() * NEMOTRON_RAM_PER_SECOND as f64) as u64),
            None => NEMOTRON_BASE_RAM,
        },
    }
}

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
        "This transcription needs about {} of free memory, and {} is free.",
        gb(minimum),
        gb(free)
    ))
}

/// The largest model RAM that passes `can_start` and `can_use_gpu` with this much free memory.
pub fn model_budget(free: u64) -> u64 {
    free.saturating_sub(RUN_HEADROOM)
}

/// The largest model whose run, word timing included, passes `can_start_recording`, or none when detection and audio alone do not fit.
pub fn recording_budget(free: u64, detection: u64, sample_seconds: Option<f64>) -> Option<u64> {
    let audio = sample_seconds.map(decoded_audio_bytes).unwrap_or(0);
    let budget = free.checked_sub(audio)?.checked_sub(RUN_HEADROOM)?;
    (detection <= budget).then_some(budget)?.checked_sub(WORD_TIMING_RAM)
}

/// The largest model whose run, word timing included, passes `can_start`.
pub fn run_model_budget(free: u64) -> u64 {
    model_budget(free).saturating_sub(WORD_TIMING_RAM)
}

#[cfg(any(windows, test))]
pub fn can_use_gpu(free: u64, needed: u64) -> bool {
    needed.checked_add(RUN_HEADROOM).is_some_and(|minimum| free >= minimum)
}

pub fn can_download(free_disk: u64, size: u64) -> Result<(), String> {
    if size.checked_add(DISK_MINIMUM).is_some_and(|needed| free_disk >= needed) {
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

/// Bytes a setup still has to download. Speaker detection counts twice, as in its own download check.
pub fn setup_download_bytes(models: &[u64], detection: Option<u64>) -> u64 {
    models.iter().fold(0u64, |sum, size| sum.saturating_add(*size)).saturating_add(detection.unwrap_or(0).saturating_mul(2))
}

pub fn should_stop(free: u64, swap_used: u64, swap_at_start: u64, floor: u64) -> Option<String> {
    if free < floor {
        return Some(format!(
            "Stopped before the computer ran out of memory: only {} was left.",
            gb(free)
        ));
    }
    if swap_used > swap_at_start + SWAP_GROWTH_LIMIT {
        return Some(format!(
            "Stopped because the computer started swapping heavily: {} more than at the start.",
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
    fn word_timing_adds_to_the_model_memory() {
        assert_eq!(model_run_ram(GIB), GIB + WORD_TIMING_RAM);
        assert_eq!(model_run_ram(u64::MAX), u64::MAX);
        assert!(can_start(2 * GIB + WORD_TIMING_RAM, model_run_ram(GIB)).is_ok());
        assert!(can_start(2 * GIB, model_run_ram(GIB)).is_err());
        for free in [0, GIB, 9 * GIB + 7] {
            let budget = run_model_budget(free);
            assert_eq!(can_start(free, model_run_ram(budget)).is_ok(), free >= RUN_HEADROOM + WORD_TIMING_RAM);
            assert!(can_start(free, model_run_ram(budget + 1)).is_err());
        }
    }

    #[test]
    fn a_run_needs_the_model_plus_headroom() {
        assert!(can_start(4 * GIB, 2 * GIB).is_ok());
        assert!(can_start(3 * GIB, 2 * GIB).is_ok());
        let refused = can_start(3 * GIB - 1, 2 * GIB).unwrap_err();
        assert_eq!(refused, "This transcription needs about 3.0 GB of free memory, and 3.0 GB is free.");
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
        for backend in [Backend::Sherpa, Backend::Nemotron] {
            assert!(can_start_recording(3 * GIB, GIB, detection_ram(backend, Some(1059.0)), Some(1059.0)).is_ok());
            assert!(can_start_recording(2 * GIB, GIB, detection_ram(backend, Some(1059.0)), Some(1059.0)).is_err());
        }
    }

    #[test]
    fn nemotron_reserves_its_measured_peak_for_the_recording_length() {
        for (seconds, peak) in [(300.0, 513_246_192), (1503.0, 1_122_764_264), (3600.0, 2_163_312_800), (6425.0, 3_579_792_600)] {
            let reserve = detection_ram(Backend::Nemotron, Some(seconds));
            assert!(reserve >= peak && reserve < peak + peak / 2, "{seconds} s: {reserve} for a peak of {peak}");
        }
        assert!(can_start_recording(8 * GIB, GIB, detection_ram(Backend::Nemotron, Some(6425.0)), Some(6425.0)).is_ok());
        assert!(can_start_recording(5 * GIB, GIB, detection_ram(Backend::Nemotron, Some(6425.0)), Some(6425.0)).is_err());
        assert_eq!(detection_ram(Backend::Nemotron, Some(f64::INFINITY)), u64::MAX);
        assert_eq!(detection_ram(Backend::Nemotron, Some(-1.0)), u64::MAX);
    }

    #[test]
    fn the_model_budget_is_the_largest_model_that_starts() {
        for free in [0, GIB / 2, 3 * GIB, 9 * GIB + 7] {
            let budget = model_budget(free);
            assert_eq!(can_start(free, budget).is_ok(), free >= RUN_HEADROOM);
            assert_eq!(can_use_gpu(free, budget), free >= RUN_HEADROOM);
            assert!(can_start(free, budget + 1).is_err());
            assert!(!can_use_gpu(free, budget + 1));
        }
    }

    #[test]
    fn the_recording_budget_is_the_largest_model_that_starts_with_this_recording() {
        for (free, detection, seconds) in [(3 * GIB, 0, Some(3600.0)), (9 * GIB + 7, SHERPA_DETECTION_RAM, Some(1059.0)), (4 * GIB, GIB, None)] {
            let budget = recording_budget(free, detection, seconds).unwrap();
            assert!(can_start_recording(free, model_run_ram(budget), detection, seconds).is_ok());
            assert!(can_start_recording(free, model_run_ram(budget + 1), detection, seconds).is_err());
        }
    }

    #[test]
    fn no_recording_budget_when_detection_or_audio_alone_do_not_fit() {
        assert_eq!(recording_budget(2 * GIB, SHERPA_DETECTION_RAM, Some(60.0)), None);
        assert!(recording_budget(3 * GIB, SHERPA_DETECTION_RAM, Some(60.0)).is_some());
        assert_eq!(recording_budget(GIB / 2, 0, None), None);
        assert_eq!(recording_budget(u64::MAX, 0, Some(f64::INFINITY)), None);
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
    fn a_setup_needs_room_for_all_its_downloads_at_once() {
        let models = [GIB, 2 * GIB];
        assert!(models.iter().all(|size| can_download(3 * GIB, *size).is_ok()));
        assert_eq!(setup_download_bytes(&models, Some(100 * MIB)), 3 * GIB + 200 * MIB);
        assert!(can_download(3 * GIB, setup_download_bytes(&models, None)).is_err());
        assert!(can_download(4 * GIB, setup_download_bytes(&models, None)).is_ok());
        assert_eq!(setup_download_bytes(&[u64::MAX], Some(1)), u64::MAX);
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
