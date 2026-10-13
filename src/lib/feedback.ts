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
// Played through an <audio> element, which iOS does not mute with the silent switch
// (Web Audio would be muted). Tones are synthesised once into small WAV files.

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

const RATE = 22050;

function render(notes: Note[]): Blob {
  const total = notes.reduce((n, x) => n + Math.round(((x.ms + (x.gap ?? 0)) / 1000) * RATE), 0);
  const pcm = new Int16Array(total);
  let pos = 0;
  for (const n of notes) {
    const len = Math.round((n.ms / 1000) * RATE);
    const attack = Math.round(0.004 * RATE);
    for (let i = 0; i < len; i++) {
      const ph = ((i * n.freq) / RATE) % 1;
      const s = n.wave === 'sine' ? Math.sin(2 * Math.PI * ph) : n.wave === 'triangle' ? 1 - 4 * Math.abs(ph - 0.5) : ph < 0.5 ? 0.6 : -0.6;
      const env = i < attack ? i / attack : Math.exp((-5 * (i - attack)) / len);
      pcm[pos + i] = Math.round(s * env * 0.8 * 32767);
    }
    pos += len + Math.round(((n.gap ?? 0) / 1000) * RATE);
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + pcm.byteLength, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

const players: Partial<Record<Outcome, HTMLAudioElement>> = {};

function player(outcome: Outcome): HTMLAudioElement {
  let a = players[outcome];
  if (!a) {
    a = new Audio(URL.createObjectURL(render(SOUNDS[outcome])));
    a.preload = 'auto';
    players[outcome] = a;
  }
  return a;
}

function sound(outcome: Outcome) {
  const a = player(outcome);
  a.currentTime = 0;
  a.play().catch(() => {});
}

/** Create the audio files ahead of the first tap so it plays without delay. */
export function prepareFeedback() {
  (Object.keys(SOUNDS) as Outcome[]).forEach(player);
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
