import { AudioLines, FileAudio, FolderOpen, Play, RefreshCw, Split, Square, WandSparkles } from 'lucide-solid';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import './vocal-remover.css';

interface Selection {
    name: string;
}

interface Separation {
    token: string;
    vocalsName: string;
    instrumentalName: string;
}

interface Progress {
    percent: number;
    message: string;
}

type RuntimeStatus = 'prepared' | 'unavailable';

declare global {
    interface Window {
        vocalRemover?: {
            status(): Promise<RuntimeStatus>;
            chooseInput(): Promise<Selection | null>;
            chooseOutput(): Promise<Selection | null>;
            separate(): Promise<Separation | null>;
            cancel(): Promise<void>;
            openOutput(): Promise<string>;
            onProgress(listener: (update: Progress) => void): () => void;
        };
    }
}

function localError(error: unknown, fallback: string) {
    if (!(error instanceof Error)) return fallback;
    return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') || fallback;
}

export default function VocalRemover(props: { onPractice?: (token: string) => void }) {
    const bridge = window.vocalRemover;
    const [status, setStatus] = createSignal<RuntimeStatus>();
    const [input, setInput] = createSignal<Selection>();
    const [output, setOutput] = createSignal<Selection>();
    const [operation, setOperation] = createSignal<'input' | 'output' | 'separate'>();
    const [progress, setProgress] = createSignal<Progress>({ percent: 0, message: 'Preparando la separación…' });
    const [separation, setSeparation] = createSignal<Separation>();
    const [feedback, setFeedback] = createSignal('');
    const [error, setError] = createSignal('');
    const [cancelling, setCancelling] = createSignal(false);

    const refresh = async () => {
        if (!bridge) return;
        try {
            setStatus(await bridge.status());
        } catch (cause) {
            setStatus('unavailable');
            setError(localError(cause, 'No se pudo comprobar el motor local de VocalRemover.'));
        }
    };

    onMount(() => {
        if (!bridge) return;
        void refresh();
        const unsubscribe = bridge.onProgress(setProgress);
        onCleanup(() => {
            unsubscribe();
            if (operation() === 'separate') void bridge.cancel().catch(() => {});
        });
    });

    const choose = async (kind: 'input' | 'output') => {
        if (!bridge || operation()) return;
        setOperation(kind);
        setError('');
        setFeedback('');
        try {
            const selection = await (kind === 'input' ? bridge.chooseInput() : bridge.chooseOutput());
            if (selection) {
                if (kind === 'input') setInput(selection);
                else setOutput(selection);
                setSeparation(undefined);
            }
        } catch (cause) {
            setError(localError(cause, 'No se pudo seleccionar la ubicación.'));
        } finally {
            setOperation(undefined);
        }
    };

    const separate = async () => {
        if (!bridge || !input() || !output() || operation()) return;
        setOperation('separate');
        setProgress({ percent: 0, message: 'Preparando la separación…' });
        setSeparation(undefined);
        setError('');
        setFeedback('');
        try {
            const result = await bridge.separate();
            if (result) setSeparation(result);
            else setFeedback('Separación cancelada.');
        } catch (cause) {
            setError(localError(cause, 'No se pudo completar la separación.'));
        } finally {
            setCancelling(false);
            setOperation(undefined);
        }
    };

    const cancel = async () => {
        if (!bridge || cancelling()) return;
        setCancelling(true);
        try {
            await bridge.cancel();
        } catch (cause) {
            setCancelling(false);
            setError(localError(cause, 'No se pudo cancelar la separación.'));
        }
    };

    const openOutput = async () => {
        if (!bridge) return;
        try {
            const failure = await bridge.openOutput();
            if (failure) setError('No se pudo abrir la carpeta de las pistas guardadas.');
        } catch (cause) {
            setError(localError(cause, 'No se pudo abrir la carpeta.'));
        }
    };

    return (
        <main class="vocal-workspace">
            <section class="vocal-card" aria-labelledby="vocal-heading">
                <div class="vocal-mark"><Split size={34} stroke-width={1.65} aria-hidden="true" /></div>
                <h1 id="vocal-heading">VocalRemover</h1>
                <p class="vocal-description">Separá la voz y el instrumental de un audio o un video en este equipo.</p>
                <Show when={bridge} fallback={<p class="vocal-status">Disponible en la aplicación de escritorio.</p>}>
                    <p class="vocal-status" role="status">
                        <AudioLines size={16} aria-hidden="true" />
                        {status() === 'prepared' ? 'UVR 5.6 listo para usar sin conexión' :
                            status() === 'unavailable' ? 'El motor local necesita preparación' : 'Comprobando el motor local…'}
                    </p>
                    <Show when={status() === 'unavailable'}>
                        <div class="vocal-setup">
                            <p>El repositorio incluye el script <code>scripts/prepare-uvr.ps1</code> para preparar UVR y su modelo. Una vez listo, volvé a comprobar el motor.</p>
                            <button class="vocal-action" type="button" onClick={() => void refresh()}>
                                <RefreshCw size={16} aria-hidden="true" /> Comprobar de nuevo
                            </button>
                        </div>
                    </Show>
                    <Show when={status() === 'prepared'}>
                        <div class="vocal-fields">
                            <div class="vocal-field">
                                <div><span>Audio o video</span><strong title={input()?.name}>{input()?.name ?? 'Sin archivo seleccionado'}</strong></div>
                                <button class="vocal-action" type="button" data-action="uvr-choose-input" disabled={!!operation()} onClick={() => void choose('input')}>
                                    <FileAudio size={16} aria-hidden="true" /> Elegir archivo
                                </button>
                            </div>
                            <div class="vocal-field">
                                <div><span>Carpeta de salida</span><strong title={output()?.name}>{output()?.name ?? 'Sin carpeta seleccionada'}</strong></div>
                                <button class="vocal-action" type="button" data-action="uvr-choose-output" disabled={!!operation()} onClick={() => void choose('output')}>
                                    <FolderOpen size={16} aria-hidden="true" /> Elegir carpeta
                                </button>
                            </div>
                        </div>
                        <div class="vocal-actions">
                            <button class="vocal-action vocal-action--primary" type="button" data-action="uvr-separate"
                                disabled={!input() || !output() || !!operation()} onClick={() => void separate()}>
                                <WandSparkles size={17} aria-hidden="true" /> Separar pistas
                            </button>
                            <Show when={operation() === 'separate'}>
                                <button class="vocal-action" type="button" disabled={cancelling()} data-action="uvr-cancel" onClick={() => void cancel()}>
                                    <Square size={14} aria-hidden="true" /> {cancelling() ? 'Cancelando…' : 'Cancelar'}
                                </button>
                            </Show>
                        </div>
                        <Show when={operation() === 'separate'}>
                            <div class="vocal-progress">
                                <div><span>{progress().message}</span><span>{progress().percent} %</span></div>
                                <progress aria-label="Separando pistas" max="100" value={progress().percent} />
                            </div>
                        </Show>
                        <Show when={separation()}>
                            {(result) => (
                                <div class="vocal-result" data-testid="uvr-result">
                                    <h2>Pistas guardadas</h2>
                                    <ul>
                                        <li><span>Voces</span><strong>{result().vocalsName}</strong></li>
                                        <li><span>Instrumental</span><strong>{result().instrumentalName}</strong></li>
                                    </ul>
                                    <div class="vocal-actions">
                                        <Show when={props.onPractice}>
                                            <button class="vocal-action vocal-action--primary" type="button" data-action="uvr-practice"
                                                disabled={!!operation()} onClick={() => props.onPractice?.(result().token)}>
                                                <Play size={16} aria-hidden="true" /> Practicar con la voz
                                            </button>
                                        </Show>
                                        <button class="vocal-action" type="button" data-action="uvr-open-output" onClick={() => void openOutput()}>
                                            <FolderOpen size={16} aria-hidden="true" /> Abrir carpeta
                                        </button>
                                    </div>
                                </div>
                            )}
                        </Show>
                    </Show>
                    <Show when={feedback()}><p class="vocal-feedback" role="status">{feedback()}</p></Show>
                    <Show when={error()}><p class="vocal-feedback vocal-feedback--error" role="alert">{error()}</p></Show>
                </Show>
            </section>
        </main>
    );
}
