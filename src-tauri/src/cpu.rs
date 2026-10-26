#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Features {
    pub avx2: bool,
    pub fma: bool,
    pub f16c: bool,
    pub bmi2: bool,
    pub avx: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Avx2,
    Avx,
    Sse,
}

/// The instruction set the Windows engines were built for: the main and Vulkan engines need all of Avx2.
pub fn level(features: Features) -> Level {
    if features.avx2 && features.fma && features.f16c && features.bmi2 {
        Level::Avx2
    } else if features.avx {
        Level::Avx
    } else {
        Level::Sse
    }
}

#[cfg(target_arch = "x86_64")]
pub fn detect() -> Features {
    Features {
        avx2: std::arch::is_x86_feature_detected!("avx2"),
        fma: std::arch::is_x86_feature_detected!("fma"),
        f16c: std::arch::is_x86_feature_detected!("f16c"),
        bmi2: std::arch::is_x86_feature_detected!("bmi2"),
        avx: std::arch::is_x86_feature_detected!("avx"),
    }
}

#[cfg(not(target_arch = "x86_64"))]
pub fn detect() -> Features {
    Features { avx2: true, fma: true, f16c: true, bmi2: true, avx: true }
}

/// Whether the Vulkan engine can run here at all: its CPU code needs AVX2 too.
pub fn runs_vulkan_engine() -> bool {
    level(detect()) == Level::Avx2 && vulkan_loader()
}

/// Windows refuses to start the Vulkan engine without the loader a graphics driver installs, and shows a dialog about it.
#[cfg(windows)]
fn vulkan_loader() -> bool {
    std::env::var_os("SystemRoot").is_some_and(|root| std::path::Path::new(&root).join("System32").join("vulkan-1.dll").is_file())
}

#[cfg(not(windows))]
fn vulkan_loader() -> bool {
    true
}

/// The engine sidecar for work on the CPU.
pub fn engine() -> &'static str {
    if !cfg!(windows) {
        return "tlansclaib-engine";
    }
    match level(detect()) {
        Level::Avx2 => "tlansclaib-engine",
        Level::Avx => "tlansclaib-engine-avx",
        Level::Sse => "tlansclaib-engine-sse",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haswell_and_newer_run_the_main_engine() {
        let all = Features { avx2: true, fma: true, f16c: true, bmi2: true, avx: true };
        assert_eq!(level(all), Level::Avx2);
    }

    #[test]
    fn a_missing_avx2_companion_falls_back_to_avx() {
        let ivy_bridge = Features { avx: true, f16c: true, ..Features::default() };
        assert_eq!(level(ivy_bridge), Level::Avx);
        let no_bmi2 = Features { avx2: true, fma: true, f16c: true, bmi2: false, avx: true };
        assert_eq!(level(no_bmi2), Level::Avx);
    }

    #[test]
    fn celerons_without_avx_run_the_sse_engine() {
        assert_eq!(level(Features::default()), Level::Sse);
    }
}
