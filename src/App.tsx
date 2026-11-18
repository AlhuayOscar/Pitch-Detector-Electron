import { ArrowLeft } from 'lucide-solid';
import { batch, createSignal, Match, onMount, Show, Switch, type Component } from 'solid-js';
import Launcher, { type LauncherTool } from './components/launcher/Launcher';
import Demo from './pages/Demo';
import VocalRemover from './pages/VocalRemover';

const ReturnToLauncher: Component<{ onHome: () => void }> = (props) => {
  let button!: HTMLButtonElement;
  onMount(() => {
    window.scrollTo(0, 0);
    button.focus({ preventScroll: true });
  });

  return (
    <nav class="tool-toolbar" aria-label="Navegación">
      <button ref={button} type="button" class="tool-back" data-action="home" onClick={props.onHome}>
        <ArrowLeft size={17} aria-hidden="true" />
        Volver al inicio
      </button>
    </nav>
  );
};

const App: Component = () => {
  const [tool, setTool] = createSignal<LauncherTool | null>(null);
  const [returnTarget, setReturnTarget] = createSignal<LauncherTool | null>(null);

  const goHome = () => batch(() => {
    setReturnTarget(tool());
    setTool(null);
  });

  return (
    <Show when={tool()} fallback={<Launcher onOpen={setTool} focusTool={returnTarget()} />}>
      <div class="tool-stage" data-view={tool()}>
        <ReturnToLauncher onHome={goHome} />
        <Switch>
          <Match when={tool() === 'pitch'}><Demo /></Match>
          <Match when={tool() === 'vocal-remover'}><VocalRemover /></Match>
        </Switch>
      </div>
    </Show>
  );
};

export default App;
