/**
 * Kinetic (momentum) scrolling in whole terminal lines.
 *
 * Drag distance maps 1:1 to lines (one line per line height); a flick keeps
 * coasting with exponential decay, like native scroll views. Physics run on
 * elapsed time, not frame count, so 60Hz and 120Hz screens feel the same.
 */

// Decay time constant: the coast covers ≈ coast velocity × TAU
const TAU_MS = 600;
// Release velocity is measured over the last part of the drag only
const VELOCITY_WINDOW_MS = 100;
// Finger held still longer than this before lifting → no throw
const MAX_RELEASE_AGE_MS = 60;
const MIN_THROW_VELOCITY = 0.3; // px/ms — slower releases don't coast
const STOP_VELOCITY = 0.1; // px/ms — coasting ends below this
const MAX_FINGER_VELOCITY = 6; // px/ms — guards against glitchy samples
const MAX_COAST_VELOCITY = 20; // px/ms — ≈ 600 lines per throw at most
// Fling gain grows with speed: gentle flicks stay controllable, fast or
// repeated flicks travel far (coast = v × (1 + |v| / GAIN_REF))
const GAIN_REF = 1; // px/ms

const clamp = (v, max) => Math.max(-max, Math.min(max, v));

/** Finger velocity → coast velocity (superlinear, like native flings). */
function flingGain(v) {
  return v * (1 + Math.abs(v) / GAIN_REF);
}

/** Inverse of flingGain: the finger speed that would give this coast. */
function fingerEquivalent(coast) {
  const a = Math.abs(coast);
  return (
    (Math.sign(coast) * (Math.sqrt(1 + (4 * a) / GAIN_REF) - 1) * GAIN_REF) / 2
  );
}

/**
 * @param {object} opts
 * @param {() => number} opts.getLineHeight - px per terminal line
 * @param {(lines: number) => void} opts.onScroll - positive = toward newer
 *   output (finger moving up); called at most once per frame
 * @param {() => number} [opts.now]
 * @param {(cb: () => void) => number} [opts.raf]
 * @param {(id: number) => void} [opts.caf]
 */
export function createKineticScroller({
  getLineHeight,
  onScroll,
  now = () => performance.now(),
  raf = (cb) => requestAnimationFrame(cb),
  caf = (id) => cancelAnimationFrame(id),
}) {
  let accumulator = 0; // px not yet turned into whole lines
  let position = 0; // finger travel since begin(), for velocity
  let samples = [];
  let flushId = null;
  let coastId = null;
  let velocity = 0;
  let lastFrameAt = 0;
  let carried = 0; // coast velocity interrupted by the current touch

  function flush() {
    const lineHeight = Math.max(1, getLineHeight());
    // Epsilon: summed float deltas (59.999…px) must still make 3 lines
    const lines = Math.trunc(
      accumulator / lineHeight + Math.sign(accumulator) * 1e-9,
    );
    if (lines === 0) return;
    accumulator -= lines * lineHeight;
    onScroll(lines);
  }

  function cancelFlush() {
    if (flushId !== null) caf(flushId);
    flushId = null;
  }

  function scheduleFlush() {
    if (flushId !== null) return;
    flushId = raf(() => {
      flushId = null;
      flush();
    });
  }

  function stop() {
    if (coastId !== null) caf(coastId);
    coastId = null;
    velocity = 0;
    cancelFlush();
  }

  function begin() {
    carried = coastId !== null ? velocity : 0;
    stop();
    accumulator = 0;
    position = 0;
    samples = [{ t: now(), pos: 0 }];
  }

  /** @param {number} deltaPx finger travel since the last move (up = +) */
  function move(deltaPx) {
    accumulator += deltaPx;
    position += deltaPx;
    const t = now();
    samples = [...samples, { t, pos: position }].filter(
      (s, i, all) => i >= all.length - 2 || t - s.t <= VELOCITY_WINDOW_MS,
    );
    scheduleFlush();
  }

  function releaseVelocity() {
    const t = now();
    const last = samples.at(-1);
    if (!last || samples.length < 2 || t - last.t > MAX_RELEASE_AGE_MS) {
      return 0;
    }
    const recent = samples.filter((s) => t - s.t <= VELOCITY_WINDOW_MS);
    const first = recent.length >= 2 ? recent[0] : samples.at(-2);
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return clamp((last.pos - first.pos) / dt, MAX_FINGER_VELOCITY);
  }

  function coast() {
    const t = now();
    const dt = t - lastFrameAt;
    lastFrameAt = t;
    // Exact integral of v·e^(-t/τ) over this frame: frame-rate independent
    const decay = Math.exp(-dt / TAU_MS);
    accumulator += velocity * TAU_MS * (1 - decay);
    velocity *= decay;
    flush();
    if (Math.abs(velocity) < STOP_VELOCITY) {
      coastId = null;
      return;
    }
    coastId = raf(coast);
  }

  function release() {
    cancelFlush();
    flush();
    const v = releaseVelocity();
    samples = [];
    const boost = carried;
    carried = 0;
    if (Math.abs(v) < MIN_THROW_VELOCITY) return;
    // Flicking again in the same direction while coasting stacks up speed
    const finger =
      Math.sign(boost) === Math.sign(v) ? v + fingerEquivalent(boost) : v;
    velocity = clamp(flingGain(finger), MAX_COAST_VELOCITY);
    lastFrameAt = now();
    coastId = raf(coast);
  }

  return {
    begin,
    move,
    release,
    stop,
    isCoasting: () => coastId !== null,
  };
}
