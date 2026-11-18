import { batch, createMemo, createSignal, onCleanup } from 'solid-js';
import type { MidiSegment } from '../pages/Demo';
import { midiToNoteName } from '../utils/midiUtils';
import type { ReferenceMediaBridge } from './reference-bridge';
import type { ReferenceNote } from './reference-transcription';

export function createSongGuide(bridge: ReferenceMediaBridge, chartTime: () => number, onTick: () => void) {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = 0.55;
    const [name, setName] = createSignal('');
    const [notes, setNotes] = createSignal<ReferenceNote[]>([]);
    const [duration, setDuration] = createSignal(0);
    const [position, setPosition] = createSignal(0);
    const [semitones, setSemitones] = createSignal(0);
    const [playing, setPlaying] = createSignal(false);
    const [busy, setBusy] = createSignal('');
    const [error, setError] = createSignal('');
    let url: string | undefined;
    let worker: Worker | undefined;
    let stopAnalysis: (() => void) | undefined;
    let operation = 0;

    const pause = () => {
        audio.pause();
        setPlaying(false);
    };
    const update = () => batch(() => {
        setPosition(audio.currentTime * 1000);
        onTick();
    });
    const clock = window.setInterval(() => {
        if (!audio.paused && !audio.ended) update();
    }, 45);
    audio.addEventListener('ended', () => {
        setPlaying(false);
        update();
    });

    const showError = (cause: unknown) => {
        const text = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '';
        setError(text || 'No se pudo preparar la guía de la canción.');
    };

    function analyze(bytes: Uint8Array) {
        return new Promise<ReferenceNote[]>((resolve, reject) => {
            const source = new Float32Array(bytes.slice().buffer);
            const job = new Worker(new URL('./reference-transcription.worker.ts', import.meta.url), { type: 'module' });
            worker = job;
            const complete = () => {
                job.terminate();
                if (worker === job) {
                    worker = undefined;
                    stopAnalysis = undefined;
                }
            };
            const fail = () => {
                complete();
                reject(new Error('No se pudieron estimar las notas del audio.'));
            };
            stopAnalysis = fail;
            job.onerror = fail;
            job.onmessage = ({ data }) => {
                if (data.type === 'progress') {
                    setBusy('Analizando notas ' + Math.round(data.progress * 100) + ' %');
                } else if (data.type === 'done') {
                    complete();
                    resolve(data.notes);
                } else {
                    fail();
                }
            };
            job.postMessage(source, [source.buffer]);
        });
    }

    const setPlayback = (wav: Uint8Array, seconds: number, seekMs = 0) => {
        pause();
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([wav.slice().buffer as ArrayBuffer], { type: 'audio/wav' }));
        audio.src = url;
        setDuration(seconds * 1000);
        audio.currentTime = Math.min(seekMs / 1000, Math.max(0, seconds - 0.01));
        update();
    };

    const choose = async () => {
        const id = ++operation;
        pause();
        setBusy('Abriendo archivo…');
        setError('');
        try {
            const media = await bridge.select();
            if (!media || operation !== id) return;
            setName(media.name);
            setNotes([]);
            setDuration(0);
            setPosition(0);
            setSemitones(0);
            setBusy('Analizando notas…');
            const [result, playback] = await Promise.all([analyze(media.samples), bridge.render(0)]);
            if (operation !== id) return;
            setPlayback(playback.wav, media.durationSeconds);
            setNotes(result);
            if (!result.length) setError('No se distinguieron notas estables en este audio.');
        } catch (cause) {
            if (operation === id) {
                stopAnalysis?.();
                showError(cause);
            }
        } finally {
            if (operation === id) setBusy('');
        }
    };

    const transpose = async (shift: number) => {
        if (busy() || !Number.isInteger(shift) || shift === semitones()) return;
        pause();
        const id = ++operation;
        setError('');
        setBusy('Ajustando la tonalidad…');
        try {
            const result = await bridge.render(shift);
            if (operation !== id) return;
            setPlayback(result.wav, result.durationSeconds, position());
            setSemitones(shift);
        } catch (cause) {
            if (operation === id) showError(cause);
        } finally {
            if (operation === id) setBusy('');
        }
    };

    const cancel = () => {
        ++operation;
        stopAnalysis?.();
        void bridge.cancel().catch(() => {});
        setBusy('');
    };

    const toggle = async () => {
        if (playing()) {
            pause();
            update();
        } else if (duration() > 0) {
            try {
                if (audio.ended) audio.currentTime = 0;
                await audio.play();
                setPlaying(true);
                update();
            } catch (cause) {
                showError(cause);
            }
        }
    };

    const seek = (ms: number) => {
        if (!duration()) return;
        audio.currentTime = ms / 1000;
        update();
    };

    const bounds = createMemo(() => {
        const values = notes().map(note => note.midi + semitones());
        return values.length ? { low: Math.min(...values), high: Math.max(...values) } : null;
    });
    const range = createMemo(() => {
        const values = bounds();
        return values ? midiToNoteName(values.low) + ' – ' + midiToNoteName(values.high) : '';
    });

    const target = createMemo(() => {
        const match = notes().find(note => note.startMs <= position() && note.endMs > position());
        return match ? match.midi + semitones() : null;
    });

    const chartNotes = createMemo<MidiSegment[]>(() => {
        const now = position();
        const anchor = chartTime() - now;
        return notes().filter(note => note.endMs >= now - 500000 && note.startMs <= now + 30000).map(note => ({
            startTime: anchor + note.startMs,
            endTime: anchor + note.endMs,
            duration: note.endMs - note.startMs,
            avgContinuousMidi: note.midi + semitones(),
            avgConfidence: note.confidence,
        }));
    });

    onCleanup(() => {
        cancel();
        pause();
        clearInterval(clock);
        audio.removeAttribute('src');
        audio.load();
        if (url) URL.revokeObjectURL(url);
    });

    return { name, notes, duration, position, semitones, playing, busy, error, choose, transpose, toggle, seek, pause, cancel, range, bounds, target, chartNotes };
}

export type SongGuide = ReturnType<typeof createSongGuide>;
