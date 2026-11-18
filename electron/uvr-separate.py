"""Headless entry point for the official UVR v5.6 MDX-Net Inst Main model."""
import json
import os
from pathlib import Path
import sys


def progress(percent, message):
    print(json.dumps({"percent": percent, "message": message}, ensure_ascii=True), flush=True)


def main():
    runtime, source, instrumental_path, vocals_path = map(Path, sys.argv[1:])
    sys.path.insert(0, str(runtime))

    # The adapter only reads local PCM and runs the pinned model.
    def guard(event, _args):
        if event in ("socket.connect", "socket.getaddrinfo"):
            raise OSError("VocalRemover funciona sin conexión.")

    sys.addaudithook(guard)
    progress(10, "Cargando el modelo UVR…")
    import numpy as np
    import onnxruntime as ort
    import soundfile as sf
    import torch
    from separate import SeperateMDX, STFT, DEFAULT

    model_directory = runtime / "models" / "MDX_Net_Models"
    model = model_directory / "UVR-MDX-NET-Inst_Main.onnx"
    model_hash = "1c56ec0224f1d559c42fd6fd2a67b154"
    model_catalog = model_directory / "model_data" / "model_data.json"
    profile = json.loads(model_catalog.read_text(encoding="utf-8"))[model_hash]

    source_info = sf.info(source)
    if (source_info.samplerate != 44100 or source_info.channels != 2 or
            source_info.frames == 0 or source_info.frames > 44100 * 600):
        raise ValueError("El audio debe tener pista de sonido y durar hasta 10 minutos.")
    samples, samplerate = sf.read(source, dtype="float32", always_2d=True)

    threads = min(4, max(1, (os.cpu_count() or 2) // 2))
    torch.set_num_threads(threads)
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])

    class OfflineMdx(SeperateMDX):
        # Use UVR's original MDX sampling, STFT, inference and overlap-add code.
        # Its GUI-specific base initializer is replaced by the model's fixed CPU profile.
        def __init__(self):
            self.device = torch.device("cpu")
            self.mdx_segment_size = 2 ** profile["mdx_dim_t_set"]
            self.dim_f = profile["mdx_dim_f_set"]
            self.n_fft = profile["mdx_n_fft_scale_set"]
            self.compensate = profile["compensate"]
            self.hop = 1024
            self.adjust = 1
            self.overlap_mdx = DEFAULT
            self.mdx_batch_size = 1
            self.is_pitch_change = False
            self.is_denoise = False
            self.is_denoise_model = False
            self.model_run = lambda spectrogram: session.run(None, {"input": spectrogram.cpu().numpy()})[0]
            self.steps = 0
            self.initialize_model_settings()
            self.stft = STFT(self.n_fft, self.hop, self.dim_f)

        def running_inference_progress_bar(self, length, is_match_mix=False):
            self.steps += 1
            progress(18 + round(69 * min(1, self.steps / length)), "Separando voz e instrumental…")

    mix = np.ascontiguousarray(samples.T)
    accompaniment = OfflineMdx().demix(mix).T
    vocals = samples - accompaniment
    progress(91, "Guardando las pistas WAV…")
    # Preserve the mix level where possible and avoid clipping either separate stem.
    gain = max(1.0, float(np.max(np.abs(accompaniment))), float(np.max(np.abs(vocals))))
    sf.write(instrumental_path, accompaniment / gain, samplerate, subtype="PCM_24")
    sf.write(vocals_path, vocals / gain, samplerate, subtype="PCM_24")


if __name__ == "__main__":
    main()
