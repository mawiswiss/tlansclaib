Speech models for tlansclaib, converted to the whisper.cpp format. The app
downloads them from this release and checks each file's size and SHA-256
before it uses it.

None of these models were trained here. Each is a published fine-tune of
OpenAI's Whisper, converted from its PyTorch weights with
`scripts/convert-model.py` (whisper.cpp's `convert-h5-to-ggml.py`, then
`whisper-quantize` to q8_0). The conversion changes the file format and the
precision of the weights, nothing else.

| File | Model | Authors | Licence |
|---|---|---|---|
| `ggml-thai-fast-q8_0.bin` | [distill-whisper-th-large-v3](https://huggingface.co/biodatlab/distill-whisper-th-large-v3) | biodatlab, Mahidol University | MIT |
| `ggml-thai-best-q8_0.bin` | [whisper-th-large-v3-combined](https://huggingface.co/biodatlab/whisper-th-large-v3-combined) | biodatlab, Mahidol University | Apache-2.0 |
| `ggml-swiss-german-q8_0.bin` | [whisper-large-v3-turbo-swiss-german-mit](https://huggingface.co/gcoli/whisper-large-v3-turbo-swiss-german-mit) | gcoli | MIT |

| File | Size | SHA-256 |
|---|---|---|
| `ggml-thai-fast-q8_0.bin` | 874,188,075 bytes | `e0894592a0a90014a22dd7675c9a001e7f9b8fa58c7fcef547e1ea9f45207042` |
| `ggml-thai-best-q8_0.bin` | 1,656,538,283 bytes | `a6a149bd28cfd240d3e7cb54253081f76ea360c169abf85cae3f13d179c35464` |
| `ggml-swiss-german-q8_0.bin` | 874,188,075 bytes | `89ec3580295d070428ba28e9bbeb973281186e740dae3eda5cd28b7942013bbf` |

The models build on [Whisper](https://github.com/openai/whisper) by OpenAI
(MIT) and are converted with [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
(MIT).

## Licences

The source repositories name their licence in the model card and carry no
separate copyright line, so the authors in the table above stand for it. The
MIT-licensed models are distributed under these terms:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

`ggml-thai-best-q8_0.bin` is distributed under the
[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0). It
is a modified version of the original: converted to the ggml format and
quantized to q8_0.
