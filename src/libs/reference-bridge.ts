export interface ReferenceMedia {
    name: string;
    samples: Uint8Array;
    durationSeconds: number;
}

export interface ReferenceMediaBridge {
    select(): Promise<ReferenceMedia | null>;
    selectVocals(token: string): Promise<ReferenceMedia>;
    render(semitones: number): Promise<{ wav: Uint8Array; durationSeconds: number }>;
    cancel(): Promise<void>;
}

declare global {
    interface Window {
        referenceMedia?: ReferenceMediaBridge;
    }
}
