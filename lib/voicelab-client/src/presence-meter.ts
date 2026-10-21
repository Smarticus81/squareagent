/**
 * Presence meter — turns the assistant's remote audio into a single 0..1
 * level the always-on surface can breathe with.
 *
 * The rule of the design: the presence only moves with real sound. There is
 * no procedural "fake speech"; when the stream is silent the level decays to
 * zero and the surface rests. Callers poll `level()` from their own frame
 * loop so the meter stays framework-free.
 */
export interface PresenceMeter {
  /** Current smoothed level in 0..1. Safe to call every animation frame. */
  level(): number;
  /** Release the analyser and audio context. */
  dispose(): void;
}

const NOISE_FLOOR = 18; // byte-frequency magnitude below which we treat audio as silence
const ATTACK = 0.35;
const RELEASE = 0.10;

export function createPresenceMeter(stream: MediaStream): PresenceMeter | null {
  const Ctx =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;

  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let buffer: Uint8Array<ArrayBuffer> | null = null;
  let smoothed = 0;

  try {
    ctx = new Ctx();
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    buffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    void ctx.resume().catch(() => {});
  } catch {
    dispose();
    return null;
  }

  function dispose() {
    try { source?.disconnect(); } catch { /* ignore */ }
    try { analyser?.disconnect(); } catch { /* ignore */ }
    try { void ctx?.close(); } catch { /* ignore */ }
    source = null;
    analyser = null;
    ctx = null;
    buffer = null;
  }

  function level(): number {
    if (!analyser || !buffer) return 0;
    if (ctx?.state === "suspended") void ctx.resume().catch(() => {});
    analyser.getByteFrequencyData(buffer);
    // Speech energy lives in the lower ~60% of the spectrum at this fft size.
    const end = Math.max(2, Math.floor(buffer.length * 0.6));
    let peak = 0;
    let sum = 0;
    for (let i = 2; i < end; i++) {
      const v = buffer[i];
      sum += v;
      if (v > peak) peak = v;
    }
    const mean = sum / (end - 2);
    const raw = peak < NOISE_FLOOR ? 0 : Math.min(1, Math.pow((mean / 255) * 1.8 + (peak / 255) * 0.4, 0.75));
    smoothed += (raw - smoothed) * (raw > smoothed ? ATTACK : RELEASE);
    if (smoothed < 0.004) smoothed = 0;
    return smoothed;
  }

  return { level, dispose };
}
