import * as tf from '@tensorflow/tfjs';

const NUM_INPUT_SAMPLES = 1024;
const CONF_THRESHOLD = 0.8;
const MODEL_URL = new URL(
    `${import.meta.env.BASE_URL}models/spice-tfjs-default-v2/model.json`,
    self.location.href
).href;

let model: tf.GraphModel | null = null;

function detectPitch(graph: tf.GraphModel, samples: Float32Array) {
    return tf.tidy(() => {
        const input = tf.tensor1d(samples);
        const [uncertaintyTensor, pitchTensor] = graph.execute(
            { input_audio_samples: input }, ['uncertainty', 'pitch']
        ) as tf.Tensor[];
        const uncertainties = uncertaintyTensor.dataSync();
        const pitches = pitchTensor.dataSync();

        let pitch: number | null = null;
        let confidence = 0;
        for (let i = 0; i < pitches.length; i++) {
            const predictionConfidence = 1 - uncertainties[i];
            if (predictionConfidence >= CONF_THRESHOLD && predictionConfidence > confidence) {
                // Calibration constants from the SPICE model card.
                pitch = 10 * 2 ** ((pitches[i] * 63.07 + 25.58) / 12);
                confidence = predictionConfidence;
            }
        }

        return { pitch, confidence };
    });
}

async function loadModel() {
    try {
        // Explicit IO handler also accepts the desktop app's local protocol.
        const artifacts = await tf.io.http(MODEL_URL).load();
        for (const backend of ['webgl', 'cpu']) {
            let candidate: tf.GraphModel | undefined;
            try {
                if (!await tf.setBackend(backend)) continue;
                candidate = await tf.loadGraphModel(tf.io.fromMemory(artifacts));
                // Some GPU failures surface only when the graph runs.
                detectPitch(candidate, new Float32Array(NUM_INPUT_SAMPLES));
                model = candidate;
                self.postMessage({ type: 'model_loaded' });
                return;
            } catch (error) {
                candidate?.dispose();
                console.warn(`No se pudo usar el motor ${backend} para SPICE.`, error);
            }
        }
        throw new Error('Ningún motor de TensorFlow.js pudo ejecutar el modelo.');
    } catch (error) {
        console.error('Error al cargar SPICE.', error);
        self.postMessage({ type: 'error', message: 'No se pudo cargar el modelo SPICE incluido.' });
    }
}

self.onmessage = ({ data }: MessageEvent<{ captureId: number; samples: Float32Array }>) => {
    if (!model) return;

    try {
        const result = detectPitch(model, data.samples);
        self.postMessage({ type: 'pitch', captureId: data.captureId, ...result });
    } catch (error) {
        console.error('Error al ejecutar SPICE.', error);
        self.postMessage({ type: 'error', message: 'Se interrumpió el análisis de audio.' });
    }
};

void loadModel();
