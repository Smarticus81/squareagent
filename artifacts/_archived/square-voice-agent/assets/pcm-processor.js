/**
 * AudioWorklet processor for low-latency PCM16 capture.
 * Runs on a dedicated audio thread — no main-thread jank.
 * Accumulates samples and sends them every ~60ms (1440 samples at 24kHz)
 * for a good balance between latency and message overhead.
 */
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(1440); // ~60ms at 24kHz
    this._pos = 0;
    this._active = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this._active = false;
    };
  }

  process(inputs) {
    if (!this._active) return false;
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const chan = input[0]; // 128 samples per call at 24kHz
    for (let i = 0; i < chan.length; i++) {
      this._buffer[this._pos++] = chan[i];
      if (this._pos >= this._buffer.length) {
        // Convert to Int16 PCM
        const pcm = new Int16Array(this._buffer.length);
        for (let j = 0; j < this._buffer.length; j++) {
          const s = this._buffer[j];
          pcm[j] = s < 0 ? Math.max(-32768, s * 32768) : Math.min(32767, s * 32767);
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this._buffer = new Float32Array(1440);
        this._pos = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
