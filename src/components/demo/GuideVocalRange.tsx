import { batch, createMemo, createSignal, For, Show, type Component } from 'solid-js';
import type { SongGuide } from '../../libs/song-guide';
import { fitGuideToVocalRange, parseObservedRange } from '../../libs/vocal-range-fit';
import { midiToNoteName } from '../../utils/midiUtils';
import './guide-vocal-range.css';

const midiOptions = Array.from({ length: 128 }, (_, midi) => midi);
const percentage = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 1 });

interface Props {
    guide: SongGuide;
    observedRange?: string;
}

const displayNote = (midi: number) => midiToNoteName(midi).replace('#', '♯');

function displayShift(shift: number) {
    if (shift === 0) return 'Tonalidad original';
    return (shift > 0 ? '+' : '−') + Math.abs(shift) + (Math.abs(shift) === 1 ? ' semitono' : ' semitonos');
}

const GuideVocalRange: Component<Props> = (props) => {
    const [low, setLow] = createSignal<number>();
    const [high, setHigh] = createSignal<number>();
    const observed = createMemo(() => parseObservedRange(props.observedRange));
    const hasRange = () => low() !== undefined && high() !== undefined;
    const invalidRange = () => hasRange() && low()! > high()!;
    const suggestion = createMemo(() => hasRange() && !invalidRange()
        ? fitGuideToVocalRange(props.guide.notes(), { low: low()!, high: high()! })
        : null);

    const useObserved = () => {
        const range = observed();
        if (range) batch(() => {
            setLow(range.low);
            setHigh(range.high);
        });
    };

    return (
        <Show when={props.guide.duration() > 0 && props.guide.notes().length > 0}>
            <details class="guide-vocal-range">
                <summary>Ajustar a mi rango</summary>
                <div class="guide-range-content">
                    <p class="guide-range-hint">Elegí la nota más grave y la más aguda que te resulten cómodas.</p>
                    <div class="guide-range-controls">
                        <label>
                            Nota grave
                            <select value={low() ?? ''} data-testid="guide-range-low" aria-invalid={invalidRange() ? 'true' : undefined}
                                onChange={(event) => setLow(event.currentTarget.value ? Number(event.currentTarget.value) : undefined)}>
                                <option value="">Elegir</option>
                                <For each={midiOptions}>{midi => <option value={midi}>{displayNote(midi)}</option>}</For>
                            </select>
                        </label>
                        <label>
                            Nota aguda
                            <select value={high() ?? ''} data-testid="guide-range-high" aria-invalid={invalidRange() ? 'true' : undefined}
                                onChange={(event) => setHigh(event.currentTarget.value ? Number(event.currentTarget.value) : undefined)}>
                                <option value="">Elegir</option>
                                <For each={midiOptions}>{midi => <option value={midi}>{displayNote(midi)}</option>}</For>
                            </select>
                        </label>
                        <Show when={observed()}>
                            <button type="button" class="rotate-button guide-range-observed" onClick={useObserved}>
                                Usar rango detectado
                            </button>
                        </Show>
                    </div>
                    <Show when={invalidRange()}>
                        <p class="guide-range-warning" role="alert">La nota grave debe ser igual o inferior a la nota aguda.</p>
                    </Show>
                    <Show when={suggestion()}>
                        {(fit) => (
                            <div class="guide-range-suggestion">
                                <div role="status" data-testid="guide-range-recommendation">
                                    <strong>{displayShift(fit().shift)}</strong>
                                    <span> · {displayNote(fit().low)} – {displayNote(fit().high)}</span>
                                    <p classList={{ 'guide-range-warning': !!fit().outsideNotes }}>
                                        {fit().outsideNotes ? percentage.format(Math.min(0.999, fit().coverage)) +
                                            ' de la duración de las notas queda dentro del rango. ' +
                                            (fit().outsideNotes === 1 ? 'Queda 1 nota fuera.' : 'Quedan ' + fit().outsideNotes + ' notas fuera.') :
                                            'Todas las notas quedan dentro del rango elegido.'}
                                    </p>
                                </div>
                                <Show when={fit().shift !== props.guide.semitones()} fallback={<span class="guide-range-applied">Ya aplicada</span>}>
                                    <button type="button" class="rotate-button guide-range-apply" data-action="apply-vocal-range"
                                        disabled={!!props.guide.busy()} onClick={() => void props.guide.transpose(fit().shift)}>
                                        Aplicar transposición
                                    </button>
                                </Show>
                            </div>
                        )}
                    </Show>
                </div>
            </details>
        </Show>
    );
};

export default GuideVocalRange;
