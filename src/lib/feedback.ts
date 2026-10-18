// Tap feedback: a haptic plus a short sound, distinct for each outcome.
// Call only from a trusted click handler: iOS Safari ignores both otherwise.

export type Outcome = 'accepted' | 'declined' | 'error';

// ── Haptics ──────────────────────────────────────────────────────────────────
// Android: Vibration API. iPhone Safari has no Vibration API, but iOS 18+ plays the
// system haptic when a switch-style checkbox is toggled through its label.

function iosTick() {
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  document.head.removeChild(label);
}

const PATTERN: Record<Outcome, number[]> = {
  accepted: [30],
  declined: [40, 70, 40],
  error: [40, 60, 40, 60, 40],
};

function haptic(outcome: Outcome) {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(PATTERN[outcome]);
    return;
  }
  const ticks = outcome === 'accepted' ? 1 : outcome === 'declined' ? 2 : 3;
  iosTick();
  for (let i = 1; i < ticks; i++) setTimeout(iosTick, i * 110);
}

// ── Sound ────────────────────────────────────────────────────────────────────
// Played through Web Audio in the "ambient" audio session, so it mixes with music or
// navigation already playing instead of pausing it. The trade-off: on iPhone the
// ring/silent switch mutes ambient sounds. Tones are synthesised once into buffers.

type Wave = 'sine' | 'triangle' | 'square';
interface Note {
  freq: number;
  ms: number;
  wave: Wave;
  gap?: number;
}

const SOUNDS: Record<Outcome, Note[]> = {
  // Bright rising pair.
  accepted: [
    { freq: 1047, ms: 55, wave: 'sine' },
    { freq: 1568, ms: 85, wave: 'sine' },
  ],
  // Falling pair: "no".
  declined: [
    { freq: 659, ms: 90, wave: 'triangle', gap: 20 },
    { freq: 440, ms: 120, wave: 'triangle' },
  ],
  // Two low buzzes.
  error: [
    { freq: 196, ms: 80, wave: 'square', gap: 50 },
    { freq: 196, ms: 80, wave: 'square' },
  ],
};

function render(ctx: AudioContext, notes: Note[]): AudioBuffer {
  const rate = ctx.sampleRate;
  const total = notes.reduce((n, x) => n + Math.round(((x.ms + (x.gap ?? 0)) / 1000) * rate), 0);
  const buf = ctx.createBuffer(1, total, rate);
  const out = buf.getChannelData(0);
  let pos = 0;
  for (const n of notes) {
    const len = Math.round((n.ms / 1000) * rate);
    const attack = Math.round(0.004 * rate);
    for (let i = 0; i < len; i++) {
      const ph = ((i * n.freq) / rate) % 1;
      const s = n.wave === 'sine' ? Math.sin(2 * Math.PI * ph) : n.wave === 'triangle' ? 1 - 4 * Math.abs(ph - 0.5) : ph < 0.5 ? 0.6 : -0.6;
      const env = i < attack ? i / attack : Math.exp((-5 * (i - attack)) / len);
      out[pos + i] = s * env * 0.8;
    }
    pos += len + Math.round(((n.gap ?? 0) / 1000) * rate);
  }
  return buf;
}

let ctx: AudioContext | null = null;
const buffers: Partial<Record<Outcome, AudioBuffer>> = {};

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  // Safari 16.4+: say explicitly that these sounds should mix with other audio.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'ambient';
  ctx = new AC();
  return ctx;
}

function buffer(outcome: Outcome): AudioBuffer | null {
  const c = audio();
  if (!c) return null;
  return (buffers[outcome] ??= render(c, SOUNDS[outcome]));
}

function sound(outcome: Outcome) {
  const c = audio();
  const b = buffer(outcome);
  if (!c || !b) return;
  // Resuming inside the tap's click event is what unlocks audio on iPhone.
  if (c.state !== 'running') c.resume().catch(() => {});
  const src = c.createBufferSource();
  src.buffer = b;
  src.connect(c.destination);
  src.start();
}

/** Build the sounds ahead of the first tap so it plays without delay. */
export function prepareFeedback() {
  (Object.keys(SOUNDS) as Outcome[]).forEach(buffer);
}

export function feedback(outcome: Outcome) {
  try {
    sound(outcome);
  } catch {
    // Best-effort.
  }
  try {
    haptic(outcome);
  } catch {
    // Best-effort.
  }
}
