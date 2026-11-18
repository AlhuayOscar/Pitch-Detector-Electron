import { AudioLines, Download, ExternalLink, FolderOpen, Split } from 'lucide-solid';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import './vocal-remover.css';

type Status = 'prepared' | 'installed' | 'unavailable';
type LaunchResult = 'opened' | 'already-open' | 'unavailable' | 'error';
type LocateResult = 'selected' | 'cancelled' | 'invalid' | 'error';

declare global {
    interface Window {
        vocalRemover?: {
            status(): Promise<Status>;
            launch(): Promise<LaunchResult>;
            locate(): Promise<LocateResult>;
            openRelease(): Promise<void>;
        };
    }
}

const officialRelease = 'https://github.com/Anjok07/ultimatevocalremovergui/releases/tag/v5.6';
const statusText: Record<Status, string> = {
    prepared: 'Preparado para usar sin conexión',
    installed: 'Ultimate Vocal Remover encontrado',
    unavailable: 'Ultimate Vocal Remover requiere configuración',
};

export default function VocalRemover() {
    const bridge = window.vocalRemover;
    const [status, setStatus] = createSignal<Status>();
    const [busy, setBusy] = createSignal(false);
    const [feedback, setFeedback] = createSignal('');
    const [failed, setFailed] = createSignal(false);

    const showFeedback = (text: string, isError = false) => {
        setFeedback(text);
        setFailed(isError);
    };

    const refresh = async () => {
        if (bridge) setStatus(await bridge.status());
    };

    onMount(() => {
        void refresh().catch(() => showFeedback('No se pudo comprobar el estado de Ultimate Vocal Remover.', true));
        const onFocus = () => void refresh().catch(() => {});
        window.addEventListener('focus', onFocus);
        onCleanup(() => window.removeEventListener('focus', onFocus));
    });

    const launch = async () => {
        if (!bridge) return;
        setBusy(true);
        showFeedback('');
        try {
            const result = await bridge.launch();
            if (result === 'opened') {
                showFeedback('Ultimate Vocal Remover se está abriendo en su propia ventana.');
            } else if (result === 'already-open') {
                showFeedback('Ultimate Vocal Remover ya está abierto.');
            } else {
                if (result === 'unavailable') await refresh();
                showFeedback('No se pudo abrir Ultimate Vocal Remover. Comprobá su ubicación.', true);
            }
        } catch {
            showFeedback('No se pudo abrir Ultimate Vocal Remover.', true);
        } finally {
            setBusy(false);
        }
    };

    const locate = async () => {
        if (!bridge) return;
        setBusy(true);
        try {
            const result = await bridge.locate();
            if (result === 'selected') {
                await refresh();
                showFeedback('Ubicación guardada.');
            } else if (result === 'invalid' || result === 'error') {
                showFeedback('Elegí el ejecutable de Ultimate Vocal Remover, por ejemplo UVR.exe.', true);
            }
        } catch {
            showFeedback('No se pudo guardar la ubicación de Ultimate Vocal Remover.', true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <main class="vocal-workspace">
            <div class="vocal-card">
                <div class="vocal-mark"><Split size={36} stroke-width={1.65} aria-hidden="true" /></div>
                <h1>VocalRemover</h1>
                <p class="vocal-description">Separá la voz y el instrumental con Ultimate Vocal Remover.</p>
                <Show when={bridge} fallback={
                    <p class="vocal-status">Abrí la aplicación de escritorio para usar la integración. <a href={officialRelease} target="_blank" rel="noreferrer">Ver UVR 5.6</a></p>
                }>
                    <p class="vocal-status" role="status">
                        <AudioLines size={16} aria-hidden="true" />
                        {status() ? statusText[status()!] : 'Comprobando la instalación…'}
                    </p>
                    <div class="vocal-actions">
                        <Show when={status() && status() !== 'unavailable'}>
                            <button class="vocal-action vocal-action--primary" type="button" data-action="launch-uvr" disabled={busy()} onClick={launch}>
                                <ExternalLink size={17} aria-hidden="true" /> Abrir Ultimate Vocal Remover
                            </button>
                        </Show>
                        <button class="vocal-action" type="button" data-action="locate-uvr" disabled={busy()} onClick={locate}>
                            <FolderOpen size={17} aria-hidden="true" /> Buscar UVR instalado
                        </button>
                        <Show when={status() === 'unavailable'}>
                            <button class="vocal-action" type="button" onClick={() => void bridge?.openRelease().catch(() => showFeedback('No se pudo abrir la página oficial de descarga.', true))}>
                                <Download size={17} aria-hidden="true" /> Descargar UVR 5.6
                            </button>
                        </Show>
                    </div>
                    <Show when={feedback()}>
                        <p class="vocal-feedback" classList={{ 'vocal-feedback--error': failed() }} role={failed() ? 'alert' : 'status'}>{feedback()}</p>
                    </Show>
                </Show>
            </div>
        </main>
    );
}
