import { midiToNoteName, noteNames } from './midiUtils';

export interface SessionTonalitySummary {
    range?: string;
    key?: string;
}

interface NoteRun {
    midi: number;
    observations: number;
    duration: number;
    weightedDuration: number;
    confidence: number;
}

const PITCH_CLASSES = 12;
const MIN_CONFIDENCE = 0.75;
const MAX_GAP_MS = 400;
const MAX_FRAME_MS = 160;
const MIN_RANGE_RUN_MS = 96;
const MIN_KEY_RUN_MS = 144;
const MAX_KEY_RUN_MS = 1800;
const MIN_CLASS_WEIGHT = 100;
const MIN_KEY_WEIGHT = 1800;
const MIN_KEY_CLASSES = 5;
const MIN_CORRELATION = 0.71;
const MIN_CORRELATION_MARGIN = 0.075;

const tonicClass = (note: number) => note % PITCH_CLASSES;

function normalizedShape(weights: readonly number[]): number[] {
    const mean = weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
    const deviations = weights.map(weight => weight - mean);
    const length = Math.hypot(...deviations);
    return length > 0 ? deviations.map(value => value / length) : deviations;
}

// Krumhansl–Kessler probe-tone profiles. Krumhansl describes the correlation
// method in https://academic.oup.com/book/40395/chapter/347203084.
const modes = [
    { name: 'mayor', third: 4, profile: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88] },
    { name: 'menor', third: 3, profile: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] },
] as const;

const candidateKeys = modes.flatMap(mode => {
    const profile = normalizedShape(mode.profile);
    return noteNames.map((note, tonic) => ({
        name: [note.replace('#', '♯'), mode.name].join(' '),
        tonic,
        third: tonicClass(tonic + mode.third),
        weights: profile.map((_value, pitchClass) => profile[tonicClass(pitchClass - tonic + PITCH_CLASSES)]),
    }));
});

function estimateKey(histogram: readonly number[]): string | undefined {
    const totalWeight = histogram.reduce((sum, weight) => sum + weight, 0);
    const supportedClasses = histogram.filter(weight => weight >= MIN_CLASS_WEIGHT).length;
    if (totalWeight < MIN_KEY_WEIGHT || supportedClasses < MIN_KEY_CLASSES) return undefined;

    const observations = normalizedShape(histogram);
    const ranked = candidateKeys.map(candidate => ({
        ...candidate,
        correlation: candidate.weights.reduce((sum, weight, index) => sum + weight * observations[index], 0),
    })).sort((first, second) => second.correlation - first.correlation);

    const [best, runnerUp] = ranked;
    if (best.correlation < MIN_CORRELATION || best.correlation - runnerUp.correlation < MIN_CORRELATION_MARGIN ||
        histogram[best.tonic] < MIN_CLASS_WEIGHT || histogram[best.third] < MIN_CLASS_WEIGHT) {
        return undefined;
    }
    return best.name;
}

function stableFor(run: NoteRun, duration: number): boolean {
    return run.observations >= 2 && run.duration >= duration;
}

function keyWeight(run: NoteRun): number {
    // Keep the mean confidence, while preventing a single held note from
    // dominating the histogram solely because of its duration.
    return Math.min(run.duration, MAX_KEY_RUN_MS) * (run.weightedDuration / run.duration);
}

function rangeLabel(low: number, high: number): string {
    const lowest = midiToNoteName(low).replace('#', '♯');
    const highest = midiToNoteName(high).replace('#', '♯');
    return low === high ? lowest : [lowest, highest].join(' – ');
}

/** Collects stable microphone pitches. This is a musical estimate for the session. */
export class SessionTonality {
    private readonly histogram = Array<number>(PITCH_CLASSES).fill(0);
    private lowest = Infinity;
    private highest = -Infinity;
    private lastTimestamp: number | undefined;
    private activeNote: NoteRun | undefined;

    observe(midi: number | null, confidence: number, atMs: number): void {
        if (!Number.isFinite(atMs)) return;

        const elapsed = this.lastTimestamp === undefined ? Infinity : atMs - this.lastTimestamp;
        if (elapsed <= 0) return;
        this.lastTimestamp = atMs;

        const note = midi !== null && Number.isFinite(midi) && Number.isFinite(confidence) && confidence >= MIN_CONFIDENCE
            ? Math.round(midi) : -1;
        const current = this.activeNote;
        if (current && elapsed <= MAX_GAP_MS) {
            const duration = Math.min(elapsed, MAX_FRAME_MS);
            current.duration += duration;
            current.weightedDuration += duration * current.confidence;
            if (note === current.midi) {
                current.observations += 1;
                current.confidence = Math.min(confidence, 1);
                return;
            }
        }

        if (current && stableFor(current, MIN_RANGE_RUN_MS)) {
            this.lowest = Math.min(this.lowest, current.midi);
            this.highest = Math.max(this.highest, current.midi);
            if (stableFor(current, MIN_KEY_RUN_MS)) this.histogram[tonicClass(current.midi)] += keyWeight(current);
        }
        this.activeNote = note >= 0 && note <= 127
            ? { midi: note, observations: 1, duration: 0, weightedDuration: 0, confidence: Math.min(confidence, 1) }
            : undefined;
    }

    summarize(): SessionTonalitySummary {
        let low = this.lowest;
        let high = this.highest;
        const histogram = this.histogram.slice();
        const current = this.activeNote;
        if (current && stableFor(current, MIN_RANGE_RUN_MS)) {
            low = Math.min(low, current.midi);
            high = Math.max(high, current.midi);
            if (stableFor(current, MIN_KEY_RUN_MS)) histogram[tonicClass(current.midi)] += keyWeight(current);
        }

        const summary: SessionTonalitySummary = {};
        if (low <= high) summary.range = rangeLabel(low, high);
        const key = estimateKey(histogram);
        if (key) summary.key = key;
        return summary;
    }

    reset(): void {
        this.histogram.fill(0);
        this.lowest = Infinity;
        this.highest = -Infinity;
        this.lastTimestamp = undefined;
        this.activeNote = undefined;
    }
}