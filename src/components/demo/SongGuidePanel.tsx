import { AudioLines, FileAudio, LoaderCircle, Pause, Play, Square } from 'lucide-solid';
import { For, Show, type Component } from 'solid-js';
import type { SongGuide } from '../../libs/song-guide';
import { midiToNoteName } from '../../utils/midiUtils';
import './song-guide.css';

const shifts = Array.from({ length: 13 }, (_, index) => -index);

function formatTime(milliseconds: number) {
    const total = Math.floor(milliseconds / 1000);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

const SongGuidePanel: Component<{ guide: SongGuide; liveMidi: number | null | undefined }> = (props) => {
    const cents = () => {
        const target = props.guide.target();
        const live = props.liveMidi;
        return target !== null && live != null ? Math.round((live - target) * 100) : null;
    };

    return (
        <details class="song-guide">
            <summary>
                <AudioLines size={16} aria-hidden="true" />
                Guía de canción
                <Show when={props.guide.name()}><span class="guide-file-name">{props.guide.name()}</span></Show>
                <Show when={props.guide.playing()}><span class="guide-playing">Reproduciendo</span></Show>
            </summary>
            <div class="song-guide-content">
                <div class="guide-controls">
                    <button type="button" class="rotate-button" data-action="select-guide"
                        disabled={!!props.guide.busy()} onClick={() => void props.guide.choose()}>
                        <FileAudio size={16} aria-hidden="true" /> Cargar audio o video
                    </button>
                    <Show when={props.guide.duration() > 0}>
                        <button type="button" class="rotate-button guide-play" data-action="play-guide"
                            aria-pressed={props.guide.playing()} disabled={!!props.guide.busy()} onClick={() => void props.guide.toggle()}>
                            <Show when={props.guide.playing()} fallback={<Play size={16} aria-hidden="true" />}>
                                <Pause size={16} aria-hidden="true" />
                            </Show>
                            {props.guide.playing() ? 'Pausar guía' : 'Reproducir guía'}
                        </button>
                        <label class="instrument-choice">
                            Transposición
                            <select data-testid="guide-shift" value={props.guide.semitones()} disabled={!!props.guide.busy()} onChange={(event) => {
                                const control = event.currentTarget;
                                void props.guide.transpose(Number(control.value)).then(() => {
                                    control.value = String(props.guide.semitones());
                                });
                            }}>
                                <For each={shifts}>{shift => <option value={shift}>{shift === 0 ? 'Original' : String(shift) + ' semitonos'}</option>}</For>
                            </select>
                        </label>
                    </Show>
                    <Show when={props.guide.busy()}>
                        <p class="guide-progress" role="status">
                            <LoaderCircle size={15} class="spinner" aria-hidden="true" /> {props.guide.busy()}
                        </p>
                        <button type="button" class="icon-button" title="Cancelar análisis" aria-label="Cancelar análisis" onClick={props.guide.cancel}>
                            <Square size={15} aria-hidden="true" />
                        </button>
                    </Show>
                </div>
                <Show when={props.guide.duration() > 0}>
                    <div class="guide-scrub">
                        <input type="range" aria-label="Posición de la canción" min={0} max={props.guide.duration()}
                            step={100} value={Math.min(props.guide.duration(), props.guide.position())}
                            disabled={!!props.guide.busy()} onInput={(event) => props.guide.seek(Number(event.currentTarget.value))} />
                        <span>{formatTime(props.guide.position())} / {formatTime(props.guide.duration())}</span>
                    </div>
                    <p class="guide-readings">
                        <Show when={props.guide.range()}>
                            <span>Rango de la guía <strong data-testid="guide-range">{props.guide.range()}</strong></span>
                        </Show>
                        <Show when={props.guide.target() !== null}>
                            <span>Nota objetivo <strong data-testid="guide-target">{midiToNoteName(props.guide.target())}</strong></span>
                        </Show>
                        <Show when={cents() !== null}>
                            <span classList={{ 'guide-match': Math.abs(cents()!) <= 35 }}>
                                {Math.abs(cents()!) <= 35 ? 'Coincide' : (cents()! > 0 ? '+' : '') + cents() + ' cents'}
                            </span>
                        </Show>
                    </p>
                </Show>
                <Show when={props.guide.error()}><p class="guide-error" role="alert">{props.guide.error()}</p></Show>
            </div>
        </details>
    );
};

export default SongGuidePanel;
