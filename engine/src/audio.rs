use std::fs::File;
use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Indexing, Resampler};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::RATE;

const CHUNK: usize = 4096;

pub struct Source {
    /// Every audio track on its own, in file order, aligned to the track that starts first.
    pub tracks: Vec<Vec<f32>>,
    pub video: bool,
}

pub fn load(path: &Path) -> Result<Vec<f32>> {
    Ok(mix(load_tracks(path)?.tracks))
}

pub fn load_tracks(path: &Path) -> Result<Source> {
    let file = File::open(path).with_context(|| format!("cannot open {}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| anyhow!("this is not an audio file symphonia can read: {e}"))?;

    let video = format.tracks().iter().any(|t| t.track_type() == Some(TrackType::Video));
    let mut tracks = Vec::new();
    let mut first_error = None;
    for track in format.tracks().iter().filter(|t| t.track_type() == Some(TrackType::Audio)) {
        match TrackDecoder::new(track) {
            Ok(decoder) => tracks.push(decoder),
            Err(error) => {
                log::warn!("skipping audio track {}: {error:#}", track.id);
                first_error.get_or_insert(error);
            }
        }
    }
    if tracks.is_empty() {
        return Err(first_error.unwrap_or_else(|| anyhow!("this file has no audio track")));
    }

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) | Err(Error::ResetRequired) => break,
            Err(e) => bail!("cannot read the audio: {e}"),
        };
        if let Some(track) = tracks.iter_mut().find(|t| t.id == packet.track_id) {
            track.decode(&packet)?;
        }
    }

    let codec = tracks[0].codec.to_string();
    let failed: usize = tracks.iter().map(|t| t.failed_packets).sum();
    let mut decoded = Vec::new();
    for track in tracks {
        let (id, offset) = (track.id, track.offset);
        let samples = track.resampler.finish()?;
        if samples.is_empty() {
            log::warn!("audio track {id} holds no audio");
        } else {
            decoded.push((offset, samples));
        }
    }
    if decoded.is_empty() {
        bail!("no audio could be decoded from this file (codec {codec}, {failed} unreadable packets). Convert it to MP3 or WAV first.");
    }
    let earliest = decoded.iter().map(|(offset, _)| *offset).fold(f64::INFINITY, f64::min);
    let tracks = decoded
        .into_iter()
        .map(|(offset, samples)| {
            let lead = ((offset - earliest) * RATE as f64).round() as usize;
            if lead == 0 {
                return samples;
            }
            let mut aligned = vec![0.0; lead];
            aligned.extend(samples);
            aligned
        })
        .collect();
    Ok(Source { tracks, video })
}

pub fn mix(mut tracks: Vec<Vec<f32>>) -> Vec<f32> {
    if tracks.len() == 1 {
        return tracks.pop().unwrap();
    }
    let length = tracks.iter().map(Vec::len).max().unwrap_or(0);
    let mut mixed = vec![0.0f32; length];
    for track in &tracks {
        for (out, sample) in mixed.iter_mut().zip(track) {
            *out += sample;
        }
    }
    for sample in &mut mixed {
        *sample = sample.clamp(-1.0, 1.0);
    }
    mixed
}

struct TrackDecoder {
    id: u32,
    codec: String,
    channels: usize,
    time_base: Option<symphonia::core::units::TimeBase>,
    offset: f64,
    started: bool,
    decoder: Box<dyn symphonia::core::codecs::audio::AudioDecoder>,
    resampler: Resampling,
    interleaved: Vec<f32>,
    failed_packets: usize,
}

impl TrackDecoder {
    fn new(track: &symphonia::core::formats::Track) -> Result<TrackDecoder> {
        let params = track
            .codec_params
            .as_ref()
            .and_then(|p| p.audio())
            .cloned()
            .ok_or_else(|| anyhow!("this file has no audio track"))?;
        let codec = params.codec;
        let rate = params
            .sample_rate
            .ok_or_else(|| anyhow!("the audio track has no sample rate"))? as usize;
        let channels = params.channels.as_ref().map(|c| c.count()).unwrap_or(1).max(1);
        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(&params, &AudioDecoderOptions::default())
            .map_err(|e| anyhow!("the audio codec {codec} is not supported ({e}). Convert the file to MP3 or WAV first."))?;
        Ok(TrackDecoder {
            id: track.id,
            codec: codec.to_string(),
            channels,
            time_base: track.time_base,
            offset: 0.0,
            started: false,
            decoder,
            resampler: Resampling::new(rate)?,
            interleaved: Vec::new(),
            failed_packets: 0,
        })
    }

    fn decode(&mut self, packet: &symphonia::core::packet::Packet) -> Result<()> {
        if !self.started {
            self.started = true;
            self.offset = self
                .time_base
                .and_then(|base| base.calc_time(packet.pts))
                .map(|time| time.as_secs_f64().max(0.0))
                .unwrap_or(0.0);
        }
        match self.decoder.decode(packet) {
            Ok(buffer) => {
                self.interleaved.resize(buffer.samples_interleaved(), 0.0);
                buffer.copy_to_slice_interleaved(&mut self.interleaved);
                self.resampler.push(&downmix(&self.interleaved, self.channels))?;
            }
            Err(Error::DecodeError(_)) | Err(Error::IoError(_)) => self.failed_packets += 1,
            Err(e) => bail!("cannot decode the audio: {e}"),
        }
        Ok(())
    }
}

fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels == 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

struct Resampling {
    fft: Option<Fft<f32>>,
    pending: Vec<f32>,
    out: Vec<f32>,
    result: Vec<f32>,
    input_frames: usize,
}

impl Resampling {
    fn new(rate: usize) -> Result<Resampling> {
        let fft = if rate == RATE {
            None
        } else {
            Some(Fft::<f32>::new(rate, RATE, CHUNK, 1, FixedSync::Input)?)
        };
        let out_len = fft.as_ref().map(|f| f.output_frames_max()).unwrap_or(0);
        Ok(Resampling {
            fft,
            pending: Vec::new(),
            out: vec![0.0; out_len],
            result: Vec::new(),
            input_frames: 0,
        })
    }

    fn push(&mut self, mono: &[f32]) -> Result<()> {
        self.input_frames += mono.len();
        if self.fft.is_none() {
            self.result.extend_from_slice(mono);
            return Ok(());
        }
        self.pending.extend_from_slice(mono);
        while self.pending.len() >= CHUNK {
            let produced = self.process(CHUNK, None)?;
            self.pending.drain(..CHUNK);
            self.take(produced);
        }
        Ok(())
    }

    fn process(&mut self, frames: usize, partial: Option<usize>) -> Result<usize> {
        let fft = self.fft.as_mut().unwrap();
        let input = InterleavedSlice::new(&self.pending[..frames], 1, frames)?;
        let out_len = self.out.len();
        let mut output = InterleavedSlice::new_mut(&mut self.out[..], 1, out_len)?;
        let indexing = Indexing {
            input_offset: 0,
            output_offset: 0,
            active_channels_mask: None,
            partial_len: partial,
        };
        let (_, produced) = fft.process_into_buffer(&input, &mut output, Some(&indexing))?;
        Ok(produced)
    }

    fn take(&mut self, produced: usize) {
        self.result.extend_from_slice(&self.out[..produced]);
    }

    fn finish(mut self) -> Result<Vec<f32>> {
        let Some(fft) = self.fft.as_ref() else {
            return Ok(self.result);
        };
        let expected = (fft.resample_ratio() * self.input_frames as f64).ceil() as usize;
        let delay = fft.output_delay();
        let remaining = self.pending.len();
        self.pending.resize(CHUNK, 0.0);
        let produced = self.process(CHUNK, Some(remaining))?;
        self.take(produced);
        while self.result.len() < expected + delay {
            let produced = self.process(CHUNK, Some(0))?;
            self.take(produced);
        }
        let mut result = self.result;
        result.drain(..delay);
        result.truncate(expected);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len().max(1) as f32).sqrt()
    }

    #[test]
    fn reads_every_audio_track_and_keeps_them_apart() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/two-tracks.m4a");
        let source = load_tracks(&fixture).unwrap();
        assert!(!source.video);
        let tracks = source.tracks;
        assert_eq!(tracks.len(), 2);
        let (first, second) = (&tracks[0], &tracks[1]);
        let early = 2_000..14_000;
        let late = RATE + 2_000..RATE + 14_000;
        assert!(rms(&first[early.clone()]) > 0.2 && rms(&first[late.clone()]) < 0.02);
        assert!(rms(&second[early.clone()]) < 0.02 && rms(&second[late.clone()]) > 0.2);
        let mixed = load(&fixture).unwrap();
        assert!(rms(&mixed[early]) > 0.2 && rms(&mixed[late]) > 0.2);
    }

    #[test]
    fn mixing_sums_the_tracks_and_keeps_the_longest() {
        assert_eq!(mix(vec![vec![0.25, 0.5]]), vec![0.25, 0.5]);
        assert_eq!(mix(vec![vec![0.25, 0.75, 0.1], vec![0.5, 0.5]]), vec![0.75, 1.0, 0.1]);
    }

    #[test]
    fn downmix_averages_the_channels() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(downmix(&[0.25, 0.75], 1), vec![0.25, 0.75]);
    }

    #[test]
    fn resampling_keeps_the_duration_and_the_signal() {
        let rate = 48_000;
        let seconds = 3;
        let input: Vec<f32> = (0..rate * seconds)
            .map(|i| (i as f32 * 2.0 * std::f32::consts::PI * 440.0 / rate as f32).sin())
            .collect();
        let mut resampling = Resampling::new(rate).unwrap();
        for chunk in input.chunks(1000) {
            resampling.push(chunk).unwrap();
        }
        let output = resampling.finish().unwrap();
        assert_eq!(output.len(), RATE * seconds);
        let rms = (output[RATE..2 * RATE].iter().map(|s| s * s).sum::<f32>() / RATE as f32).sqrt();
        assert!((rms - 0.707).abs() < 0.02, "rms {rms}");
    }

    #[test]
    fn no_resampling_at_sixteen_kilohertz() {
        let mut resampling = Resampling::new(RATE).unwrap();
        resampling.push(&[0.1, 0.2, 0.3]).unwrap();
        assert_eq!(resampling.finish().unwrap(), vec![0.1, 0.2, 0.3]);
    }
}
