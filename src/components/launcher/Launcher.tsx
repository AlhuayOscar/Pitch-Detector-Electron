import { ArrowUpRight, AudioLines, Construction, Split } from 'lucide-solid';
import { onMount, type Component } from 'solid-js';
import './launcher.css';

export type LauncherTool = 'pitch' | 'vocal-remover';

interface LauncherProps {
    onOpen: (tool: LauncherTool) => void;
    focusTool: LauncherTool | null;
}

const Launcher: Component<LauncherProps> = (props) => {
    let pitchButton!: HTMLButtonElement;
    let vocalRemoverButton!: HTMLButtonElement;

    onMount(() => {
        if (props.focusTool === 'pitch') pitchButton.focus({ preventScroll: true });
        if (props.focusTool === 'vocal-remover') vocalRemoverButton.focus({ preventScroll: true });
    });

    return (
        <main class="launcher" data-view="home" aria-labelledby="launcher-title">
            <header class="launcher-heading">
                <h1 id="launcher-title">Pitch Detector Electron</h1>
            </header>
            <div class="launcher-grid">
                <button
                    class="launcher-tile launcher-tile-pitch"
                    ref={pitchButton}
                    type="button"
                    data-tool="pitch"
                    aria-labelledby="launcher-pitch-name"
                    aria-describedby="launcher-pitch-description"
                    onClick={() => props.onOpen('pitch')}
                >
                    <span class="launcher-mark"><AudioLines size={34} stroke-width={1.75} aria-hidden="true" /></span>
                    <span class="launcher-copy">
                        <span id="launcher-pitch-name" class="launcher-tile-name">Pitch</span>
                        <span id="launcher-pitch-description" class="launcher-tile-detail">Detección de notas y afinación</span>
                    </span>
                    <ArrowUpRight class="launcher-open-mark" size={18} stroke-width={1.75} aria-hidden="true" />
                </button>

                <button
                    class="launcher-tile launcher-tile-vocals"
                    ref={vocalRemoverButton}
                    type="button"
                    data-tool="vocal-remover"
                    aria-labelledby="launcher-vocals-name"
                    aria-describedby="launcher-vocals-description"
                    onClick={() => props.onOpen('vocal-remover')}
                >
                    <span class="launcher-mark"><Split size={34} stroke-width={1.75} aria-hidden="true" /></span>
                    <span class="launcher-copy">
                        <span id="launcher-vocals-name" class="launcher-tile-name">VocalRemover</span>
                        <span id="launcher-vocals-description" class="launcher-tile-detail">Separación de voz e instrumental</span>
                    </span>
                    <ArrowUpRight class="launcher-open-mark" size={18} stroke-width={1.75} aria-hidden="true" />
                </button>

                <button
                    class="launcher-tile launcher-tile-wip"
                    type="button"
                    data-tool="wip"
                    aria-labelledby="launcher-wip-name"
                    aria-describedby="launcher-wip-description"
                    disabled
                >
                    <span class="launcher-mark"><Construction size={32} stroke-width={1.65} aria-hidden="true" /></span>
                    <span class="launcher-copy">
                        <span id="launcher-wip-name" class="launcher-tile-name">WIP</span>
                        <span id="launcher-wip-description" class="launcher-tile-detail">En desarrollo</span>
                    </span>
                </button>
            </div>
        </main>
    );
};

export default Launcher;
