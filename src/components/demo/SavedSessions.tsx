import { FolderOpen, Play, X } from 'lucide-solid';
import { createSignal, For, onMount, Show } from 'solid-js';
import type { SavedSession, SessionBridge } from '../../libs/session-bridge';

const dateFormat = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' });

interface Props {
    bridge: SessionBridge;
    onClose: () => void;
}

export default function SavedSessions(props: Props) {
    let dialog!: HTMLDialogElement;
    const [items, setItems] = createSignal<SavedSession[]>();
    const [error, setError] = createSignal('');

    onMount(() => {
        dialog.showModal();
        void props.bridge.list().then(setItems).catch(() => setError('No se pudieron leer las sesiones.'));
    });

    const openLocal = async (action: () => Promise<string>) => {
        setError('');
        try {
            if (await action()) setError('No se pudo abrir el archivo o la carpeta.');
        } catch {
            setError('No se pudo abrir el archivo o la carpeta.');
        }
    };

    return (
        <dialog ref={dialog} class="sessions-dialog" aria-labelledby="sessions-title" onCancel={(event) => {
            event.preventDefault();
            props.onClose();
        }}>
            <div class="sessions-heading">
                <h2 id="sessions-title">Sesiones guardadas</h2>
                <button type="button" class="icon-button" aria-label="Cerrar sesiones" onClick={props.onClose}>
                    <X size={18} aria-hidden="true" />
                </button>
            </div>
            <Show when={items()} fallback={<p class="sessions-empty">Cargando sesiones…</p>}>
                {(sessions) => (
                    <Show when={sessions().length} fallback={<p class="sessions-empty">Las sesiones de Pitch aparecerán acá.</p>}>
                        <ul class="sessions-list">
                            <For each={sessions()}>{session => (
                                <li>
                                    <div>
                                        <strong>{dateFormat.format(new Date(session.startedAt))}</strong>
                                        <span>{session.finished ? 'Guardada' : 'Guardado parcial'} · {dateFormat.format(new Date(session.savedAt))}</span>
                                    </div>
                                    <Show when={session.hasAudio}>
                                        <button type="button" class="icon-button" aria-label="Reproducir sesión" title="Reproducir sesión" onClick={() => void openLocal(() => props.bridge.play(session.id))}>
                                            <Play size={17} aria-hidden="true" />
                                        </button>
                                    </Show>
                                </li>
                            )}</For>
                        </ul>
                    </Show>
                )}
            </Show>
            <Show when={error()}><p class="sessions-error" role="alert">{error()}</p></Show>
            <button type="button" class="rotate-button" onClick={() => void openLocal(() => props.bridge.showFolder())}>
                <FolderOpen size={16} aria-hidden="true" /> Abrir carpeta
            </button>
        </dialog>
    );
}
