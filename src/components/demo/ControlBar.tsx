import { Component, Show } from 'solid-js';
import { CircleAlert, LoaderCircle, Mic, Pause } from 'lucide-solid';
import type { NoteDetails } from '../../utils/midiUtils';
import TuningMeter from './TuningMeter';

export type DetectionState = 'idle' | 'starting' | 'recording' | 'pausing' | 'paused' | 'error';

interface ControlBarProps {
    pitch: number | null;
    confidence: number;
    noteDetails: NoteDetails | null;
    state: DetectionState;
    error: string | null;
    onToggle: () => void;
}

const frequencyFormat = new Intl.NumberFormat('es', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
});
const confidenceFormat = new Intl.NumberFormat('es', { style: 'percent' });

const statusLabels: Record<DetectionState, string> = {
    idle: 'Micrófono apagado',
    starting: 'Preparando el micrófono',
    recording: 'Escuchando',
    pausing: 'Pausando',
    paused: 'En pausa',
    error: 'Detección interrumpida',
};

const actionLabels: Record<DetectionState, string> = {
    idle: 'Iniciar detección',
    starting: 'Preparando…',
    recording: 'Pausar detección',
    pausing: 'Pausando…',
    paused: 'Reanudar detección',
    error: 'Reintentar',
};

const ControlBar: Component<ControlBarProps> = (props) => {
    const busy = () => props.state === 'starting' || props.state === 'pausing';

    return (
        <aside class="monitor" aria-labelledby="monitor-title">
            <div class="monitor-reading">
                <h2 id="monitor-title" class="section-label">Nota detectada</h2>
                <div class="note-value" classList={{ 'has-note': !!props.noteDetails }} data-testid="detected-note">
                    {props.noteDetails?.name.replace('#', '♯') ?? '—'}
                </div>
                <div class="note-metrics">
                    <div>
                        <span class="metric-label">Frecuencia</span>
                        <span class="metric-value" data-testid="detected-frequency">
                            {props.pitch === null ? '—' : `${frequencyFormat.format(props.pitch)} Hz`}
                        </span>
                    </div>
                    <div>
                        <span class="metric-label">Confianza</span>
                        <span class="metric-value" data-testid="detected-confidence">
                            {props.confidence > 0 ? confidenceFormat.format(props.confidence) : '—'}
                        </span>
                    </div>
                </div>
            </div>

            <TuningMeter noteDetails={props.noteDetails} />

            <div class="monitor-actions">
                <div class="capture-status" data-state={props.state} role="status">
                    <span class="status-dot" aria-hidden="true" />
                    <span>{statusLabels[props.state]}</span>
                </div>
                <Show when={props.error}>
                    {(message) => (
                        <p class="monitor-error" role="alert">
                            <CircleAlert size={17} aria-hidden="true" />
                            <span>{message()}</span>
                        </p>
                    )}
                </Show>
                <button
                    class="capture-button"
                    classList={{ 'capture-button--pause': props.state === 'recording' }}
                    type="button"
                    data-testid="detection-action"
                    disabled={busy()}
                    aria-keyshortcuts="Space"
                    onClick={props.onToggle}
                >
                    <Show when={!busy()} fallback={<LoaderCircle class="spinner" size={19} aria-hidden="true" />}>
                        <Show when={props.state === 'recording'} fallback={<Mic size={19} aria-hidden="true" />}>
                            <Pause size={19} aria-hidden="true" />
                        </Show>
                    </Show>
                    {actionLabels[props.state]}
                </button>
                <div class="keyboard-hint"><kbd>Espacio</kbd> para iniciar o pausar</div>
            </div>
        </aside>
    );
};

export default ControlBar;
