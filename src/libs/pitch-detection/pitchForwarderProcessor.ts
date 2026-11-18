declare function registerProcessor(
    name: string,
    processor: new () => { process(inputs: Float32Array[][]): boolean }
): void;

declare const AudioWorkletProcessor: new () => { readonly port: MessagePort };

class PitchForwarderProcessor extends AudioWorkletProcessor {
    private frame = new Float32Array(1024);
    private frameLength = 0;

    process(inputs: Float32Array[][]): boolean {
        const channel = inputs[0]?.[0];
        if (!channel) return true;

        let offset = 0;
        while (offset < channel.length) {
            const length = Math.min(channel.length - offset, this.frame.length - this.frameLength);
            this.frame.set(channel.subarray(offset, offset + length), this.frameLength);
            offset += length;
            this.frameLength += length;

            if (this.frameLength === this.frame.length) {
                this.port.postMessage(this.frame, [this.frame.buffer]);
                this.frame = new Float32Array(1024);
                this.frameLength = 0;
            }
        }
        return true;
    }
}

registerProcessor('pitch-forwarder-processor', PitchForwarderProcessor);
