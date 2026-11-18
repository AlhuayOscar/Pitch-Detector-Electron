import type { Accessor } from 'solid-js';

const MODEL_SAMPLE_RATE = 16000;
const WORKLET_PATH = `${import.meta.env.BASE_URL}libs/pitch-detection/pitchForwarderProcessor.js`;

type PitchUpdateCallback = (pitch: number | null, confidence: number) => void;
type ErrorCallback = (message: string) => void;
type ModelLoadedCallback = () => void;

interface PitchDetectionServiceOptions {
    smoothingFactor?: Accessor<number>;
    resetThresholdInCents?: Accessor<number>;
}

interface AudioCapture {
    id: number;
    context: AudioContext;
    stream?: MediaStream;
    source?: MediaStreamAudioSourceNode;
    forwarder?: AudioWorkletNode;
    inferencePending: boolean;
}

type WorkerMessage =
    | { type: 'model_loaded' }
    | { type: 'pitch'; captureId: number; pitch: number | null; confidence: number }
    | { type: 'error'; message: string };

function microphoneError(error: unknown): string {
    if (error instanceof DOMException) {
        switch (error.name) {
            case 'NotAllowedError':
                return 'Windows bloqueó el micrófono. Permite el acceso al micrófono en Configuración y vuelve a intentarlo.';
            case 'NotFoundError':
                return 'No hay un micrófono disponible. Conecta uno y vuelve a intentarlo.';
            case 'NotReadableError':
                return 'No se pudo usar el micrófono. Comprueba que esté disponible y vuelve a intentarlo.';
        }
    }
    return 'No se pudo iniciar la captura de audio. Revisa el micrófono y vuelve a intentarlo.';
}

export class PitchDetectionService {
    public isInitialized = false;
    public isProcessing = false;

    private worker: Worker | null = null;
    private capture: AudioCapture | null = null;
    private nextCaptureId = 0;
    private smoothedPitch: number | null = null;
    private readonly smoothingFactor: Accessor<number>;
    private readonly resetThresholdInCents: Accessor<number>;

    constructor(
        private readonly onPitchUpdate: PitchUpdateCallback,
        private readonly onError: ErrorCallback,
        private readonly onModelLoaded: ModelLoadedCallback,
        options?: PitchDetectionServiceOptions
    ) {
        this.smoothingFactor = options?.smoothingFactor ?? (() => 0);
        this.resetThresholdInCents = options?.resetThresholdInCents ?? (() => 100);
    }

    async initialize(): Promise<void> {
        if (this.worker) return;

        try {
            this.worker = new Worker(new URL('./pitchDetectionWorker.ts', import.meta.url), { type: 'module' });
        } catch (error) {
            console.error('Error al iniciar el procesador de tono.', error);
            this.onError('No se pudo iniciar el procesador de tono.');
            return;
        }

        const worker = this.worker;
        worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
            if (this.worker !== worker) return;

            switch (data.type) {
                case 'model_loaded':
                    this.isInitialized = true;
                    this.onModelLoaded();
                    break;
                case 'pitch':
                    if (this.capture?.id === data.captureId && this.isProcessing) {
                        this.capture.inferencePending = false;
                        this.updatePitch(data.pitch, data.confidence);
                    }
                    break;
                case 'error':
                    this.failWorker(data.message);
                    break;
            }
        };
        worker.onerror = (event) => {
            if (this.worker !== worker) return;
            console.error('Error del procesador de tono.', event.message);
            this.failWorker('Se interrumpió el procesador de tono. Vuelve a intentarlo.');
        };
    }

    private failWorker(message: string): void {
        void this.cleanup();
        this.onError(message);
    }

    private updatePitch(pitch: number | null, confidence: number): void {
        if (pitch === null || this.smoothedPitch === null) {
            this.smoothedPitch = pitch;
        } else {
            const distance = Math.abs(1200 * Math.log2(pitch / this.smoothedPitch));
            const threshold = Math.max(0, this.resetThresholdInCents());
            const smoothing = Math.max(0, Math.min(0.999, this.smoothingFactor()));
            this.smoothedPitch = distance > threshold
                ? pitch
                : pitch * (1 - smoothing) + this.smoothedPitch * smoothing;
        }
        this.onPitchUpdate(this.smoothedPitch, confidence);
    }

    async start(): Promise<void> {
        const worker = this.worker;
        if (!this.isInitialized || !worker) {
            this.onError('El modelo de detección todavía se está cargando.');
            return;
        }
        if (this.capture) return;

        let context: AudioContext;
        try {
            context = new AudioContext({ sampleRate: MODEL_SAMPLE_RATE, latencyHint: 'interactive' });
        } catch (error) {
            console.error('Error al abrir el sistema de audio.', error);
            this.onError('No se pudo abrir el sistema de audio.');
            return;
        }

        const capture: AudioCapture = { id: ++this.nextCaptureId, context, inferencePending: false };
        this.capture = capture;

        try {
            await context.resume();
            if (this.capture !== capture) return;
            await context.audioWorklet.addModule(new URL(WORKLET_PATH, window.location.href).href);
            if (this.capture !== capture) return;

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
                video: false
            });
            if (this.capture !== capture) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            capture.stream = stream;
            const forwarder = new AudioWorkletNode(context, 'pitch-forwarder-processor', {
                numberOfOutputs: 0,
                channelCount: 1,
                channelCountMode: 'explicit'
            });
            capture.forwarder = forwarder;
            forwarder.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
                if (this.capture !== capture || capture.inferencePending) return;
                // Drop frames while SPICE is busy to keep results current on slower machines.
                capture.inferencePending = true;
                worker.postMessage({ captureId: capture.id, samples: data }, [data.buffer]);
            };

            forwarder.onprocessorerror = () => this.failCapture(capture, 'Se interrumpió la captura de audio.');
            context.onstatechange = () => {
                if (this.isProcessing && context.state !== 'running') {
                    this.failCapture(capture, 'Se interrumpió el sistema de audio.');
                }
            };
            for (const track of stream.getAudioTracks()) {
                track.onended = () => this.failCapture(capture, 'El micrófono dejó de estar disponible.');
            }
            capture.source = context.createMediaStreamSource(stream);
            capture.source.connect(forwarder);
            this.isProcessing = true;
        } catch (error) {
            console.error('Error al iniciar la captura de audio.', error);
            this.failCapture(capture, microphoneError(error));
        }
    }

    private failCapture(capture: AudioCapture, message: string): void {
        if (this.capture !== capture) return;
        void this.stop();
        this.onError(message);
    }

    async stop(): Promise<void> {
        const capture = this.capture;
        this.capture = null;
        this.isProcessing = false;
        this.smoothedPitch = null;
        if (!capture) return;

        capture.context.onstatechange = null;
        capture.source?.disconnect();
        capture.forwarder?.port.close();
        capture.stream?.getTracks().forEach((track) => {
            track.onended = null;
            track.stop();
        });

        if (capture.context.state !== 'closed') {
            await capture.context.close().catch((error) => {
                console.error('Error al cerrar el sistema de audio.', error);
            });
        }
    }

    async cleanup(): Promise<void> {
        this.worker?.terminate();
        this.worker = null;
        this.isInitialized = false;
        await this.stop();
    }
}
