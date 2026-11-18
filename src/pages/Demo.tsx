import { batch, createEffect, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
import { AudioLines, FolderOpen, Mic, RotateCw, Settings2, ShieldCheck, ZoomIn, ZoomOut } from 'lucide-solid';
import { PitchDetectionService } from '../libs/pitch-detection/pitchDetectionService';
import PianoRoll from '../components/PianoRoll';
import ControlBar, { type DetectionState } from '../components/demo/ControlBar';
import DebugOverlay from '../components/debug/DebugOverlay';
import { getNoteDetails, type NoteDetails } from '../utils/midiUtils';
import { SessionTonality, type SessionTonalitySummary } from '../utils/sessionTonality';
import { instrumentNames, PitchInstrument, type Instrument } from '../libs/pitch-instrument';
import { PitchSessionRecorder } from '../libs/pitch-session-recorder';
import SavedSessions from '../components/demo/SavedSessions';
import SongGuidePanel from '../components/demo/SongGuidePanel';
import { createSongGuide } from '../libs/song-guide';
import '../components/demo/session-tools.css';

const INITIAL_PIXELS_PER_SECOND = 60;
const MIN_PIXELS_PER_SECOND = 10;
const MAX_PIXELS_PER_SECOND = 200;
let pendingSessionSave: Promise<void> = Promise.resolve();

export interface MidiSegment {
    startTime: number;
    endTime: number;
    duration: number;
    avgContinuousMidi: number | null;
    avgConfidence: number;
}

interface PitchHistoryPoint {
    x: number;
    confidence: number;
    continuousMidi: number | null;
}

const Demo: Component = () => {
    const [pitch, setPitch] = createSignal<number | null>(null);
    const [confidence, setConfidence] = createSignal(0);
    const [noteDetails, setNoteDetails] = createSignal<NoteDetails | null>(null);
    const [state, setState] = createSignal<DetectionState>('idle');
    const [error, setError] = createSignal<string | null>(null);
    const [segmentedNotes, setSegmentedNotes] = createSignal<MidiSegment[]>([]);
    const [viewEndTime, setViewEndTime] = createSignal(Date.now());
    const [pixelsPerSecond, setPixelsPerSecond] = createSignal(INITIAL_PIXELS_PER_SECOND);
    const [orientation, setOrientation] = createSignal<'horizontal' | 'vertical'>('horizontal');
    const [showDebugOverlay, setShowDebugOverlay] = createSignal(false);
    const [instrument, setInstrument] = createSignal<Instrument>('piano');
    const [playedKeys, setPlayedKeys] = createSignal<ReadonlySet<number>>(new Set());
    const [playedNotes, setPlayedNotes] = createSignal<MidiSegment[]>([]);
    const [tonality, setTonality] = createSignal<SessionTonalitySummary>({});
    const [showSessions, setShowSessions] = createSignal(false);
    const [lastSaved, setLastSaved] = createSignal<string>();
    const [recordingError, setRecordingError] = createSignal<string>();
    const [recordingReady, setRecordingReady] = createSignal(false);
    const sessionBridge = window.pitchSessions;
    const sound = new PitchInstrument();
    const analysis = new SessionTonality();

    const [confidenceThreshold, setConfidenceThreshold] = createSignal(0.65);
    const [pitchChangeThreshold, setPitchChangeThreshold] = createSignal(0.75);
    const [minNoteDuration, setMinNoteDuration] = createSignal(50);
    const [maxGapForMerge, setMaxGapForMerge] = createSignal(100);
    const [pitchDiffForMerge, setPitchDiffForMerge] = createSignal(0.5);
    const [smoothingFactor, setSmoothingFactor] = createSignal(0.9);
    const [resetThreshold, setResetThreshold] = createSignal(100);

    let settingsButton: HTMLButtonElement;
    let sessionsButton: HTMLButtonElement | undefined;
    let recorder: PitchSessionRecorder | undefined;
    let sessionStart: number | null = null;
    let completedNotes: MidiSegment[] = [];
    const heldNotes = new Map<number, { startedAt: number | null; instrument: Instrument }>();
    const clockOrigin = Date.now() - performance.now();
    const clock = () => clockOrigin + performance.now();
    let serviceInstance: PitchDetectionService | null = null;
    let pitchHistory: PitchHistoryPoint[] = [];
    let pauseOffset = 0;
    let pauseStartTime: number | null = null;

    const currentTime = () => (pauseStartTime ?? clock()) - pauseOffset;
    const guide = window.referenceMedia
        ? createSongGuide(window.referenceMedia, viewEndTime, () => setViewEndTime(currentTime()))
        : undefined;
    const showGuide = () => !!guide?.duration() && !!guide.notes().length;
    const elapsed = (time = currentTime()) => sessionStart === null ? 0 : Math.max(0, Math.round(time - sessionStart));

    const showTonality = () => {
        const next = analysis.summarize();
        setTonality(before => before.range === next.range && before.key === next.key ? before : next);
    };

    const instrumentSegment = (midi: number, startedAt: number, now: number): MidiSegment => ({
        startTime: startedAt,
        endTime: now,
        duration: Math.max(0, now - startedAt),
        avgContinuousMidi: midi,
        avgConfidence: 1,
    });

    const refreshPlayedNotes = (now: number) => {
        completedNotes = completedNotes.filter(note => note.endTime >= now - 10 * 60 * 1000);
        const active: MidiSegment[] = [];
        for (const [midi, note] of heldNotes) {
            if (note.startedAt !== null) active.push(instrumentSegment(midi, note.startedAt, now));
        }
        setPlayedNotes([...completedNotes, ...active]);
    };

    const registerPlayedNote = (midi: number, instrumentName: Instrument, action: 'on' | 'off', time: number) => {
        recorder?.add({ atMs: elapsed(time), source: 'instrument', midi, action, instrument: instrumentName });
    };

    const playNote = (midi: number) => {
        if (heldNotes.has(midi)) return;
        const chosen = instrument();
        try {
            void sound.resume().catch(() => setRecordingError('No se pudo activar el sonido del instrumento.'));
            sound.noteOn(midi, chosen);
        } catch {
            setRecordingError('No se pudo reproducir el instrumento.');
            return;
        }
        const now = state() === 'recording' ? currentTime() : null;
        heldNotes.set(midi, { startedAt: now, instrument: chosen });
        setPlayedKeys(new Set(heldNotes.keys()));
        if (now !== null) {
            registerPlayedNote(midi, chosen, 'on', now);
            refreshPlayedNotes(now);
            setViewEndTime(now);
        }
    };

    const releaseNote = (midi: number) => {
        const note = heldNotes.get(midi);
        if (!note) return;
        heldNotes.delete(midi);
        sound.noteOff(midi);
        setPlayedKeys(new Set(heldNotes.keys()));
        if (note.startedAt !== null) {
            const now = currentTime();
            registerPlayedNote(midi, note.instrument, 'off', now);
            completedNotes.push(instrumentSegment(midi, note.startedAt, now));
            refreshPlayedNotes(now);
            setViewEndTime(now);
        }
    };

    const releaseAllNotes = () => {
        for (const midi of heldNotes.keys()) releaseNote(midi);
    };

    const summarizeSession = () => ({ ...analysis.summarize(), durationMs: elapsed() });
    const pauseSession = () => {
        pauseStartTime ??= clock();
        guide?.pause();
        releaseAllNotes();
        analysis.observe(null, 0, currentTime());
        showTonality();
    };

    const generateMidiSegments = (history: PitchHistoryPoint[]) => {
        if (history.length < 2) return;

        const potentialSegments: MidiSegment[] = [];
        let currentSegmentPoints: { x: number, continuousMidi: number, confidence: number }[] = [];
        let currentSegmentStartTime: number | null = null;

        for (let i = 0; i < history.length; i++) {
            const point = history[i];
            const isVoiced = point.confidence >= confidenceThreshold() && point.continuousMidi !== null && Number.isFinite(point.continuousMidi);

            if (isVoiced) {
                const currentMidi = point.continuousMidi!;
                if (currentSegmentPoints.length === 0) {
                    currentSegmentStartTime = point.x;
                    currentSegmentPoints.push({ x: point.x, continuousMidi: currentMidi, confidence: point.confidence });
                } else {
                    const prevMidi = currentSegmentPoints[currentSegmentPoints.length - 1].continuousMidi;
                    const pitchDiff = Math.abs(currentMidi - prevMidi);

                    if (pitchDiff > pitchChangeThreshold() * 0.75) {
                        const endTime = currentSegmentPoints[currentSegmentPoints.length - 1].x;
                        const duration = endTime - currentSegmentStartTime!;
                        if (duration >= minNoteDuration() && currentSegmentPoints.length > 0) {
                            const sumMidi = currentSegmentPoints.reduce((acc, p) => acc + p.continuousMidi, 0);
                            const sumConfidence = currentSegmentPoints.reduce((acc, p) => acc + p.confidence, 0);
                            potentialSegments.push({
                                startTime: currentSegmentStartTime!, endTime: endTime, duration: duration,
                                avgContinuousMidi: sumMidi / currentSegmentPoints.length,
                                avgConfidence: sumConfidence / currentSegmentPoints.length
                            });
                        }
                        currentSegmentStartTime = point.x;
                        currentSegmentPoints = [{ x: point.x, continuousMidi: currentMidi, confidence: point.confidence }];
                    } else {
                        currentSegmentPoints.push({ x: point.x, continuousMidi: currentMidi, confidence: point.confidence });
                    }
                }
            } else {
                if (currentSegmentPoints.length > 0) {
                    const endTime = currentSegmentPoints[currentSegmentPoints.length - 1].x;
                    const duration = endTime - currentSegmentStartTime!;
                    if (duration >= minNoteDuration()) {
                        const sumMidi = currentSegmentPoints.reduce((acc, p) => acc + p.continuousMidi, 0);
                        const sumConfidence = currentSegmentPoints.reduce((acc, p) => acc + p.confidence, 0);
                        potentialSegments.push({
                            startTime: currentSegmentStartTime!, endTime: endTime, duration: duration,
                            avgContinuousMidi: sumMidi / currentSegmentPoints.length,
                            avgConfidence: sumConfidence / currentSegmentPoints.length
                        });
                    }
                    currentSegmentPoints = [];
                    currentSegmentStartTime = null;
                }
            }
        }

        if (currentSegmentPoints.length > 0) {
            const endTime = currentSegmentPoints[currentSegmentPoints.length - 1].x;
            const duration = endTime - currentSegmentStartTime!;
            if (duration >= minNoteDuration()) {
                const sumMidi = currentSegmentPoints.reduce((acc, p) => acc + p.continuousMidi, 0);
                const sumConfidence = currentSegmentPoints.reduce((acc, p) => acc + p.confidence, 0);
                potentialSegments.push({
                    startTime: currentSegmentStartTime!, endTime: endTime, duration: duration,
                    avgContinuousMidi: sumMidi / currentSegmentPoints.length,
                    avgConfidence: sumConfidence / currentSegmentPoints.length
                });
            }
        }


        const mergedSegments: MidiSegment[] = [];
        if (potentialSegments.length > 0) {
            mergedSegments.push(potentialSegments[0]);
            for (let i = 1; i < potentialSegments.length; i++) {
                const prev = mergedSegments[mergedSegments.length - 1];
                const curr = potentialSegments[i];
                const gap = curr.startTime - prev.endTime;
                const prevMidi = prev.avgContinuousMidi;
                const currMidi = curr.avgContinuousMidi;

                if (prevMidi !== null && currMidi !== null && Number.isFinite(prevMidi) && Number.isFinite(currMidi)) {
                    const pitchDiff = Math.abs(currMidi - prevMidi);
                    if (gap > 0 && gap < maxGapForMerge() && pitchDiff < pitchDiffForMerge() * 0.75) {
                        const totalPointsDuration = prev.duration + curr.duration;
                        if (totalPointsDuration > 0) {
                            const weightedAvgMidi = ((prevMidi * prev.duration) + (currMidi * curr.duration)) / totalPointsDuration;
                            const weightedAvgConfidence = ((prev.avgConfidence * prev.duration) + (curr.avgConfidence * curr.duration)) / totalPointsDuration;
                            mergedSegments[mergedSegments.length - 1] = {
                                ...prev,
                                endTime: curr.endTime,
                                duration: prev.duration + gap + curr.duration,
                                avgContinuousMidi: weightedAvgMidi,
                                avgConfidence: weightedAvgConfidence,
                            };
                            continue;
                        }
                    }
                }
                mergedSegments.push(curr);
            }
        }
        setSegmentedNotes(mergedSegments);
    };


    const updatePitch = (frequency: number | null, detectedConfidence: number) => {
        if (state() !== 'recording') return;
        const now = currentTime();
        const note = getNoteDetails(frequency);
        analysis.observe(note?.continuousMidi ?? null, detectedConfidence, now);
        if (note?.continuousMidi != null) {
            recorder?.add({ atMs: elapsed(now), source: 'voice', midi: note.continuousMidi, confidence: detectedConfidence });
        }
        pitchHistory.push({
            x: now,
            confidence: detectedConfidence,
            continuousMidi: note?.continuousMidi ?? null,
        });
        batch(() => {
            setPitch(frequency);
            setConfidence(detectedConfidence);
            setNoteDetails(note);
            generateMidiSegments(pitchHistory);
            if (heldNotes.size) refreshPlayedNotes(now);
            showTonality();
            setViewEndTime(now);
        });
    };

    const handleError = (message: string) => {
        if (state() === 'recording') {
            pauseSession();
            void recorder?.pause().catch(() => {});
        }
        const instance = serviceInstance;
        serviceInstance = null;
        setPitch(null);
        setConfidence(0);
        setNoteDetails(null);
        setError(message);
        setState('error');
        void instance?.cleanup();
    };

    const startProcessing = async (instance: PitchDetectionService) => {
        try {
            await instance.start();
            if (instance !== serviceInstance) return;
            if (!instance.isProcessing) {
                handleError('No se pudo iniciar la detección. Comprueba el micrófono y vuelve a intentarlo.');
                return;
            }

            const stream = instance.mediaStream;
            if (sessionBridge && stream) {
                await pendingSessionSave;
                if (instance !== serviceInstance) return;
                recorder ??= new PitchSessionRecorder(
                    sessionBridge, sound, summarizeSession, setLastSaved, setRecordingError, pauseSession,
                );
                try {
                    await recorder.start(stream);
                    setRecordingReady(true);
                } catch (cause) {
                    console.error('Error al grabar la sesión de Pitch.', cause);
                    setRecordingError('No se pudo iniciar la grabación. La detección sigue disponible.');
                    setRecordingReady(false);
                }
                if (instance !== serviceInstance) return;
            }

            const now = clock();
            if (pauseStartTime !== null) {
                pauseOffset += now - pauseStartTime;
                pauseStartTime = null;
            }
            const logicalNow = now - pauseOffset;
            sessionStart ??= logicalNow;
            for (const [midi, note] of heldNotes) {
                note.startedAt = logicalNow;
                registerPlayedNote(midi, note.instrument, 'on', logicalNow);
            }
            refreshPlayedNotes(logicalNow);
            setViewEndTime(logicalNow);
            setState('recording');
        } catch (cause) {
            if (instance === serviceInstance) {
                console.error(cause);
                handleError('No se pudo iniciar la detección. Comprueba el micrófono y vuelve a intentarlo.');
            }
        }
    };

    const toggleDetection = async () => {
        if (state() === 'starting' || state() === 'pausing') return;
        if (state() === 'recording' && serviceInstance) {
            const instance = serviceInstance;
            pauseSession();
            setState('pausing');
            try {
                const save = recorder?.pause().catch(() => {});
                await instance.stop();
                await save;
                if (instance === serviceInstance) setState('paused');
            } catch (cause) {
                if (instance === serviceInstance) {
                    console.error(cause);
                    handleError('No se pudo pausar la detección.');
                }
            }
            return;
        }

        setError(null);
        setRecordingError(undefined);
        void sound.resume().catch(() => {});
        setState('starting');
        if (serviceInstance) {
            await startProcessing(serviceInstance);
            return;
        }

        if (sessionStart === null) {
            pitchHistory = [];
            setSegmentedNotes([]);
            pauseOffset = 0;
            pauseStartTime = null;
            analysis.reset();
            setTonality({});
        }
        const instance = new PitchDetectionService(
            (frequency, detectedConfidence) => {
                if (serviceInstance === instance) updatePitch(frequency, detectedConfidence);
            },
            (message) => {
                if (serviceInstance === instance) handleError(message);
            },
            () => {
                if (serviceInstance === instance) void startProcessing(instance);
            },
            { smoothingFactor, resetThresholdInCents: resetThreshold },
        );
        serviceInstance = instance;

        try {
            await instance.initialize();
        } catch (cause) {
            if (instance === serviceInstance) {
                console.error(cause);
                handleError('No se pudo cargar el modelo de detección local.');
            }
        }
    };

    const closeSettings = () => {
        setShowDebugOverlay(false);
        settingsButton.focus();
    };

    const adjustZoom = (factor: number) => {
        setPixelsPerSecond(previous =>
            Math.min(MAX_PIXELS_PER_SECOND, Math.max(MIN_PIXELS_PER_SECOND, previous * factor))
        );
    };

    const emptyTitle = () => {
        if (state() === 'recording') return 'Esperando una nota';
        if (state() === 'starting') return 'Preparando la detección';
        return 'Sin notas en el historial';
    };

    const emptyDetail = () => {
        if (state() === 'recording') return 'Canta o tararea una nota sostenida.';
        if (state() === 'paused') return 'Reanuda la detección para volver a escuchar.';
        if (state() === 'idle') return 'Inicia la detección y canta o tararea una nota.';
        return null;
    };

    createEffect(() => {
        confidenceThreshold();
        pitchChangeThreshold();
        minNoteDuration();
        maxGapForMerge();
        pitchDiffForMerge();
        generateMidiSegments(pitchHistory);
    });

    onMount(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && showDebugOverlay()) {
                closeSettings();
                return;
            }
            if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) {
                return;
            }
            if (event.key.toLowerCase() === 'd') {
                if (showDebugOverlay()) closeSettings();
                else setShowDebugOverlay(true);
            }
            if (event.key === ' ' && !(event.target instanceof Element && event.target.closest('button, a'))) {
                event.preventDefault();
                void toggleDetection();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
    });

    onCleanup(() => {
        const instance = serviceInstance;
        serviceInstance = null;
        if (state() === 'recording') pauseSession();
        else releaseAllNotes();
        void instance?.cleanup();
        const finish = recorder?.finish() ?? Promise.resolve();
        pendingSessionSave = finish.catch(() => {});
        void pendingSessionSave.then(() => sound.dispose()).catch(console.error);
    });

    return (
        <div class="app-shell">
            <header class="app-header">
                <div class="app-brand">
                    <span class="app-mark"><AudioLines size={25} stroke-width={1.9} aria-hidden="true" /></span>
                    <h1>Pitch Detector</h1>
                </div>
                <div class="header-actions">
                    <span class="local-indicator" title="El audio se analiza en este equipo">
                        <ShieldCheck size={16} aria-hidden="true" /> Sin conexión
                    </span>
                    <button
                        class="rotate-button"
                        type="button"
                        aria-pressed={orientation() === 'vertical'}
                        aria-controls="history-chart"
                        title={orientation() === 'vertical' ? 'Mostrar el piano a la izquierda' : 'Mostrar el piano abajo'}
                        onClick={() => setOrientation(current => current === 'horizontal' ? 'vertical' : 'horizontal')}
                    >
                        <RotateCw size={16} aria-hidden="true" /> Rotar sistema
                    </button>
                    <Show when={sessionBridge}>
                        <button
                            ref={sessionsButton}
                            class="rotate-button"
                            type="button"
                            title="Sesiones guardadas"
                            aria-label="Sesiones guardadas"
                            onClick={() => setShowSessions(true)}
                        >
                            <FolderOpen size={16} aria-hidden="true" /> <span class="session-button-label">Sesiones</span>
                        </button>
                    </Show>
                    <button
                        ref={settingsButton}
                        class="icon-button settings-button"
                        type="button"
                        aria-label="Ajustes de detección"
                        title="Ajustes de detección (D)"
                        aria-expanded={showDebugOverlay()}
                        aria-controls={showDebugOverlay() ? 'detection-settings' : undefined}
                        aria-keyshortcuts="D"
                        onClick={() => showDebugOverlay() ? closeSettings() : setShowDebugOverlay(true)}
                    >
                        <Settings2 size={19} aria-hidden="true" />
                    </button>
                </div>
            </header>

            <main class="app-workspace">
                <ControlBar
                    pitch={pitch()}
                    confidence={confidence()}
                    noteDetails={noteDetails()}
                    state={state()}
                    error={error()}
                    onToggle={toggleDetection}
                    tonalRange={tonality().range}
                    estimatedKey={tonality().key}
                    session={sessionBridge ? {
                        recording: recordingReady() && state() === 'recording',
                        canSave: recordingReady(),
                        lastSaved: lastSaved(),
                        error: recordingError(),
                        save: () => void recorder?.save().catch(() => {}),
                    } : undefined}
                />

                <section class="history-panel" aria-labelledby="history-title">
                    <div class="history-header">
                        <div>
                            <h2 id="history-title">Historial de notas</h2>
                            <span class="history-subtitle">{orientation() === 'vertical' ? 'Piano abajo' : 'Piano a la izquierda'}</span>
                            <div class="history-legend">
                                <span>Voz</span><span class="legend-instrument">Instrumento</span>
                                <Show when={showGuide()}><span class="legend-guide">Guía</span></Show>
                            </div>
                        </div>
                        <div class="history-tools">
                            <label class="instrument-choice">
                                Instrumento
                                <select value={instrument()} onChange={(event) => setInstrument(event.currentTarget.value as Instrument)}>
                                    <For each={Object.entries(instrumentNames)}>{([value, label]) => <option value={value}>{label}</option>}</For>
                                </select>
                            </label>
                            <div class="zoom-actions" role="group" aria-label="Zoom del historial">
                                <button
                                    class="icon-button"
                                    type="button"
                                    aria-label="Alejar historial"
                                    title="Alejar historial"
                                    disabled={pixelsPerSecond() <= MIN_PIXELS_PER_SECOND}
                                    onClick={() => adjustZoom(1 / 1.4)}
                                >
                                    <ZoomOut size={18} aria-hidden="true" />
                                </button>
                                <button
                                    class="icon-button"
                                    type="button"
                                    aria-label="Acercar historial"
                                    title="Acercar historial"
                                    disabled={pixelsPerSecond() >= MAX_PIXELS_PER_SECOND}
                                    onClick={() => adjustZoom(1.4)}
                                >
                                    <ZoomIn size={18} aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    </div>
                    <Show when={guide}>
                        {(reference) => <SongGuidePanel guide={reference()} liveMidi={state() === 'recording' ? noteDetails()?.continuousMidi : null} />}
                    </Show>
                    <div id="history-chart" class="history-chart" classList={{ 'history-chart--vertical': orientation() === 'vertical' }}>
                        <PianoRoll
                            notes={segmentedNotes()}
                            playedNotes={playedNotes()}
                            playedKeys={playedKeys()}
                            guideNotes={showGuide() ? guide?.chartNotes() : undefined}
                            guideLookaheadMs={showGuide() ? 6500 : undefined}
                            onNoteStart={playNote}
                            onNoteEnd={releaseNote}
                            viewEndTime={viewEndTime()}
                            pixelsPerSecond={pixelsPerSecond()}
                            orientation={orientation()}
                            activeMidi={state() === 'recording' ? noteDetails()?.continuousMidi : null}
                            activeNote={state() === 'recording' ? noteDetails()?.midi : null}
                            minMidiNote={Math.min(36, guide?.bounds()?.low ?? 36)}
                            maxMidiNote={Math.max(84, guide?.bounds()?.high ?? 84)}
                        />
                        <Show when={!showGuide() && segmentedNotes().length === 0 && playedNotes().length === 0}>
                            <div class="history-empty">
                                <div class="history-empty-icon"><Mic size={23} stroke-width={1.7} aria-hidden="true" /></div>
                                <strong>{emptyTitle()}</strong>
                                <Show when={emptyDetail()}><p>{emptyDetail()}</p></Show>
                            </div>
                        </Show>
                    </div>
                </section>
            </main>

            <Show when={showDebugOverlay()}>
                <DebugOverlay
                    onClose={closeSettings}
                    confidenceThreshold={confidenceThreshold}
                    pitchChangeThreshold={pitchChangeThreshold}
                    minNoteDuration={minNoteDuration}
                    maxGapForMerge={maxGapForMerge}
                    pitchDiffForMerge={pitchDiffForMerge}
                    smoothingFactor={smoothingFactor}
                    resetThreshold={resetThreshold}
                    setConfidenceThreshold={setConfidenceThreshold}
                    setPitchChangeThreshold={setPitchChangeThreshold}
                    setMinNoteDuration={setMinNoteDuration}
                    setMaxGapForMerge={setMaxGapForMerge}
                    setPitchDiffForMerge={setPitchDiffForMerge}
                    setSmoothingFactor={setSmoothingFactor}
                    setResetThreshold={setResetThreshold}
                />
            </Show>
            <Show when={showSessions() && sessionBridge}>
                {(bridge) => <SavedSessions bridge={bridge()} onClose={() => {
                    setShowSessions(false);
                    sessionsButton?.focus();
                }} />}
            </Show>
            <div id="piano-roll-tooltip" class="history-tooltip" aria-hidden="true" />
        </div>
    );
};

export default Demo;
