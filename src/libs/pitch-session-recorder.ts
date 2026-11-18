import type { PitchInstrument } from './pitch-instrument';
import type { SessionBridge, SessionEvent, SessionSummary } from './session-bridge';

const CHUNK_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 60000;
const MIME_TYPE = 'audio/webm;codecs=opus';

export class PitchSessionRecorder {
    private rec?: MediaRecorder;
    private mix?: MediaStreamAudioDestinationNode;
    private limiter?: DynamicsCompressorNode;
    private output?: GainNode;
    private microphone?: MediaStreamAudioSourceNode;
    private sessionId?: string;
    private events: SessionEvent[] = [];
    private writes: Promise<unknown> = Promise.resolve();
    private starting?: Promise<void>;
    private closing?: Promise<void>;
    private autoSave?: number;
    private unsubscribe?: () => void;

    constructor(
        private readonly bridge: SessionBridge,
        private readonly instrument: PitchInstrument,
        private readonly getSummary: () => SessionSummary,
        private readonly onSaved: (at: string) => void,
        private readonly onError: (message: string) => void,
        onClose: () => void,
    ) {
        this.unsubscribe = bridge.onFlush(() => {
            onClose();
            return this.finish();
        });
    }

    start(stream: MediaStream) {
        if (this.closing) return this.closing;
        this.starting = this.open(stream);
        return this.starting;
    }

    private async open(stream: MediaStream) {
        await this.instrument.resume();
        const { context, output } = this.instrument.getMix();

        if (!this.rec) {
            const mix = context.createMediaStreamDestination();
            const limiter = context.createDynamicsCompressor();
            limiter.threshold.value = -11;
            limiter.ratio.value = 8;
            limiter.connect(mix);
            const recorder = new MediaRecorder(mix.stream, { mimeType: MIME_TYPE, audioBitsPerSecond: 128000 });
            const session = await this.bridge.begin(recorder.mimeType);
            this.sessionId = session.id;
            this.mix = mix;
            this.limiter = limiter;
            this.output = output;
            output.connect(limiter);
            this.rec = recorder;
            recorder.addEventListener('dataavailable', ({ data }) => {
                if (data.size === 0) return;
                void this.enqueue(async () => {
                    const bytes = new Uint8Array(await data.arrayBuffer());
                    await this.bridge.appendAudio(session.id, bytes);
                }).catch(() => {});
            });
            recorder.addEventListener('error', () => this.onError('Se interrumpió la grabación de audio.'));
        }

        this.microphone?.disconnect();
        this.microphone = context.createMediaStreamSource(stream);
        this.microphone.connect(this.limiter!);
        if (this.rec.state === 'paused') {
            this.rec.resume();
        } else if (this.rec.state === 'inactive') {
            this.rec.start(CHUNK_INTERVAL);
            this.autoSave ??= window.setInterval(() => void this.save().catch(() => {}), AUTO_SAVE_INTERVAL);
        }
    }

    add(event: SessionEvent) {
        if (this.sessionId && !this.closing) this.events.push(event);
    }

    private enqueue<T>(write: () => Promise<T>): Promise<T> {
        const result = this.writes.then(write);
        this.writes = result.catch(error => {
            console.error('Error al guardar la sesión de Pitch.', error);
            this.onError('No se pudo guardar la sesión. Comprobá el espacio y los permisos del disco.');
        });
        return result;
    }

    private flushAudio() {
        const recorder = this.rec;
        if (!recorder || recorder.state === 'inactive') return Promise.resolve();

        return new Promise<void>(resolve => {
            const done = () => {
                recorder.removeEventListener('dataavailable', done);
                recorder.removeEventListener('stop', done);
                resolve();
            };
            recorder.addEventListener('dataavailable', done, { once: true });
            recorder.addEventListener('stop', done, { once: true });
            try {
                recorder.requestData();
            } catch {
                done();
            }
        });
    }

    save() {
        if (this.closing) return this.closing;
        return this.flushAudio().then(() => this.checkpoint(false));
    }

    pause() {
        if (this.rec?.state === 'recording') this.rec.pause();
        this.microphone?.disconnect();
        this.microphone = undefined;
        return this.save();
    }

    private checkpoint(final: boolean) {
        const id = this.sessionId;
        if (!id) return Promise.resolve();
        return this.enqueue(async () => {
            const count = this.events.length;
            const at = await this.bridge.checkpoint(id, { events: this.events.slice(0, count), summary: this.getSummary() }, final);
            this.events.splice(0, count);
            this.onSaved(at);
        });
    }

    finish() {
        this.closing ??= this.finalize();
        return this.closing;
    }

    private async finalize() {
        clearInterval(this.autoSave);
        try {
            await this.starting?.catch(() => {});
            clearInterval(this.autoSave);
            const recorder = this.rec;
            if (recorder && recorder.state !== 'inactive') {
                await new Promise<void>(resolve => {
                    recorder.addEventListener('stop', () => resolve(), { once: true });
                    recorder.stop();
                });
            }
            await this.checkpoint(true);
        } finally {
            this.microphone?.disconnect();
            if (this.output && this.limiter) this.output.disconnect(this.limiter);
            this.limiter?.disconnect();
            this.mix?.stream.getTracks().forEach(track => track.stop());
            this.unsubscribe?.();
        }
    }
}
