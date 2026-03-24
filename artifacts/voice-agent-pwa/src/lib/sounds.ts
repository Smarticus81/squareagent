/**
 * Sound design system — Web Audio API micro-sounds for state transitions.
 * Each sound is a short, tasteful tone that reinforces the ambient feel.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  gain = 0.12,
  rampDown = true,
) {
  const ac = getCtx();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  if (rampDown) g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.connect(g).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration);
}

/** Soft low pulse — wake word detected, entering command mode */
export function soundWake() {
  playTone(180, 0.18, "sine", 0.10);
  setTimeout(() => playTone(260, 0.14, "sine", 0.08), 100);
}

/** Bright ascending chime — wake word acknowledged, connecting */
export function soundChime() {
  playTone(660, 0.08, "sine", 0.09);
  setTimeout(() => playTone(880, 0.08, "sine", 0.09), 70);
  setTimeout(() => playTone(1320, 0.12, "sine", 0.07), 140);
}

/** Quick bright clink — item added to order */
export function soundItemAdd() {
  playTone(880, 0.06, "sine", 0.08);
  setTimeout(() => playTone(1100, 0.08, "sine", 0.06), 50);
}

/** Satisfying cha-ching — order submitted */
export function soundSubmit() {
  playTone(520, 0.08, "triangle", 0.10);
  setTimeout(() => playTone(660, 0.08, "triangle", 0.08), 80);
  setTimeout(() => playTone(880, 0.12, "triangle", 0.10), 160);
}

/** Hollow tap — error or disconnect */
export function soundError() {
  playTone(220, 0.15, "square", 0.05);
}

/** Subtle descending tone — going to sleep / shutdown */
export function soundSleep() {
  playTone(440, 0.12, "sine", 0.06);
  setTimeout(() => playTone(330, 0.15, "sine", 0.05), 100);
}
