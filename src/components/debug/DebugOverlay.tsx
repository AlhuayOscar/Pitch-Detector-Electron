import { For, onMount, type Accessor, type Component, type Setter } from 'solid-js';
import { X } from 'lucide-solid';

interface DebugOverlayProps {
    onClose: () => void;
    confidenceThreshold: Accessor<number>;
    pitchChangeThreshold: Accessor<number>;
    minNoteDuration: Accessor<number>;
    maxGapForMerge: Accessor<number>;
    pitchDiffForMerge: Accessor<number>;
    smoothingFactor: Accessor<number>;
    resetThreshold: Accessor<number>;
    setConfidenceThreshold: Setter<number>;
    setPitchChangeThreshold: Setter<number>;
    setMinNoteDuration: Setter<number>;
    setMaxGapForMerge: Setter<number>;
    setPitchDiffForMerge: Setter<number>;
    setSmoothingFactor: Setter<number>;
    setResetThreshold: Setter<number>;
}

interface Setting {
    name: string;
    min: number;
    max: number;
    step: number;
    value: Accessor<number>;
    set: Setter<number>;
    unit?: string;
}

const numberFormat = new Intl.NumberFormat('es');

const DebugOverlay: Component<DebugOverlayProps> = (props) => {
    let closeButton: HTMLButtonElement;
    onMount(() => closeButton.focus());

    const groups: { title: string; settings: Setting[] }[] = [
        {
            title: 'Segmentación',
            settings: [
                { name: 'Confianza mínima', min: 0.1, max: 0.95, step: 0.01, value: props.confidenceThreshold, set: props.setConfidenceThreshold },
                { name: 'Cambio de tono mínimo', min: 0.1, max: 2, step: 0.05, value: props.pitchChangeThreshold, set: props.setPitchChangeThreshold, unit: ' semitonos' },
                { name: 'Duración mínima de nota', min: 10, max: 500, step: 10, value: props.minNoteDuration, set: props.setMinNoteDuration, unit: ' ms' },
            ],
        },
        {
            title: 'Unión de notas',
            settings: [
                { name: 'Pausa máxima entre notas', min: 0, max: 500, step: 10, value: props.maxGapForMerge, set: props.setMaxGapForMerge, unit: ' ms' },
                { name: 'Diferencia de tono máxima', min: 0.05, max: 1.5, step: 0.05, value: props.pitchDiffForMerge, set: props.setPitchDiffForMerge, unit: ' semitonos' },
            ],
        },
        {
            title: 'Suavizado',
            settings: [
                { name: 'Intensidad del suavizado', min: 0, max: 0.99, step: 0.01, value: props.smoothingFactor, set: props.setSmoothingFactor },
                { name: 'Umbral de reinicio', min: 0, max: 500, step: 5, value: props.resetThreshold, set: props.setResetThreshold, unit: ' cents' },
            ],
        },
    ];

    return (
        <section id="detection-settings" class="settings-panel" aria-labelledby="settings-title">
            <div class="settings-heading">
                <h2 id="settings-title">Ajustes de detección</h2>
                <button ref={closeButton} class="icon-button" type="button" onClick={props.onClose} aria-label="Cerrar ajustes">
                    <X size={18} aria-hidden="true" />
                </button>
            </div>
            <For each={groups}>
                {(group) => (
                    <fieldset>
                        <legend>{group.title}</legend>
                        <For each={group.settings}>
                            {(setting) => (
                                <label class="setting-slider">
                                    <span>{setting.name}</span>
                                    <output>{numberFormat.format(setting.value())}{setting.unit}</output>
                                    <input
                                        type="range"
                                        min={setting.min}
                                        max={setting.max}
                                        step={setting.step}
                                        value={setting.value()}
                                        aria-label={setting.name}
                                        aria-valuetext={numberFormat.format(setting.value()) + (setting.unit ?? '')}
                                        onInput={(event) => setting.set(event.currentTarget.valueAsNumber)}
                                    />
                                </label>
                            )}
                        </For>
                    </fieldset>
                )}
            </For>
        </section>
    );
};

export default DebugOverlay;
