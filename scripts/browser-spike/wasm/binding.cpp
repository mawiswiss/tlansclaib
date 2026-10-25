#include <emscripten.h>

#include <string>

#include "whisper.h"

static whisper_context * context = nullptr;
static std::string text;
static whisper_timings timings;
static int tokens = 0;

extern "C" {

EMSCRIPTEN_KEEPALIVE int spike_load(const char * path) {
    whisper_context_params params = whisper_context_default_params();
    params.use_gpu = false;
    params.flash_attn = false;
    context = whisper_init_from_file_with_params(path, params);
    return context != nullptr;
}

// Mirrors Engine::decode in engine/src/transcribe.rs.
EMSCRIPTEN_KEEPALIVE const char * spike_decode(const float * samples, int count, const char * language, int audio_ctx, int threads) {
    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.greedy.best_of = 1;
    params.n_threads = threads;
    params.audio_ctx = audio_ctx;
    params.language = language;
    params.translate = false;
    params.no_context = true;
    params.no_timestamps = true;
    params.single_segment = false;
    params.suppress_blank = true;
    params.suppress_nst = true;
    params.temperature = 0.0f;
    params.temperature_inc = 0.2f;
    params.entropy_thold = 2.8f;
    params.logprob_thold = -1.0f;
    params.print_special = false;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;

    whisper_reset_timings(context);
    text.clear();
    tokens = 0;
    if (whisper_full(context, params, samples, count) != 0) {
        return nullptr;
    }
    timings = *whisper_get_timings(context);
    for (int i = 0; i < whisper_full_n_segments(context); i++) {
        tokens += whisper_full_n_tokens(context, i);
        std::string piece = whisper_full_get_segment_text(context, i);
        size_t first = piece.find_first_not_of(' ');
        if (first == std::string::npos) {
            continue;
        }
        piece = piece.substr(first, piece.find_last_not_of(' ') - first + 1);
        if (!text.empty()) {
            text += ' ';
        }
        text += piece;
    }
    return text.c_str();
}

EMSCRIPTEN_KEEPALIVE int spike_tokens() { return tokens; }
EMSCRIPTEN_KEEPALIVE float spike_encode_ms() { return timings.encode_ms; }
EMSCRIPTEN_KEEPALIVE float spike_decode_ms() { return timings.decode_ms; }

}
