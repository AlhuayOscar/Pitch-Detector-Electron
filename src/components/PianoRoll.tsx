import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
import * as d3 from 'd3';
import type { MidiSegment } from '../pages/Demo';
import { midiToNoteName } from '../utils/midiUtils';

interface PianoRollProps {
    notes: MidiSegment[];
    playedNotes?: MidiSegment[];
    guideNotes?: MidiSegment[];
    guideLookaheadMs?: number;
    playedKeys?: ReadonlySet<number>;
    onNoteStart?: (midi: number) => void;
    onNoteEnd?: (midi: number) => void;
    viewEndTime: number;
    pixelsPerSecond: number;
    orientation?: 'horizontal' | 'vertical';
    activeMidi?: number | null;
    activeNote?: number | null;
    minMidiNote?: number;
    maxMidiNote?: number;
}

interface PitchedSegment extends MidiSegment {
    avgContinuousMidi: number;
}

export const PIANO_KEYBOARD_WIDTH = 58;
export const VERTICAL_PIANO_KEYBOARD_HEIGHT = 58;
const TIME_AXIS_HEIGHT = 30;
const VERTICAL_TIME_AXIS_WIDTH = 42;
const blackKeys = new Set([1, 3, 6, 8, 10]);
const timeFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const durationFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
const tuningColor = d3.scaleLinear<string>()
    .domain([0, 5, 20, 40, 50])
    .range(['#67e8cb', '#67e8cb', '#e3d780', '#f2ab72', '#f49396'])
    .clamp(true);

const PianoRoll: Component<PianoRollProps> = (props) => {
    let svgRef!: SVGSVGElement;
    let notesRef!: SVGGElement;
    let instrumentNotesRef!: SVGGElement;
    let guideNotesRef!: SVGGElement;
    let tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, unknown> | undefined;
    const [size, setSize] = createSignal({ width: 0, height: 0 });
    const [focusMidi, setFocusMidi] = createSignal<number>();
    const heldInputs = new Map<number | string, number>();
    const clickTimers = new Map<string, number>();
    const playable = () => props.onNoteStart !== undefined && props.onNoteEnd !== undefined;
    const vertical = () => props.orientation === 'vertical';
    const minMidi = () => props.minMidiNote ?? 36;
    const maxMidi = () => props.maxMidiNote ?? 84;
    const midiRange = createMemo(() => d3.range(minMidi(), maxMidi() + 1));
    const accidentals = createMemo(() => midiRange().filter(note => blackKeys.has(note % 12)));
    const chartLeft = () => vertical() ? VERTICAL_TIME_AXIS_WIDTH : PIANO_KEYBOARD_WIDTH;
    const chartHeight = () => Math.max(0, size().height - (vertical() ? VERTICAL_PIANO_KEYBOARD_HEIGHT : TIME_AXIS_HEIGHT));
    const chartWidth = () => Math.max(0, size().width - chartLeft());
    const timeExtent = () => vertical() ? chartHeight() : chartWidth();
    const pitchExtent = () => vertical() ? chartWidth() : chartHeight();
    const laneSize = () => pitchExtent() / midiRange().length;
    const laneFill = () => Math.max(0, laneSize() - 1);
    const pitchScale = createMemo(() => d3.scaleLinear()
        .domain([minMidi() - 0.5, maxMidi() + 0.5])
        .range(vertical() ? [0, chartWidth()] : [chartHeight(), 0]));
    const laneStart = (midi: number) => pitchScale()(midi + (vertical() ? -0.5 : 0.5));
    const viewSeconds = () => Math.max(1, timeExtent() / props.pixelsPerSecond);
    const guideLookahead = () => props.guideLookaheadMs ?? 0;
    const guideEnabled = () => Number.isFinite(guideLookahead()) && guideLookahead() > 0;
    const futureSeconds = () => guideEnabled() ? Math.min(viewSeconds() / 4, guideLookahead() / 1000) : 0;
    const pastSeconds = () => viewSeconds() - futureSeconds();
    const viewStart = () => props.viewEndTime - 1000 * pastSeconds();
    const guideViewEnd = () => props.viewEndTime + 1000 * futureSeconds();
    const timeScale = createMemo(() => d3.scaleLinear()
        .domain([-futureSeconds(), pastSeconds()])
        .range([0, timeExtent()])
        .clamp(true));
    const nowPosition = () => timeScale()(0);
    const timeTicks = createMemo(() => timeScale()
        .ticks(Math.max(2, Math.floor(timeExtent() / (vertical() ? 78 : 105))))
        .filter(seconds => {
            const position = timeScale()(seconds);
            const minimumGap = vertical() ? 26 : 48;
            return seconds !== 0 &&
                position >= (guideEnabled() ? 25 : vertical() ? 36 : 60) &&
                position <= timeExtent() - 25 &&
                Math.abs(position - nowPosition()) >= minimumGap;
        }));
    const visibleNotes = (notes: MidiSegment[], latest = props.viewEndTime) => notes.filter((note): note is PitchedSegment =>
        note.avgContinuousMidi !== null &&
        Math.round(note.avgContinuousMidi) >= minMidi() &&
        Math.round(note.avgContinuousMidi) <= maxMidi() &&
        note.endTime >= viewStart() &&
        note.startTime <= latest);
    const notesInView = createMemo(() => visibleNotes(props.notes));
    const instrumentNotesInView = createMemo(() => visibleNotes(props.playedNotes ?? []));
    const guideNotesInView = createMemo(() =>
        guideEnabled() ? visibleNotes(props.guideNotes ?? [], guideViewEnd()) : []);
    const tickLabel = (seconds: number) =>
        `${seconds < 0 ? '+' : '−'}${timeFormat.format(Math.abs(seconds))} s`;

    function beginKey(input: number | string, midi: number) {
        if (!playable() || heldInputs.has(input)) return;
        const alreadyHeld = Array.from(heldInputs.values()).includes(midi);
        heldInputs.set(input, midi);
        if (!alreadyHeld) props.onNoteStart?.(midi);
    }

    function endKey(input: number | string) {
        const midi = heldInputs.get(input);
        if (midi === undefined) return;
        heldInputs.delete(input);
        if (!Array.from(heldInputs.values()).includes(midi)) props.onNoteEnd?.(midi);
    }

    function releaseKeys() {
        const notes = new Set(heldInputs.values());
        heldInputs.clear();
        for (const timer of clickTimers.values()) window.clearTimeout(timer);
        clickTimers.clear();
        for (const midi of notes) props.onNoteEnd?.(midi);
    }

    const activationKey = (key: string) => key === ' ' || key === 'Enter';
    const keyboardInput = (midi: number, key: string) => `keyboard:${midi}:${key}`;

    function handleKeyDown(event: KeyboardEvent, midi: number) {
        if (!playable() || event.ctrlKey || event.altKey || event.metaKey) return;
        if (activationKey(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) beginKey(keyboardInput(midi, event.key), midi);
            return;
        }

        let next: number;
        switch (event.key) {
            case 'ArrowUp':
            case 'ArrowRight':
                next = midi + 1;
                break;
            case 'ArrowDown':
            case 'ArrowLeft':
                next = midi - 1;
                break;
            case 'Home':
                next = minMidi();
                break;
            case 'End':
                next = maxMidi();
                break;
            default:
                return;
        }
        event.preventDefault();
        event.stopPropagation();
        const target = Math.min(maxMidi(), Math.max(minMidi(), next));
        svgRef.querySelector<SVGRectElement>(`rect.key[data-midi="${target}"]`)?.focus({ preventScroll: true });
    }

    function handleKeyUp(event: KeyboardEvent, midi: number) {
        if (!playable() || !activationKey(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        endKey(keyboardInput(midi, event.key));
    }

    function handlePointerDown(event: PointerEvent & { currentTarget: SVGRectElement }, midi: number) {
        if (!playable() || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        beginKey(event.pointerId, midi);
    }

    function handleAccessibleClick(event: MouseEvent, midi: number) {
        // Assistive technology can activate an SVG button without a pointer or key event.
        if (!playable() || event.detail !== 0) return;
        const input = `click:${midi}`;
        window.clearTimeout(clickTimers.get(input));
        beginKey(input, midi);
        clickTimers.set(input, window.setTimeout(() => {
            clickTimers.delete(input);
            endKey(input);
        }, 160));
    }

    function laneRect(midi: number) {
        const start = laneStart(midi);
        return vertical()
            ? { x: start, y: 0, width: laneSize(), height: chartHeight() }
            : { x: 0, y: start, width: chartWidth(), height: laneSize() };
    }

    function pitchLine(midi: number) {
        const start = laneStart(midi);
        return vertical()
            ? { x1: start, x2: start, y1: 0, y2: chartHeight() }
            : { x1: 0, x2: chartWidth(), y1: start, y2: start };
    }

    function timelineLine(seconds: number) {
        const age = timeScale()(seconds);
        return vertical()
            ? { x1: 0, x2: chartWidth(), y1: chartHeight() - age, y2: chartHeight() - age }
            : { x1: age, x2: age, y1: 0, y2: chartHeight() };
    }

    function futureRect() {
        const position = nowPosition();
        return vertical()
            ? { x: 0, y: chartHeight() - position, width: chartWidth(), height: position }
            : { x: 0, y: 0, width: position, height: chartHeight() };
    }

    function noteRect(midi: number, age: number, length: number) {
        return vertical()
            ? { x: laneStart(midi), y: chartHeight() - age - length, width: laneFill(), height: length }
            : { x: age, y: laneStart(midi), width: length, height: laneFill() };
    }

    function segmentRect(note: PitchedSegment) {
        const extent = timeExtent();
        const minimum = Math.min(1, extent);
        const ageOf = (timestamp: number) => timeScale()((props.viewEndTime - timestamp) / 1000);
        const age = Math.min(ageOf(note.endTime), extent - minimum);
        const length = Math.max(minimum, ageOf(note.startTime) - age);
        return noteRect(Math.round(note.avgContinuousMidi), age, length);
    }

    function instrumentRect(note: PitchedSegment) {
        const box = segmentRect(note);
        if (vertical()) {
            const width = Math.min(box.width, Math.max(1.5, box.width * 0.32));
            return { ...box, x: box.x + box.width - width, width };
        }
        const height = Math.min(box.height, Math.max(1.5, box.height * 0.32));
        return { ...box, y: box.y + box.height - height, height };
    }

    function keyRect(midi: number) {
        return vertical()
            ? { x: laneStart(midi), y: 0, width: laneFill(), height: blackKeys.has(midi % 12) ? 34 : VERTICAL_PIANO_KEYBOARD_HEIGHT }
            : { x: 0, y: laneStart(midi), width: PIANO_KEYBOARD_WIDTH, height: laneFill() };
    }

    function markerLine(midi: number) {
        const pitch = pitchScale()(midi);
        if (vertical()) {
            const x = chartLeft() + pitch;
            return { x1: x, x2: x, y1: chartHeight() - 11, y2: chartHeight() + 13 };
        }
        return { x1: PIANO_KEYBOARD_WIDTH - 13, x2: Math.min(PIANO_KEYBOARD_WIDTH + 11, size().width), y1: pitch, y2: pitch };
    }

    const livePitch = createMemo(() => {
        const midi = props.activeMidi;
        if (midi == null || !Number.isFinite(midi)) return null;

        const note = props.activeNote ?? Math.round(midi);
        if (!Number.isInteger(note) || note < minMidi() || note > maxMidi()) return null;

        const offset = midi - note;
        const neighbor = note + Math.sign(offset);
        const fill = Math.min(Math.abs(offset) / 0.5, 1) * 0.46;
        return {
            midi,
            note,
            neighbor: fill >= 0.015 ? neighbor : null,
            fill,
        };
    });
    const showPreview = createMemo(() => {
        const current = livePitch();
        if (!current) return false;
        return !notesInView().some(note =>
            note.endTime === props.viewEndTime && Math.round(note.avgContinuousMidi) === current.note);
    });

    const translatedChart = () => `translate(${chartLeft()}, 0)`;
    const formattedNote = (midi: number) => midiToNoteName(midi).replace('#', '♯');
    const hideTooltip = () => tooltip?.style('opacity', 0);

    const showTooltip = (event: MouseEvent, note: PitchedSegment, instrument = false) => {
        if (!tooltip) return;
        const midi = Math.round(note.avgContinuousMidi);
        const offset = Math.round((note.avgContinuousMidi - midi) * 100);
        const duration = durationFormat.format(note.duration / 1000);
        const confidence = (note.avgConfidence * 100).toFixed(0);
        tooltip.html(instrument ? `
            <div><strong>${formattedNote(midi)}</strong> · Piano</div>
            <div>Duración ${duration} s</div>
        ` : `
            <div><strong>${formattedNote(midi)}</strong> · MIDI ${midi}</div>
            <div>Afinación ${offset > 0 ? '+' : ''}${offset} cents</div>
            <div>Confianza ${confidence} %</div>
            <div>Duración ${duration} s</div>
        `).style('opacity', 1);

        const box = tooltip.node()?.getBoundingClientRect();
        if (box) {
            tooltip.style('left', `${Math.min(event.clientX + 12, window.innerWidth - box.width - 8)}px`)
                .style('top', `${Math.min(event.clientY + 12, window.innerHeight - box.height - 8)}px`);
        }
    };

    onMount(() => {
        const resizeObserver = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setSize({ width, height });
        });
        resizeObserver.observe(svgRef);
        const { width, height } = svgRef.getBoundingClientRect();
        setSize({ width, height });
        tooltip = d3.select<HTMLDivElement, unknown>('#piano-roll-tooltip');
        window.addEventListener('blur', releaseKeys);
        onCleanup(() => {
            resizeObserver.disconnect();
            window.removeEventListener('blur', releaseKeys);
            releaseKeys();
            hideTooltip();
        });
    });

    createEffect(() => {
        const rotated = vertical();
        const layout = notesInView().map(note => {
            const midi = Math.round(note.avgContinuousMidi);
            const box = segmentRect(note);
            const duration = rotated ? box.height : box.width;
            const center = pitchScale()(midi);
            const actual = pitchScale()(note.avgContinuousMidi);
            const label = formattedNote(midi);
            const showLabel = (rotated ? laneFill() : duration) >= label.length * 7 + 8 &&
                (rotated ? duration : laneFill()) >= 12;
            return {
                note,
                midi,
                box,
                tuning: rotated
                    ? { x1: actual, x2: actual, y1: box.y, y2: box.y + box.height }
                    : { x1: box.x, x2: box.x + box.width, y1: actual, y2: actual },
                label,
                labelX: rotated ? center : box.x + 4,
                labelY: rotated ? box.y + box.height - 6 : center,
                showLabel,
                color: tuningColor(Math.abs(note.avgContinuousMidi - midi) * 100),
            };
        });

        const groups = d3.select(notesRef)
            .selectAll<SVGGElement, typeof layout[number]>('g.note-group')
            .data(chartWidth() > 0 && chartHeight() > 0 ? layout : [], entry => entry.note.startTime)
            .join(
                enter => {
                    const groups = enter.append('g').attr('class', 'note-group');
                    groups.append('rect').attr('class', 'note').attr('rx', 2)
                        .on('pointerenter pointermove', (event: MouseEvent, entry) => showTooltip(event, entry.note))
                        .on('pointerleave', hideTooltip);
                    groups.append('line').attr('class', 'tuning-line');
                    groups.append('text').attr('class', 'note-label');
                    return groups;
                },
                update => update,
                exit => exit.remove()
            );

        groups.select('rect.note')
            .attr('data-midi', entry => entry.midi)
            .attr('x', entry => entry.box.x)
            .attr('y', entry => entry.box.y)
            .attr('width', entry => entry.box.width)
            .attr('height', entry => entry.box.height)
            .attr('fill', entry => entry.color);

        groups.select('line.tuning-line')
            .attr('x1', entry => entry.tuning.x1)
            .attr('x2', entry => entry.tuning.x2)
            .attr('y1', entry => entry.tuning.y1)
            .attr('y2', entry => entry.tuning.y2);

        groups.select('text.note-label')
            .attr('x', entry => entry.labelX)
            .attr('y', entry => entry.labelY)
            .attr('opacity', entry => entry.showLabel ? 1 : 0)
            .text(entry => entry.label);
    });

    createEffect(() => {
        const notes = chartWidth() > 0 && chartHeight() > 0 ? instrumentNotesInView() : [];
        const layout = notes.map(note => ({ note, box: instrumentRect(note) }));
        d3.select(instrumentNotesRef)
            .selectAll<SVGRectElement, typeof layout[number]>('rect.instrument-note')
            .data(layout, entry => `${entry.note.avgContinuousMidi}:${entry.note.startTime}`)
            .join(enter => enter.append('rect')
                .attr('class', 'instrument-note')
                .attr('rx', 1)
                .on('pointerenter pointermove', (event: MouseEvent, entry) => showTooltip(event, entry.note, true))
                .on('pointerleave', hideTooltip))
            .attr('data-midi', entry => entry.note.avgContinuousMidi)
            .attr('x', entry => entry.box.x)
            .attr('y', entry => entry.box.y)
            .attr('width', entry => entry.box.width)
            .attr('height', entry => entry.box.height);
    });

    createEffect(() => {
        const notes = chartWidth() > 0 && chartHeight() > 0 ? guideNotesInView() : [];
        const now = props.viewEndTime;
        const layout = notes.map(note => ({ note, box: segmentRect(note) }));
        d3.select(guideNotesRef)
            .selectAll<SVGRectElement, typeof layout[number]>('rect.guide-note')
            .data(layout, entry => `${entry.note.avgContinuousMidi}:${entry.note.startTime}:${entry.note.endTime}`)
            .join('rect')
            .attr('class', 'guide-note')
            .classed('guide-note-current', entry => entry.note.startTime <= now && now < entry.note.endTime)
            .attr('data-midi', entry => Math.round(entry.note.avgContinuousMidi))
            .attr('data-start-time', entry => entry.note.startTime)
            .attr('data-end-time', entry => entry.note.endTime)
            .attr('rx', 2)
            .attr('x', entry => entry.box.x)
            .attr('y', entry => entry.box.y)
            .attr('width', entry => entry.box.width)
            .attr('height', entry => entry.box.height);
    });

    return (
        <svg
            ref={svgRef}
            width="100%"
            height="100%"
            role={playable() ? 'group' : 'img'}
            data-orientation={vertical() ? 'vertical' : 'horizontal'}
            data-guide={guideEnabled() ? 'active' : undefined}
            aria-label={guideEnabled()
                ? 'Historial de notas con guía. La línea Ahora separa las notas próximas del historial.'
                : vertical()
                    ? 'Historial de notas. Las notas nuevas suben desde el piano de abajo. La barra marca la altura de la voz.'
                    : 'Historial de notas. Las notas nuevas salen del piano de la izquierda. La barra marca la altura de la voz.'}
            onPointerLeave={hideTooltip}
        >
            <rect width={size().width} height={chartHeight()} fill="#111c27" />
            <g class="grid" transform={translatedChart()}>
                <For each={accidentals()}>{midi =>
                    <rect {...laneRect(midi)} fill="#0e1823" />
                }</For>
                <Show when={guideEnabled()}>
                    <rect class="guide-future-band" {...futureRect()} />
                </Show>
                <Show when={livePitch()}>{current =>
                    <rect
                        class="active-note-row"
                        data-midi={current().note}
                        {...laneRect(current().note)}
                        fill="#67e8cb"
                        fill-opacity="0.13"
                    />
                }</Show>
                <For each={midiRange()}>{midi =>
                    <line {...pitchLine(midi)}
                        stroke={midi % 12 === 0 ? '#344658' : '#202e3c'} />
                }</For>
                <For each={timeTicks()}>{seconds =>
                    <line {...timelineLine(seconds)} stroke="#202e3c" />
                }</For>
            </g>
            <g class="guide-notes" transform={translatedChart()} ref={guideNotesRef} aria-hidden="true" />
            <g class="notes" transform={translatedChart()} ref={notesRef} />
            <Show when={showPreview() && livePitch()}>{current =>
                <rect
                    class="note-preview"
                    data-midi={current().note}
                    transform={translatedChart()}
                    {...noteRect(current().note, nowPosition(), Math.min(3, timeExtent() - nowPosition()))}
                    fill="#67e8cb"
                    pointer-events="none"
                />
            }</Show>
            <g class="instrument-notes" transform={translatedChart()} ref={instrumentNotesRef} />
            <Show when={guideEnabled()}>
                <line class="guide-now-line" transform={translatedChart()} {...timelineLine(0)} />
            </Show>
            <g class="keyboard" role={playable() ? 'group' : undefined}
                aria-label={playable() ? 'Piano interactivo. Usa las flechas para elegir una tecla y pulsa Enter o Espacio para tocarla.' : undefined}
                transform={vertical() ? `translate(${chartLeft()}, ${chartHeight()})` : undefined}>
                <Show when={vertical()}>
                    <rect width={chartWidth()} height={VERTICAL_PIANO_KEYBOARD_HEIGHT} fill="#334152" />
                    <For each={accidentals()}>{midi =>
                        <line x1={pitchScale()(midi)} x2={pitchScale()(midi)} y1="34"
                            y2={VERTICAL_PIANO_KEYBOARD_HEIGHT} stroke="#101923" />
                    }</For>
                </Show>
                <For each={midiRange()}>{midi => {
                    const active = () => livePitch()?.note === midi;
                    const deviation = () => livePitch()?.neighbor === midi;
                    const played = () => props.playedKeys?.has(midi) ?? false;
                    const isAccidental = blackKeys.has(midi % 12);
                    const keyColor = isAccidental ? '#0f1924' : '#334152';
                    return (
                        <g>
                            <rect {...keyRect(midi)} fill={keyColor} />
                            <rect
                                class="key"
                                classList={{ 'active-key': active(), 'deviation-key': deviation(), 'playable-key': playable() }}
                                data-midi={midi}
                                {...keyRect(midi)}
                                fill="#67e8cb"
                                fill-opacity={active() ? 1 : deviation() ? livePitch()!.fill : 0}
                                role={playable() ? 'button' : undefined}
                                aria-label={playable() ? formattedNote(midi) : undefined}
                                aria-pressed={playable() ? played() : undefined}
                                tabindex={playable() ? (midi === (focusMidi() ?? Math.min(maxMidi(), Math.max(minMidi(), 69))) ? 0 : -1) : undefined}
                                onFocus={() => setFocusMidi(midi)}
                                onBlur={() => {
                                    endKey(keyboardInput(midi, ' '));
                                    endKey(keyboardInput(midi, 'Enter'));
                                }}
                                onKeyDown={event => handleKeyDown(event, midi)}
                                onKeyUp={event => handleKeyUp(event, midi)}
                                onPointerDown={event => handlePointerDown(event, midi)}
                                onPointerUp={event => endKey(event.pointerId)}
                                onPointerCancel={event => endKey(event.pointerId)}
                                onLostPointerCapture={event => endKey(event.pointerId)}
                                onClick={event => handleAccessibleClick(event, midi)}
                            />
                            <Show when={played()}>
                                <rect class="played-key" data-midi={midi} {...keyRect(midi)}
                                    fill-opacity={active() ? 0.12 : 0.88} aria-hidden="true" />
                            </Show>
                            <Show when={(vertical() ? laneSize() >= 31 : laneSize() >= 13) || midi % 12 === 0 || active() || played()}>
                                <text class="key-label"
                                    x={vertical() ? pitchScale()(midi) : 8}
                                    y={vertical() ? (isAccidental ? 24 : 44) : pitchScale()(midi)}
                                    fill={active() || played() ? '#18152a' : midi % 12 === 0 ? '#bdf3e7' : '#b5c6d7'}>
                                    {formattedNote(midi)}
                                </text>
                            </Show>
                        </g>
                    );
                }}</For>
            </g>
            <Show when={livePitch()}>{current =>
                <line
                    class="voice-pitch-marker"
                    data-midi={current().midi}
                    {...markerLine(current().midi)}
                />
            }</Show>
            <Show when={vertical()} fallback={
                <g class="time-axis" transform={`translate(${PIANO_KEYBOARD_WIDTH}, ${chartHeight()})`}>
                    <line x1={-PIANO_KEYBOARD_WIDTH} x2={chartWidth()} stroke="#344658" />
                    <text class="time-now" classList={{ 'guide-time-now': guideEnabled() }}
                        x={guideEnabled() ? nowPosition() : 4} y="19">
                        {guideEnabled() ? 'Ahora' : '0 s'}
                    </text>
                    <For each={timeTicks()}>{seconds =>
                        <text class="time-label" x={timeScale()(seconds)} y="19">
                            {tickLabel(seconds)}
                        </text>
                    }</For>
                </g>
            }>
                <g class="time-axis vertical-time-axis">
                    <line x1={chartLeft()} x2={size().width} y1={chartHeight()} y2={chartHeight()} stroke="#344658" />
                    <line x1={chartLeft()} x2={chartLeft()} y2={size().height} stroke="#344658" />
                    <text class="time-now" classList={{ 'guide-time-now': guideEnabled() }}
                        x={chartLeft() - 8} y={chartHeight() - (guideEnabled() ? nowPosition() : 9)}>
                        {guideEnabled() ? 'Ahora' : '0 s'}
                    </text>
                    <For each={timeTicks()}>{seconds =>
                        <text class="time-label" x={chartLeft() - 8} y={chartHeight() - timeScale()(seconds)}>
                            {tickLabel(seconds)}
                        </text>
                    }</For>
                </g>
            </Show>
        </svg>
    );
};

export default PianoRoll;
