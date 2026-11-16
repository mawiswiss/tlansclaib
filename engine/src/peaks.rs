pub const MAX_BUCKETS: usize = 2000;
pub const SLOTS: usize = 8192;
pub const RANGE_DB: f64 = 40.0;
const FIRST_SPAN: f64 = 0.02;

/// Loudness over time in a fixed number of slots. The slots double their span when the recording outgrows them, so memory never depends on its length.
pub struct Peaks {
    slots: Vec<Energy>,
    span: f64,
    end: f64,
}

#[derive(Clone, Copy, Default)]
struct Energy {
    squares: f64,
    samples: u64,
}

impl Default for Peaks {
    fn default() -> Peaks {
        Peaks { slots: vec![Energy::default(); SLOTS], span: FIRST_SPAN, end: 0.0 }
    }
}

impl Peaks {
    pub fn add(&mut self, time: f64, length: f64, samples: &[f32]) {
        let time = time.max(0.0);
        while (time / self.span) as usize >= SLOTS {
            self.merge();
        }
        let slot = &mut self.slots[(time / self.span) as usize];
        slot.squares += samples.iter().map(|sample| f64::from(*sample).powi(2)).sum::<f64>();
        slot.samples += samples.len() as u64;
        self.end = self.end.max(time + length);
    }

    fn merge(&mut self) {
        for i in 0..SLOTS / 2 {
            let (a, b) = (self.slots[2 * i], self.slots[2 * i + 1]);
            self.slots[i] = Energy { squares: a.squares + b.squares, samples: a.samples + b.samples };
        }
        self.slots[SLOTS / 2..].fill(Energy::default());
        self.span *= 2.0;
    }

    /// RMS level per bucket in decibels, scaled so the loudest bucket is 1 and one `RANGE_DB` below it is 0. Silence stays 0.
    pub fn finish(&self, buckets: usize) -> Vec<f32> {
        let buckets = buckets.clamp(1, MAX_BUCKETS);
        let used = ((self.end / self.span).ceil() as usize).clamp(1, SLOTS);
        let decibels: Vec<f64> = (0..buckets)
            .map(|bucket| {
                let start = bucket * used / buckets;
                let end = ((bucket + 1) * used / buckets).max(start + 1);
                let (squares, samples) = self.slots[start..end].iter().fold((0.0, 0), |(squares, samples), slot| (squares + slot.squares, samples + slot.samples));
                if squares > 0.0 { 10.0 * (squares / samples as f64).log10() } else { f64::NEG_INFINITY }
            })
            .collect();
        let loudest = decibels.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        decibels.iter().map(|level| if loudest.is_finite() { ((level - loudest + RANGE_DB) / RANGE_DB).clamp(0.0, 1.0) as f32 } else { 0.0 }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn steady(peaks: &mut Peaks, from: f64, to: f64, amplitude: f32) {
        let mut time = from;
        while time < to {
            peaks.add(time, 0.01, &[amplitude; 80]);
            time += 0.01;
        }
    }

    #[test]
    fn finds_a_burst_and_scales_to_one() {
        let mut peaks = Peaks::default();
        steady(&mut peaks, 0.0, 1.5, 0.1);
        steady(&mut peaks, 1.5, 1.6, 0.8);
        steady(&mut peaks, 1.6, 3.0, 0.1);
        let result = peaks.finish(30);
        assert_eq!(result.len(), 30);
        assert_eq!(result[15], 1.0);
        let expected = 1.0 - 20.0 * 8f64.log10() / RANGE_DB;
        assert!((f64::from(result[0]) - expected).abs() < 1e-3, "{}", result[0]);
    }

    #[test]
    fn a_short_burst_does_not_flatten_the_rest() {
        let mut peaks = Peaks::default();
        steady(&mut peaks, 0.0, 30.0, 0.05);
        steady(&mut peaks, 30.0, 30.06, 1.0);
        steady(&mut peaks, 30.06, 60.0, 0.05);
        let result = peaks.finish(30);
        assert_eq!(result[15], 1.0);
        assert!(result.iter().enumerate().filter(|(bucket, _)| *bucket != 15).all(|(_, level)| *level > 0.5), "{result:?}");
    }

    #[test]
    fn a_half_silent_bucket_is_lower() {
        let mut peaks = Peaks::default();
        steady(&mut peaks, 0.0, 2.0, 0.2);
        steady(&mut peaks, 2.0, 3.0, 0.0);
        steady(&mut peaks, 3.0, 4.0, 0.2);
        let result = peaks.finish(2);
        assert_eq!(result[0], 1.0);
        let expected = 1.0 - 10.0 * 2f64.log10() / RANGE_DB;
        assert!((f64::from(result[1]) - expected).abs() < 1e-3, "{}", result[1]);
    }

    #[test]
    fn silence_stays_zero() {
        let mut peaks = Peaks::default();
        peaks.add(0.0, 5.0, &[0.0; 80]);
        assert!(peaks.finish(10).iter().all(|bucket| *bucket == 0.0));
    }

    #[test]
    fn three_hours_keep_the_same_memory_and_place() {
        let mut peaks = Peaks::default();
        let seconds = 3.0 * 3600.0;
        let mut time = 0.0;
        while time < seconds {
            peaks.add(time, 0.5, if (9000.0..9001.0).contains(&time) { &[1.0; 4] } else { &[0.2; 4] });
            time += 0.5;
        }
        assert_eq!(peaks.slots.len(), SLOTS);
        let result = peaks.finish(1000);
        let loudest = result.iter().position(|bucket| *bucket == 1.0).unwrap();
        assert!((loudest as i64 - 833).abs() <= 1, "bucket {loudest}");
    }

    #[test]
    fn clamps_the_bucket_count() {
        let mut peaks = Peaks::default();
        peaks.add(0.0, 1.0, &[0.5; 80]);
        assert_eq!(peaks.finish(0).len(), 1);
        assert_eq!(peaks.finish(1_000_000).len(), MAX_BUCKETS);
    }
}
