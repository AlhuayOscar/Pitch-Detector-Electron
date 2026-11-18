import { noteNames } from '../utils/midiUtils';

export interface VocalRange {
    low: number;
    high: number;
}

interface GuideNote {
    midi: number;
    startMs: number;
    endMs: number;
}

export interface VocalRangeFit extends VocalRange {
    shift: number;
    coverage: number;
    outsideNotes: number;
}

const validMidi = (value: number) => Number.isInteger(value) && value >= 0 && value <= 127;

function parseLabel(label: string): number | null {
    const parts = /^([A-G](?:#|♯)?)(-?\d+)$/.exec(label);
    if (!parts) return null;
    const pitchClass = noteNames.indexOf(parts[1].replace('♯', '#'));
    const midi = (Number(parts[2]) + 1) * 12 + pitchClass;
    return pitchClass >= 0 && validMidi(midi) ? midi : null;
}

export function parseObservedRange(label?: string): VocalRange | null {
    const notes = label?.trim().split(/\s+[–—-]\s+/);
    if (!notes || notes.length !== 2) return null;
    const [low, high] = notes.map(parseLabel);
    return low !== null && high !== null && low < high ? { low, high } : null;
}

export function fitGuideToVocalRange(notes: readonly GuideNote[], range: VocalRange): VocalRangeFit | null {
    if (!validMidi(range.low) || !validMidi(range.high) || range.low > range.high) return null;

    const durations = new Map<number, { duration: number; count: number }>();
    let totalDuration = 0;
    let originalLow = Infinity;
    let originalHigh = -Infinity;
    for (const note of notes) {
        const duration = note.endMs - note.startMs;
        if (!validMidi(note.midi) || !Number.isFinite(duration) || duration <= 0) continue;
        const aggregate = durations.get(note.midi) ?? { duration: 0, count: 0 };
        aggregate.duration += duration;
        aggregate.count++;
        durations.set(note.midi, aggregate);
        totalDuration += duration;
        originalLow = Math.min(originalLow, note.midi);
        originalHigh = Math.max(originalHigh, note.midi);
    }
    if (!totalDuration) return null;

    let best: { shift: number; duration: number; outsideNotes: number } | undefined;
    // Candidates are ordered by preference for the smallest change, with lowering first on ties.
    const shifts = [0, ...Array.from({ length: 12 }, (_, index) => [-index - 1, index + 1]).flat()];
    for (const shift of shifts) {
        if (!validMidi(originalLow + shift) || !validMidi(originalHigh + shift)) continue;
        let duration = 0;
        let outsideNotes = 0;
        for (const [midi, aggregate] of durations) {
            const transposed = midi + shift;
            if (transposed >= range.low && transposed <= range.high) duration += aggregate.duration;
            else outsideNotes += aggregate.count;
        }
        const fitsEntirely = outsideNotes === 0;
        const bestIsPartial = best !== undefined && best.outsideNotes > 0;
        if (!best || (fitsEntirely && bestIsPartial) ||
            (bestIsPartial && !fitsEntirely && duration > best.duration + 0.000001)) {
            best = { shift, duration, outsideNotes };
        }
    }
    return best ? {
        shift: best.shift,
        coverage: best.outsideNotes ? best.duration / totalDuration : 1,
        outsideNotes: best.outsideNotes,
        low: originalLow + best.shift,
        high: originalHigh + best.shift,
    } : null;
}
