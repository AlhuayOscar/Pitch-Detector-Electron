export interface ReferenceNote {
    startMs: number;
    endMs: number;
    midi: number;
    confidence: number;
}

const SAMPLE_RATE = 8000;
const FRAME = 512;
const HOP = 256;
const MIN_LAG = Math.floor(SAMPLE_RATE / 1450);
const MAX_LAG = Math.floor(SAMPLE_RATE / 55);
const MIN_RUN_MS = 85;
const THRESHOLD = 0.16;

function estimateNote(samples: Float32Array, start: number, differences: Float32Array) {
    let squared = 0;
    for (let i = 0; i < FRAME; i++) squared += samples[start + i] ** 2;
    if (squared / FRAME < 0.00004) return null;

    // YIN's cumulative mean normalized difference, measured over the same frame for every lag.
    let cumulative = 0;
    differences[0] = 1;
    for (let lag = 1; lag <= MAX_LAG; lag++) {
        let delta = 0;
        for (let i = start; i < start + FRAME; i++) {
            const difference = samples[i] - samples[i + lag];
            delta += difference * difference;
        }
        cumulative += delta;
        differences[lag] = cumulative ? delta * lag / cumulative : 1;
    }

    let lag = MIN_LAG;
    while (lag < MAX_LAG && differences[lag] >= THRESHOLD) lag++;
    if (differences[lag] >= THRESHOLD) return null;
    while (lag < MAX_LAG && differences[lag + 1] < differences[lag]) lag++;

    const best = differences[lag];
    const left = differences[lag - 1];
    const right = differences[lag + 1] ?? best;
    const curvature = left + right - 2 * best;
    const refined = lag + (curvature > 0 ? 0.5 * (left - right) / curvature : 0);
    const midi = Math.round(69 + 12 * Math.log2(SAMPLE_RATE / refined / 440));
    return { midi, confidence: 1 - best };
}

export function transcribeReference(input: Float32Array, onProgress: (fraction: number) => void): ReferenceNote[] {
    // The local decoder outputs 16 kHz. The voice range fits comfortably after decimation.
    const samples = new Float32Array(Math.floor(input.length / 2));
    for (let i = 0; i < samples.length; i++) {
        const value = (input[i * 2] + input[i * 2 + 1]) * 0.5;
        samples[i] = Number.isFinite(value) ? value : 0;
    }

    const differences = new Float32Array(MAX_LAG + 1);
    const notes: ReferenceNote[] = [];
    const available = samples.length - FRAME - MAX_LAG;
    let current: ReferenceNote | undefined;
    let previousProgress = -1;

    const flush = () => {
        if (!current || current.endMs - current.startMs < MIN_RUN_MS) return;
        const last = notes.at(-1);
        if (last?.midi === current.midi && current.startMs - last.endMs <= 65) {
            last.endMs = current.endMs;
            last.confidence = Math.max(last.confidence, current.confidence);
        } else {
            notes.push(current);
        }
    };

    for (let start = 0; start <= available; start += HOP) {
        const pitch = estimateNote(samples, start, differences);
        const centerMs = ((start + FRAME / 2) * 1000) / SAMPLE_RATE;
        const from = centerMs - HOP * 500 / SAMPLE_RATE;
        const to = centerMs + HOP * 500 / SAMPLE_RATE;
        if (current && pitch?.midi === current.midi) {
            current.endMs = to;
            current.confidence = Math.max(current.confidence, pitch.confidence);
        } else {
            flush();
            current = pitch ? { ...pitch, startMs: from, endMs: to } : undefined;
        }
        const progress = Math.round(start * 100 / Math.max(1, available));
        if (progress !== previousProgress) {
            onProgress(progress / 100);
            previousProgress = progress;
        }
    }
    flush();
    onProgress(1);
    return notes;
}
