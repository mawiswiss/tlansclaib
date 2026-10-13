const GIB: u64 = 1 << 30;
const MIB: u64 = 1 << 20;

pub const RUN_HEADROOM: u64 = GIB;
pub const DISK_HEADROOM: u64 = 500 * MIB;
pub const DEFAULT_MEMORY_FLOOR: u64 = 400 * MIB;
pub const SWAP_GROWTH_LIMIT: u64 = 2 * GIB;

pub fn can_start(free: u64, needed: u64) -> Result<(), String> {
    if free >= needed + RUN_HEADROOM {
        return Ok(());
    }
    Err(format!(
        "This model needs about {} of free RAM and {} is free. Close other programs or choose a smaller model.",
        gb(needed + RUN_HEADROOM),
        gb(free)
    ))
}

pub fn can_download(free_disk: u64, size: u64) -> Result<(), String> {
    if free_disk >= size + DISK_HEADROOM {
        return Ok(());
    }
    Err(format!(
        "Not enough disk space: the model needs {} and {} is free.",
        gb(size),
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
    fn a_download_needs_the_file_plus_headroom() {
        assert!(can_download(2 * GIB, GIB).is_ok());
        assert!(can_download(GIB, GIB).is_err());
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
