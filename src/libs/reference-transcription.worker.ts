import { transcribeReference } from './reference-transcription';

self.onmessage = ({ data }: MessageEvent<Float32Array>) => {
    try {
        const notes = transcribeReference(data, progress => self.postMessage({ type: 'progress', progress }));
        self.postMessage({ type: 'done', notes });
    } catch (error) {
        console.error('Error al analizar la referencia.', error);
        self.postMessage({ type: 'error' });
    }
};
