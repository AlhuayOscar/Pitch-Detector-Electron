export const instrumentNames = {
    piano: 'Piano',
    organ: 'Órgano',
    strings: 'Cuerdas',
    synth: 'Sintetizador',
} as const;

export type Instrument = keyof typeof instrumentNames;

interface Preset {
    wave: OscillatorType;
    partials: [ratio: number, volume: number][];
    attack: number;
    decay: number;
    sustain: number;
    release: number;
}

const presets: Record<Instrument, Preset> = {
    piano: { wave: 'sine', partials: [[1, 1], [2, 0.38], [3.002, 0.20], [4.01, 0.1], [5.02, 0.035]], attack: 0.008, decay: 0.85, sustain: 0.04, release: 0.2 },
    organ: { wave: 'sine', partials: [[0.5, 0.25], [1, 0.8], [2, 0.4], [3, 0.18]], attack: 0.025, decay: 0.14, sustain: 0.78, release: 0.14 },
    strings: { wave: 'triangle', partials: [[0.998, 0.48], [1.003, 0.47], [2, 0.12]], attack: 0.12, decay: 0.3, sustain: 0.72, release: 0.32 },
    synth: { wave: 'sawtooth', partials: [[1, 0.34], [0.5, 0.10]], attack: 0.016, decay: 0.32, sustain: 0.55, release: 0.25 },
};

interface Voice {
    oscillators: OscillatorNode[];
    gain: GainNode;
    release: number;
}

export class PitchInstrument {
    private context?: AudioContext;
    private output?: GainNode;
    private readonly voices = new Map<number, Voice>();

    getMix() {
        if (!this.context) {
            const context = new AudioContext({ latencyHint: 'interactive' });
            this.context = context;
            this.output = context.createGain();
            this.output.gain.value = 0.55;
            this.output.connect(context.destination);
        }
        return { context: this.context, output: this.output! };
    }

    async resume() {
        const { context } = this.getMix();
        if (context.state === 'suspended') await context.resume();
    }

    noteOn(midi: number, instrument: Instrument) {
        if (this.voices.has(midi)) return;
        const { context, output } = this.getMix();
        const now = context.currentTime;
        const preset = presets[instrument];
        const frequency = 440 * 2 ** ((midi - 69) / 12);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.34, now + preset.attack);
        gain.gain.exponentialRampToValueAtTime(0.34 * preset.sustain, now + preset.attack + preset.decay);
        gain.connect(output);
        const oscillators = preset.partials.map(([ratio, volume]) => {
            const oscillator = context.createOscillator();
            const level = context.createGain();
            oscillator.type = preset.wave;
            oscillator.frequency.value = frequency * ratio;
            level.gain.value = volume;
            oscillator.connect(level).connect(gain);
            oscillator.start(now);
            return oscillator;
        });
        this.voices.set(midi, { oscillators, gain, release: preset.release });
    }

    noteOff(midi: number) {
        const voice = this.voices.get(midi);
        if (!voice || !this.context) return;
        this.voices.delete(midi);
        const now = this.context.currentTime;
        const end = now + voice.release;
        voice.gain.gain.cancelAndHoldAtTime(now);
        voice.gain.gain.linearRampToValueAtTime(0, end);
        for (const oscillator of voice.oscillators) oscillator.stop(end);
        voice.oscillators[0].onended = () => voice.gain.disconnect();
    }

    async dispose() {
        for (const midi of this.voices.keys()) this.noteOff(midi);
        if (this.context && this.context.state !== 'closed') await this.context.close();
    }
}
