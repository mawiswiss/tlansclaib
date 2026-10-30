# Models

The transcription model list loads whisper.cpp files in `ggml-*.bin` format.
It does not accept PyTorch weights (`model.safetensors`, `.pt`), CTranslate2
folders, ONNX or GGUF as transcription models. Speaker detection downloads its
own ONNX or GGUF files. Every model file is checked before use, see below.

## Where models live

- macOS: `~/Library/Application Support/tlansclaib/models`
- Windows: `%APPDATA%\tlansclaib\models`

"Show models folder" in the models panel opens it.

## The list

`src-tauri/resources/models.json` is compiled into the app. Each entry:

| field | meaning |
|---|---|
| `id` | stable key, also the saved selection |
| `name` | the name on the card, in menus, messages and the history: the language and a tier, Small, Compact or Best, such as "Thai Compact", or the language alone where it has one model. Compact makes a few more mistakes than Best for less memory and a smaller download. "Turbo" is a model as accurate as the one it stands in for, only faster. Never "Fast", which could mean the speed of the audio. "Universal" stands for all languages |
| `recommended` | the description on the card, what the model is for |
| `setups` | the setup modes the model belongs to: `minimal`, `essential`, `precise`. A single-language model joins when its language is chosen |
| `languages` | `["all"]` for the stock models, `["th"]` locks the language to Thai |
| `language_name` | optional display name when the code alone misleads, such as Swiss German on `de` |
| `file` | file name inside the models folder |
| `size_bytes`, `sha256` | checked after a download and when a file is added |
| `ram_gb` | memory the model needs while running, the guard adds 1 GB on top |
| `quality` | rank among the models of the same language, higher is better. Automatic takes a higher one that is installed and fits the free memory |
| `faster` | `true` for a model as accurate as the setup's model for all languages, only faster. Its setup takes it only on a computer that is not rated Very fast, and the app never suggests it as more accurate |
| `url` | download address, or `null` for a file the user adds |
| `architecture`, `quantization`, `source`, `license` | shown in the panel |

A `models.json` placed in the models folder overrides the built-in list entry
by entry (same `id` replaces, new ids are appended). An entry without `setups`
or `quality` keeps the bundled value. That way a new model
reaches someone without a new app version: send the file and a `models.json`
snippet.

"Add any model file…" links a model where it lies, kept in
`custom-models.json` in the models folder. Any other `ggml-*.bin` file in the
folder, such as a copy from an older version, also lists as a custom model,
named after the file.

## Setups

A setup downloads its model for all languages, its speaker detection, and the
model for the chosen language when it has one. Precise takes full precision
wherever the author publishes it, because q5_0 is audibly worse on difficult
audio (see below) and there is no official large-v3 q8_0. Essential avoids
q5_0: German takes the full-precision turbo, 2.2 GB RAM, which fits an 8 GB
computer.

The list holds only setup members, so there is one model per trade-off. Left
out: `tiny` and `base`, whose output is not usable, the q5_0 and f16 turbo and
the q5_0 large-v3 for all languages, the q5_0 German file, and
Typhoon for Thai, because a listed model matches or beats each of them.
Minimal takes `small-q8_0`: the turbo has the full large-v3 encoder and is
several times slower on a weak CPU, and on a low-end test computer `small` was
the only model with usable output. A copy left in the models folder from an
older version lists as a custom model.

| | Precise | Essential | Minimal |
|---|---|---|---|
| All languages | `large-v3`, 3.10 GB | `large-v3-turbo-q8_0`, 874 MB | `small-q8_0`, 264 MB |
| Speakers | better, 202 MB | better, 202 MB | basic, 38 MB |
| Thai | `thai-best`, 1.66 GB | `thai-compact`, 874 MB | none |
| German | `german-full`, 1.62 GB | `german-full`, 1.62 GB | none |
| Swiss German | `swiss-german`, 874 MB | `swiss-german`, 874 MB | none |
| Persian | `persian`, 1.62 GB | `persian`, 1.62 GB | none |
| English | `english-turbo`, 1.52 GB, on a computer not rated Very fast | none | none |

English Turbo is there for speed, not accuracy. distil-large-v3.5 averages
7.10% word errors on short clips against 7.14% for large-v3, and 14.6% against
16.0% on the AMI meetings, on its authors' tests, with 2 decoder layers
instead of 32. The engine feeds it short lines. Precise takes it only when the
computer's speed score is below 80 when the setup is applied (`fit.ts`). Before
any transcription that means a computer without a usable graphics chip or with
less than 10 GB RAM on a Mac, 12 GB on Windows. After one, it means recent
transcriptions ran at less than eight times the speed of the recording. In
Essential it would add a second large model next to a turbo q8_0 that shares
its encoder and is about as fast, so English stays on the model for all
languages there. German is different: there Essential only
trades the q5_0 file for the f16 file of the same model.

French has no model of its own. `bofenghuang/whisper-large-v3-french` was
listed until 0.3.3, but it was never compared against the models for all
languages here, and in Essential it replaced the turbo with a slower full
large-v3 decoder.

To replace a model, add an entry with a new `id` and `file`, move the
`setups` of the old entry to it, and keep the old entry without `setups`. The
app never downloads a new setup member on its own: after the update a notice
asks first, and once the new model is in, it offers to delete the old one,
which it still knows by its entry. A changed file under the same `id` would
go unnoticed, because an installed model counts by its file name.

## Checks

Every file, downloaded or added:

1. The header must be a whisper.cpp model: ggml magic plus plausible
   hyperparameters. The check names what a wrong file is (safetensors, GGUF,
   zip, audio).
2. A file for a list entry must match the entry's `size_bytes` and `sha256`.
   A download that fails is deleted. A wrong file offered to an entry is
   refused with the expected name, size and checksum.
3. A model for a non-English entry must be multilingual.

The engine checks the same header again when a run starts.

## Models converted here

These exist on Hugging Face only as PyTorch weights. They were converted with
`scripts/convert-model.py` and are downloaded from the GitHub release
`models-v1` of this repository. Release files have no bandwidth limit and
may be up to 2 GiB each, unlike Git LFS on a free account, which stops after
10 GiB a month. `docs/release.md` describes the upload, and
`docs/model-release.md` holds the release notes with the attribution the
licences ask for.

| entry | file | size | SHA-256 |
|---|---|---|---|
| Thai Compact | `ggml-thai-fast-q8_0.bin` | 874 MB | `e0894592a0a90014a22dd7675c9a001e7f9b8fa58c7fcef547e1ea9f45207042` |
| Thai Best | `ggml-thai-best-q8_0.bin` | 1.66 GB | `a6a149bd28cfd240d3e7cb54253081f76ea360c169abf85cae3f13d179c35464` |
| Swiss German | `ggml-swiss-german-q8_0.bin` | 874 MB | `89ec3580295d070428ba28e9bbeb973281186e740dae3eda5cd28b7942013bbf` |

Thai Compact is `biodatlab/distill-whisper-th-large-v3` (MIT), a fine-tune of
large-v3-turbo. Thai Best is `biodatlab/whisper-th-large-v3-combined`
(Apache-2.0), a fine-tune of large-v3, several times slower on a CPU. Swiss
German is `gcoli/whisper-large-v3-turbo-swiss-german-mit` (MIT, trained only on
MIT data), a large-v3-turbo fine-tune that writes Swiss German speech as
Standard German. Its card reports 25.9% word errors on a held-out Swiss German
test set, against 28.5% for stock turbo and 26.3% for stock large-v3. The
Swiss German models built on SwissDial data are CC BY-NC, for non-commercial
use only, and left out on purpose.

## Single-language models to download

Ready-made whisper.cpp files from their authors or a converter, pinned by
size and SHA-256 from Hugging Face's own records. Each file was downloaded
once on 2026-10-13, its checksum and header verified, and run on a short clip
in its language.

| entry | file source | model | licence | published result |
|---|---|---|---|---|
| German | `cstr/whisper-large-v3-turbo-german-ggml` | `primeline/whisper-large-v3-turbo-german` | Apache-2.0 | 2.6% word errors against 3.3% for stock large-v3 |
| English | `distil-whisper/distil-large-v3.5-ggml` | `distil-whisper/distil-large-v3.5` | MIT | on par with large-v3 on short clips, better on meetings, slightly worse than turbo on long recordings |
| Persian | `givia/whisper-large-v3-turbo-persian` | the same | CC-BY-4.0 | 11.2% word errors against 19.6% for stock turbo on an unseen 70-minute podcast, 6.4% against 17.3% for stock large-v3 on FLEURS |

Persian was downloaded on 2026-10-30, its checksum verified, and run here on
30 clips of the FLEURS `fa_ir` test split, which the model did not train on.
On the 16 clips that both models transcribed it made 5.5% word errors against
18.9% for `large-v3`, in about half the time. The other 14 came out empty with
either model, because the engine found no stretch of speech in them. `ram_gb` is the German value,
because the file has the same architecture and size.

German and Persian take the author's f16 file. Universal Compact and
Universal Small are
`ggerganov/whisper.cpp`'s `ggml-large-v3-turbo-q8_0.bin` and
`ggml-small-q8_0.bin`. They are pinned by size and SHA-256 from Hugging Face's
records. `ggml-small-q8_0.bin` peaked at 0.57 GB on the English fixture on the
CPU, on 2026-10-25.

Typhoon (`typhoon-ai/typhoon-whisper-turbo`, MIT) reports about half the
character errors of biodatlab's distilled model on two Thai sets, in its
authors' paper. On the three-minute far-field Thai meeting clip it did not beat
Thai Compact: its text changed 41% between shifted runs against 38%, so it is
not listed.

A fine-tuned model keeps Whisper's language detection. On 2026-10-24 the Swiss
German model heard the English test clip as English with 0.99, so the note
about another spoken language works with it. The Thai models were not checked.

## Converting a Hugging Face Whisper model

Needs uv, git and cmake on the machine doing the conversion (once, not on the
end user's computer).

```bash
scripts/convert-model.py biodatlab/distill-whisper-th-large-v3 thai-fast
```

Downloads the model into the Hugging Face cache, clones whisper.cpp into
`~/.cache/tlansclaib-convert`, builds its quantize tool, writes
`models/ggml-thai-fast-q8_0.bin` and `models/ggml-thai-fast-q5_0.bin`, and
prints each file's size and SHA-256 as a `models.json` snippet. `--keep-f16`
also keeps the unquantized file, `--quant q8_0` limits the output.

q8_0 is close to the original quality at about half the size. q5_0 is a third
of the size and audibly worse on difficult audio. Pick by running the
engine on a known recording:

```bash
target/release/tlansclaib-engine transcribe --model models/ggml-thai-fast-q8_0.bin \
  --audio recording.m4a --output /tmp/check.txt --language th
```

`ram_gb` for a new entry: run the engine on a few minutes of audio under
`/usr/bin/time -l` on macOS and read "maximum resident set size", then round up.
The decoded recording comes on top, about 0.2 GB per hour of audio. The 1 GB
the guard adds covers that for recordings up to about three hours. A longer
one on a computer at the limit can be stopped during the run instead of
refused at the start.

## Decoding notes

Measured on three minutes of a far-field Thai meeting recording, the same clip
shifted by 10 ms, 44 ms and 125 ms, so that only the window cuts move:

| model | decoding | text that changes between shifts |
|---|---|---|
| Thai Compact, q8_0 | greedy | 39% |
| Thai Compact, q8_0 | beam search, 5 beams | 40% |
| Thai Best, q8_0 | greedy | 50% |
| Thai Best, q8_0 | beam search, 5 beams | 52% |
| Universal Compact, q5_0 | greedy | 60%, and half the text missing |

The transformers pipeline the project started from behaves the same: a 44 ms
shift changed 55% of its output on this clip. So on hard audio the Thai
models are unstable by nature, two runs on the same recording can differ a
lot, and neither beam search nor a bigger model buys stability. The engine
decodes greedily, with the temperature fallback as the only retry, and the
distilled model is the recommended Thai entry because it is the most stable
of the set and three times faster than the large one. `--beam-size` stays
available on the engine's command line for experiments.

On the full 1 h 47 min meeting, on an Apple M5 Max:

| model | time | peak memory | swap | lines repeating a word or phrase 5 to 10 times |
|---|---|---|---|---|
| Thai Compact, q8_0 | 5 min | 1.5 GB | none | 8 |
| Thai Best, q8_0 | 15 min | 2.5 GB | none | 0 |

Both wrote 494 lines. In two of the eight, the large model writes the same
repetition with ๆ, so the speaker probably repeated the word. The rest look
like the loop the temperature fallback is meant to catch, the worst a phrase
repeated ten times. whisper.cpp detects loops by token entropy
(`--entropy-thold`). A higher value catches more loops at the price of more
retries, which are slower and noisier. Tune it with a Thai reader, not by
eye.

Lines now end at pauses (see `docs/design.md`), which makes them shorter and
gives the model less context per piece. Measured with Thai Compact on the same
meeting:

| cutting | loop threshold | lines | average line | time | lines repeating a word or phrase 5 to 10+ times |
|---|---|---|---|---|---|
| fixed, 11 to 15 s | 2.4 | 494 | 13.0 s | 296 s | 8 |
| at pauses, 5 to 15 s | 2.4 | 687 | 8.7 s | 333 s, shared machine | 13 |
| at pauses, 8 to 15 s | 2.4 | 580 | 10.5 s | 375 s, shared machine | 11 |
| at pauses, 5 to 15 s | 2.8 | 687 | 8.7 s | 381 s | 6 |
| at pauses, 5 to 18 s | 2.8 | 625 | 10.3 s | 409 s | 8 |
| at pauses or breaths, 5 to 15 s (default) | 2.8 | 676 | 8.9 s | 435 s | 7 |

Why each line of that meeting ends, from `tlansclaib-engine split`:

| line length | lines | at a pause | at a breath | forced |
|---|---|---|---|---|
| 5 to 15 s | 676 | 459 | 169 | 47 |
| 8 to 15 s | 574 | 332 | 182 | 59 |
| 5 to 18 s | 625 | 467 | 130 | 27 |

The default ends lines at pauses with 5 s to 15 s lines, at the longest breath
when nobody pauses, and uses a loop threshold of 2.8. Before the breath step,
216 of the lines ended at an arbitrary quiet moment, now 47. A longer minimum
leaves less room to find a pause and forces more lines. A longer maximum for
Thai forces fewer, but brought three pieces within a few tokens of whisper.cpp's
limit of 220, where text gets cut off, and looped more, so Thai stays at 15 s.
The cost is 30% to 50% more time on this Mac, depending on how many pieces
need a retry, and more on a computer without a fast GPU, because whisper
processes each line as a full 30-second block. The engine logs a warning when
a piece uses 200 tokens or more. `--window MIN-MAX` and `--entropy-thold` on
the engine change both for experiments.
