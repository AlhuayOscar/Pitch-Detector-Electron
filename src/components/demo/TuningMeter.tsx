import { Component, Show } from 'solid-js';
import type { NoteDetails } from '../../utils/midiUtils';

const centsFormat = new Intl.NumberFormat('es', { signDisplay: 'exceptZero' });

const TuningMeter: Component<{ noteDetails: NoteDetails | null }> = (props) => {
    const roundedCents = () => Math.round(props.noteDetails?.centsOffset ?? 0);

    return (
        <section class="tuning-meter" aria-labelledby="tuning-title">
            <div class="tuning-heading">
                <h2 id="tuning-title" class="section-label">Afinación</h2>
                <span class="metric-value">
                    {props.noteDetails ? `${centsFormat.format(roundedCents())} cents` : '—'}
                </span>
            </div>
            <div class="tuning-track" aria-hidden="true">
                <span class="tuning-center" />
                <Show when={props.noteDetails}>
                    {(note) => (
                        <span
                            class="tuning-needle"
                            classList={{ 'tuning-needle--centered': Math.abs(note().centsOffset) <= 5 }}
                            style={{ left: `${Math.max(0, Math.min(100, note().centsOffset + 50))}%` }}
                        />
                    )}
                </Show>
            </div>
            <div class="tuning-scale" aria-hidden="true">
                <span>−50</span>
                <span>0</span>
                <span>+50</span>
            </div>
        </section>
    );
};

export default TuningMeter;
