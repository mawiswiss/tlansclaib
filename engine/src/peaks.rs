pub const MAX_BUCKETS: usize = 2000;
pub const SLOTS: usize = 8192;
const FIRST_SPAN: f64 = 0.02;

/// Loudness over time in a fixed number of slots. The slots double their span when the recording outgrows them, so memory never depends on its length.
pub struct Peaks {
    slots: Vec<f32>,
    span: f64,
    end: f64,
}

impl Default for Peaks {
    fn default() -> Peaks {
        Peaks { slots: vec![0.0; SLOTS], span: FIRST_SPAN, end: 0.0 }
    }
}

impl Peaks {
    pub fn add(&mut self, time: f64, length: f64, amplitude: f32) {
        let time = time.max(0.0);
        while (time / self.span) as usize >= SLOTS {
            self.merge();
        }
        let slot = &mut self.slots[(time / self.span) as usize];
        *slot = slot.max(amplitude);
        self.end = self.end.max(time + length);
    }

    fn merge(&mut self) {
        for i in 0..SLOTS / 2 {
            self.slots[i] = self.slots[2 * i].max(self.slots[2 * i + 1]);
        }
        self.slots[SLOTS / 2..].fill(0.0);
        self.span *= 2.0;
    }

    /// The maximum per bucket, scaled so the loudest is 1. Silence stays 0.
    pub fn finish(&self, buckets: usize) -> Vec<f32> {
        let buckets = buckets.clamp(1, MAX_BUCKETS);
        let used = ((self.end / self.span).ceil() as usize).clamp(1, SLOTS);
        let mut result: Vec<f32> = (0..buckets)
            .map(|bucket| {
                let start = bucket * used / buckets;
                let end = ((bucket + 1) * used / buckets).max(start + 1);
                self.slots[start..end].iter().fold(0.0, |loudest, slot| slot.max(loudest))
            })
            .collect();
        let loudest = result.iter().fold(0.0, |loudest, bucket| bucket.max(loudest));
        if loudest > 0.0 {
            result.iter_mut().for_each(|bucket| *bucket /= loudest);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_burst_and_scales_to_one() {
        let mut peaks = Peaks::default();
        for i in 0..300 {
            let time = i as f64 * 0.01;
            peaks.add(time, 0.01, if (1.5..1.6).contains(&time) { 0.8 } else { 0.1 });
        }
        let result = peaks.finish(30);
        assert_eq!(result.len(), 30);
        assert_eq!(result[15], 1.0);
        assert!((result[0] - 0.125).abs() < 1e-6);
    }

    #[test]
    fn silence_stays_zero() {
        let mut peaks = Peaks::default();
        peaks.add(0.0, 5.0, 0.0);
        assert!(peaks.finish(10).iter().all(|bucket| *bucket == 0.0));
    }

    #[test]
    fn three_hours_keep_the_same_memory_and_place() {
        let mut peaks = Peaks::default();
        let seconds = 3.0 * 3600.0;
        let mut time = 0.0;
        while time < seconds {
            peaks.add(time, 0.5, if (9000.0..9001.0).contains(&time) { 1.0 } else { 0.2 });
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
        peaks.add(0.0, 1.0, 0.5);
        assert_eq!(peaks.finish(0).len(), 1);
        assert_eq!(peaks.finish(1_000_000).len(), MAX_BUCKETS);
    }
}
