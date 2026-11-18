import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
import * as d3 from 'd3';
import type { MidiSegment } from '../pages/Demo';
import { midiToNoteName } from '../utils/midiUtils';

interface PianoRollProps {
    notes: MidiSegment[];
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
    let tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, unknown> | undefined;
    const [size, setSize] = createSignal({ width: 0, height: 0 });
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
    const viewStart = () => props.viewEndTime - 1000 * viewSeconds();
    const timeScale = createMemo(() => d3.scaleLinear()
        .domain([0, viewSeconds()])
        .range([0, timeExtent()])
        .clamp(true));
    const timeTicks = createMemo(() => timeScale()
        .ticks(Math.max(2, Math.floor(timeExtent() / (vertical() ? 78 : 105))))
        .filter(seconds => {
            const position = timeScale()(seconds);
            return seconds > 0 && position >= (vertical() ? 36 : 60) && position <= timeExtent() - 25;
        }));
    const notesInView = createMemo(() => props.notes.filter((note): note is PitchedSegment =>
        note.avgContinuousMidi !== null &&
        Math.round(note.avgContinuousMidi) >= minMidi() &&
        Math.round(note.avgContinuousMidi) <= maxMidi() &&
        note.endTime >= viewStart() &&
        note.startTime <= props.viewEndTime));

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

    function noteRect(midi: number, age: number, length: number) {
        return vertical()
            ? { x: laneStart(midi), y: chartHeight() - age - length, width: laneFill(), height: length }
            : { x: age, y: laneStart(midi), width: length, height: laneFill() };
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

    const showTooltip = (event: MouseEvent, note: PitchedSegment) => {
        if (!tooltip) return;
        const midi = Math.round(note.avgContinuousMidi);
        const offset = Math.round((note.avgContinuousMidi - midi) * 100);
        const duration = durationFormat.format(note.duration / 1000);
        const confidence = (note.avgConfidence * 100).toFixed(0);
        tooltip.html(`
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
        onCleanup(() => {
            resizeObserver.disconnect();
            hideTooltip();
        });
    });

    createEffect(() => {
        const end = props.viewEndTime;
        const ageOf = (timestamp: number) => timeScale()((end - timestamp) / 1000);
        const minLength = Math.min(1, timeExtent());
        const rotated = vertical();
        const layout = notesInView().map(note => {
            const midi = Math.round(note.avgContinuousMidi);
            const age = Math.min(ageOf(note.endTime), timeExtent() - minLength);
            const duration = Math.max(minLength, ageOf(note.startTime) - age);
            const box = noteRect(midi, age, duration);
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

    return (
        <svg
            ref={svgRef}
            width="100%"
            height="100%"
            role="img"
            data-orientation={vertical() ? 'vertical' : 'horizontal'}
            aria-label={vertical()
                ? 'Historial de notas. Las notas nuevas suben desde el piano de abajo. La barra marca la altura de la voz.'
                : 'Historial de notas. Las notas nuevas salen del piano de la izquierda. La barra marca la altura de la voz.'}
            onPointerLeave={hideTooltip}
        >
            <rect width={size().width} height={chartHeight()} fill="#111c27" />
            <g class="grid" transform={translatedChart()}>
                <For each={accidentals()}>{midi =>
                    <rect {...laneRect(midi)} fill="#0e1823" />
                }</For>
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
            <g class="notes" transform={translatedChart()} ref={notesRef} />
            <Show when={showPreview() && livePitch()}>{current =>
                <rect
                    class="note-preview"
                    data-midi={current().note}
                    transform={translatedChart()}
                    {...noteRect(current().note, 0, Math.min(3, timeExtent()))}
                    fill="#67e8cb"
                    pointer-events="none"
                />
            }</Show>
            <g class="keyboard" transform={vertical() ? `translate(${chartLeft()}, ${chartHeight()})` : undefined}>
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
                    const isAccidental = blackKeys.has(midi % 12);
                    const keyColor = isAccidental ? '#0f1924' : '#334152';
                    return (
                        <g>
                            <rect {...keyRect(midi)} fill={keyColor} />
                            <rect
                                class="key"
                                classList={{ 'active-key': active(), 'deviation-key': deviation() }}
                                data-midi={midi}
                                {...keyRect(midi)}
                                fill="#67e8cb"
                                fill-opacity={active() ? 1 : deviation() ? livePitch()!.fill : 0}
                            />
                            <Show when={(vertical() ? laneSize() >= 31 : laneSize() >= 13) || midi % 12 === 0 || active()}>
                                <text class="key-label"
                                    x={vertical() ? pitchScale()(midi) : 8}
                                    y={vertical() ? (isAccidental ? 24 : 44) : pitchScale()(midi)}
                                    fill={active() ? '#102821' : midi % 12 === 0 ? '#bdf3e7' : '#b5c6d7'}>
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
                    <text class="time-now" x="4" y="19">0 s</text>
                    <For each={timeTicks()}>{seconds =>
                        <text class="time-label" x={timeScale()(seconds)} y="19">
                            −{timeFormat.format(seconds)} s
                        </text>
                    }</For>
                </g>
            }>
                <g class="time-axis vertical-time-axis">
                    <line x1={chartLeft()} x2={size().width} y1={chartHeight()} y2={chartHeight()} stroke="#344658" />
                    <line x1={chartLeft()} x2={chartLeft()} y2={size().height} stroke="#344658" />
                    <text class="time-now" x={chartLeft() - 8} y={chartHeight() - 9}>0 s</text>
                    <For each={timeTicks()}>{seconds =>
                        <text class="time-label" x={chartLeft() - 8} y={chartHeight() - timeScale()(seconds)}>
                            −{timeFormat.format(seconds)} s
                        </text>
                    }</For>
                </g>
            </Show>
        </svg>
    );
};

export default PianoRoll;
