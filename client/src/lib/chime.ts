/** A short soft bell made with the Web Audio API (no audio file). */

let ctx: AudioContext | null = null;

/** Plays the bell. Returns false (never throws) when the browser blocks or lacks audio. */
export function playChime(): boolean {
  try {
    const Ctor: typeof AudioContext | undefined =
      globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') {
      // Blocked until the page has had a click; a rejected resume is silent too.
      void ctx.resume().catch(() => undefined);
      return false;
    }
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.12;
    out.connect(ctx.destination);
    // Two sine partials with a fast exponential decay.
    for (const [freq, len] of [[880, 0.9], [1318.5, 0.5]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(1, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + len);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + len + 0.05);
    }
    return true;
  } catch {
    return false;
  }
}
