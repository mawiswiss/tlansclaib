use std::time::{Duration, Instant};

pub const LIMIT: Duration = Duration::from_secs(45);
const BUSY_CPU_MS: u64 = 250;
const BUSY_READ_BYTES: u64 = 4 * 1024 * 1024;
const MISSED_TICKS: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug)]
pub struct Usage {
    pub pid: u32,
    pub cpu_ms: u64,
    pub read_bytes: u64,
}

/// Notices an engine that sends no event and does no work, such as one waiting on a graphics chip that never answers.
pub struct Watch {
    pid: u32,
    quiet_since: Instant,
    baseline: Option<Usage>,
    last_tick: Option<Instant>,
}

impl Watch {
    pub fn new(pid: u32, now: Instant) -> Watch {
        Watch { pid, quiet_since: now, baseline: None, last_tick: None }
    }

    pub fn heard(&mut self, now: Instant) {
        self.quiet_since = now;
        self.baseline = None;
    }

    pub fn stalled(&mut self, now: Instant, usage: Option<Usage>) -> bool {
        // A gap in the ticks means the computer slept or the app was held up, not that the engine stalled.
        if self.last_tick.replace(now).is_some_and(|last| now.duration_since(last) > MISSED_TICKS) {
            self.heard(now);
        }
        if let Some(usage) = usage.filter(|u| u.pid == self.pid) {
            match self.baseline {
                None => self.baseline = Some(usage),
                Some(base)
                    if usage.cpu_ms.saturating_sub(base.cpu_ms) >= BUSY_CPU_MS
                        || usage.read_bytes.saturating_sub(base.read_bytes) >= BUSY_READ_BYTES =>
                {
                    self.quiet_since = now;
                    self.baseline = Some(usage);
                }
                Some(_) => {}
            }
        }
        now.duration_since(self.quiet_since) >= LIMIT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage(cpu_ms: u64, read_bytes: u64) -> Option<Usage> {
        Some(Usage { pid: 7, cpu_ms, read_bytes })
    }

    /// Ticks once a second from `from` to `to`, and returns the second it stalled at.
    fn run(watch: &mut Watch, start: Instant, from: u64, to: u64, sample: impl Fn(u64) -> Option<Usage>) -> Option<u64> {
        (from..=to).find(|&second| watch.stalled(start + Duration::from_secs(second), sample(second)))
    }

    #[test]
    fn an_idle_silent_engine_stalls_after_the_limit() {
        let start = Instant::now();
        let mut watch = Watch::new(7, start);
        assert_eq!(run(&mut watch, start, 1, 100, |_| usage(1_000, 1_000)), Some(45));
    }

    #[test]
    fn an_event_restarts_the_wait() {
        let start = Instant::now();
        let mut watch = Watch::new(7, start);
        assert_eq!(run(&mut watch, start, 1, 30, |_| usage(0, 0)), None);
        watch.heard(start + Duration::from_secs(30));
        assert_eq!(run(&mut watch, start, 31, 100, |_| usage(0, 0)), Some(75));
    }

    #[test]
    fn a_busy_engine_is_not_stalled() {
        let start = Instant::now();
        let mut watch = Watch::new(7, start);
        assert_eq!(run(&mut watch, start, 1, 300, |s| usage(s * 1_000, 0)), None, "computing");
        let mut watch = Watch::new(7, start);
        assert_eq!(run(&mut watch, start, 1, 300, |s| usage(0, s * 20_000_000)), None, "reading");
    }

    #[test]
    fn slow_work_adds_up_over_the_quiet_time() {
        let start = Instant::now();
        let mut watch = Watch::new(7, start);
        assert_eq!(run(&mut watch, start, 1, 300, |s| usage(s * 10, 0)), None);
    }

    #[test]
    fn usage_of_an_earlier_process_does_not_count() {
        let start = Instant::now();
        let mut watch = Watch::new(8, start);
        assert_eq!(run(&mut watch, start, 1, 100, |s| usage(s * 1_000, 0)), Some(45));
    }

    #[test]
    fn a_gap_in_the_ticks_restarts_the_wait() {
        let start = Instant::now();
        let mut watch = Watch::new(7, start);
        assert_eq!(run(&mut watch, start, 1, 10, |_| usage(0, 0)), None);
        assert_eq!(run(&mut watch, start, 600, 700, |_| usage(0, 0)), Some(645));
    }

    #[test]
    fn without_usage_only_events_count() {
        let start = Instant::now();
        let mut watch = Watch::new(7, start);
        assert_eq!(run(&mut watch, start, 1, 100, |_| None), Some(45));
    }
}
