use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Word {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Scripts written without spaces between words, where each token becomes a word of its own.
fn unspaced(c: char) -> bool {
    matches!(c,
        '\u{0E00}'..='\u{0EFF}' // Thai, Lao
        | '\u{1000}'..='\u{109F}' // Myanmar
        | '\u{1780}'..='\u{17FF}' // Khmer
        | '\u{3040}'..='\u{30FF}' // Hiragana, Katakana
        | '\u{3400}'..='\u{4DBF}'
        | '\u{4E00}'..='\u{9FFF}' // CJK ideographs
    )
}

/// The buffer whisper.cpp allocates for each alignment pass.
pub const ALIGNMENT_BYTES: usize = 128 << 20;

/// Whether a piece continues the character before it: a vowel or tone mark, or the consonant
/// after a Thai or Lao vowel that is written first.
fn continues(before: &str, piece: &str) -> bool {
    let written_first = |c: char| matches!(c, '\u{0E40}'..='\u{0E44}' | '\u{0EC0}'..='\u{0EC4}');
    before.ends_with(written_first) || format!("{before}{piece}").graphemes(true).count() < before.graphemes(true).count() + piece.graphemes(true).count()
}

fn round(seconds: f64) -> f64 {
    (seconds * 100.0).round() / 100.0
}

/// Groups decoded tokens into timed words. Each token comes as its bytes, which may end inside a
/// character, and the second it starts at within the line, if alignment found one.
pub fn group<B: AsRef<[u8]>>(tokens: &[(B, Option<f64>)], start: f64, end: f64) -> Vec<Word> {
    if tokens.iter().all(|(_, time)| time.is_none()) {
        return Vec::new();
    }
    let mut words: Vec<(String, Option<f64>)> = Vec::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut pending_time = None;
    let mut gap = true;
    for (bytes, time) in tokens {
        if pending.is_empty() {
            pending_time = *time;
        }
        pending.extend_from_slice(bytes.as_ref());
        let text = match std::str::from_utf8(&pending) {
            Ok(text) => text.to_string(),
            Err(error) if error.error_len().is_none() && pending.len() < 8 => continue,
            Err(_) => String::from_utf8_lossy(&pending).into_owned(),
        };
        pending.clear();
        let word = text.trim();
        if word.is_empty() {
            gap = true;
            continue;
        }
        let joins = !gap
            && !text.starts_with(char::is_whitespace)
            && words.last().is_some_and(|(last, _)| continues(last, word) || (!last.ends_with(unspaced) && !word.starts_with(unspaced)));
        match words.last_mut() {
            Some((last, _)) if joins => last.push_str(word),
            _ => words.push((word.to_string(), pending_time)),
        }
        gap = text.ends_with(char::is_whitespace);
    }
    let mut at = start;
    let starts: Vec<f64> = words
        .iter()
        .map(|(_, time)| {
            at = time.map_or(at, |t| (start + t).clamp(at, end));
            at
        })
        .collect();
    words
        .into_iter()
        .enumerate()
        .map(|(i, (text, _))| Word { start: round(starts[i]), end: round(starts.get(i + 1).copied().unwrap_or(end)), text })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(words: &[Word]) -> Vec<&str> {
        words.iter().map(|w| w.text.as_str()).collect()
    }

    #[test]
    fn joins_pieces_of_a_word_and_its_punctuation() {
        let tokens: Vec<(&[u8], Option<f64>)> = vec![
            (b" Hel", Some(0.2)),
            (b"lo", Some(0.4)),
            (b",", Some(0.5)),
            (b" world", Some(1.0)),
            (b".", Some(1.6)),
        ];
        let words = group(&tokens, 10.0, 12.0);
        assert_eq!(texts(&words), ["Hello,", "world."]);
        assert_eq!((words[0].start, words[0].end), (10.2, 11.0));
        assert_eq!((words[1].start, words[1].end), (11.0, 12.0));
    }

    #[test]
    fn keeps_a_character_split_across_tokens_whole() {
        let ko = "한".as_bytes();
        let tokens: Vec<(&[u8], Option<f64>)> = vec![(b" a", Some(0.0)), (&ko[..1], Some(0.3)), (&ko[1..], Some(0.4))];
        assert_eq!(texts(&group(&tokens, 0.0, 1.0)), ["a한"]);
        let tokens: Vec<(&[u8], Option<f64>)> = vec![(b" a", Some(0.0)), (b" ", None), (&ko[..1], Some(0.3)), (&ko[1..], Some(0.4))];
        let words = group(&tokens, 0.0, 1.0);
        assert_eq!(texts(&words), ["a", "한"]);
        assert_eq!(words[1].start, 0.3);
    }

    #[test]
    fn gives_each_token_of_an_unspaced_script_its_own_word() {
        let tokens: Vec<(&[u8], Option<f64>)> = vec![("สวัสดี".as_bytes(), Some(0.1)), ("ครับ".as_bytes(), Some(0.9))];
        assert_eq!(texts(&group(&tokens, 0.0, 2.0)), ["สวัสดี", "ครับ"]);
        let pieces = ["ค", "ร", "ั", "บ", "เ", "ร", "า"];
        let tokens: Vec<(&[u8], Option<f64>)> = pieces.iter().enumerate().map(|(i, p)| (p.as_bytes(), Some(i as f64 / 10.0))).collect();
        let words = group(&tokens, 0.0, 1.0);
        assert_eq!(texts(&words), ["ค", "รั", "บ", "เร", "า"]);
        assert_eq!(words[1].start, 0.1);
    }

    #[test]
    fn keeps_times_in_order_inside_the_line_and_fills_missing_ones() {
        let tokens: Vec<(&[u8], Option<f64>)> = vec![(b" one", Some(-0.5)), (b" two", None), (b" three", Some(0.2)), (b" four", Some(9.0))];
        let words = group(&tokens, 5.0, 8.0);
        assert_eq!(words.iter().map(|w| w.start).collect::<Vec<_>>(), [5.0, 5.0, 5.2, 8.0]);
        assert_eq!(words.last().unwrap().end, 8.0);
        assert!(group::<&[u8]>(&[], 0.0, 1.0).is_empty());
        assert!(group(&[(b" one".as_slice(), None)], 0.0, 1.0).is_empty());
    }
}
