export interface SessionEvent {
    atMs: number;
    source: 'voice' | 'instrument';
    midi: number;
    action?: 'on' | 'off';
    instrument?: string;
    confidence?: number;
}

export interface SessionSummary {
    range?: string;
    key?: string;
    durationMs: number;
}

export interface SavedSession {
    id: string;
    startedAt: string;
    savedAt: string;
    finished: boolean;
    hasAudio: boolean;
}

export interface SessionBridge {
    begin(mimeType: string): Promise<{ id: string; startedAt: string }>;
    appendAudio(id: string, bytes: Uint8Array): Promise<void>;
    checkpoint(id: string, data: { events: SessionEvent[]; summary: SessionSummary }, final?: boolean): Promise<string>;
    list(): Promise<SavedSession[]>;
    play(id: string): Promise<string>;
    showFolder(): Promise<string>;
    onFlush(handler: () => Promise<void>): () => void;
}

declare global {
    interface Window {
        pitchSessions?: SessionBridge;
    }
}
