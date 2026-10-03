function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Set up touch gestures: scroll, swipe, pinch.
 * Taps are re-synthesized as mouse events; gestures suppress focus/keyboard.
 */
export function setupTouchGestures(container, term, sendKeysFn) {
  let touchStartY = null;
  let touchStartX = null;
  let scrollAccumulator = 0;
  let gestureDirection = null; // null | 'scroll' | 'swipe'
  const PX_PER_LINE = 14;
  const SWIPE_THRESHOLD = 0.4;
  const DIRECTION_LOCK_PX = 10;

  let pinchStartDist = null;
  let pinchStartFontSize = null;

  // RAF-based scroll flush (replaces throttle + drain timer)
  let scrollRafId = null;

  // Momentum state
  const FRICTION = 0.94;
  const MIN_VELOCITY = 0.3;
  const VELOCITY_WINDOW = 4;
  let velocitySamples = [];
  let momentumRafId = null;
  let momentumVelocity = 0;
  let stoppedMomentum = false;

  const swipeLeftEl = document.getElementById("swipe-left");
  const swipeRightEl = document.getElementById("swipe-right");

  function flushScroll() {
    const lines = Math.trunc(scrollAccumulator / PX_PER_LINE);
    if (lines === 0) return;
    scrollAccumulator -= lines * PX_PER_LINE;
    const button = lines > 0 ? 65 : 64;
    sendKeysFn(`\x1b[<${button};1;1M`.repeat(Math.abs(lines)));
  }

  function scheduleScrollFlush() {
    if (scrollRafId === null) {
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        flushScroll();
      });
    }
  }

  function cancelScrollFlush() {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
  }

  function cancelMomentum() {
    if (momentumRafId !== null) {
      cancelAnimationFrame(momentumRafId);
      momentumRafId = null;
    }
    momentumVelocity = 0;
  }

  function computeReleaseVelocity() {
    if (velocitySamples.length < 2) return 0;
    const recent = velocitySamples.slice(-VELOCITY_WINDOW);
    let totalDelta = 0;
    let totalTime = 0;
    for (let i = 1; i < recent.length; i++) {
      totalDelta += recent[i].delta;
      totalTime += recent[i].time - recent[i - 1].time;
    }
    if (totalTime === 0) return 0;
    return totalDelta / totalTime; // px per ms
  }

  function startMomentum() {
    const velocity = computeReleaseVelocity();
    // Convert px/ms to px/frame (~16ms)
    momentumVelocity = velocity * 16;
    if (Math.abs(momentumVelocity) < MIN_VELOCITY) return;

    function tick() {
      momentumVelocity *= FRICTION;
      if (Math.abs(momentumVelocity) < MIN_VELOCITY) {
        momentumRafId = null;
        flushScroll();
        return;
      }
      scrollAccumulator += momentumVelocity;
      flushScroll();
      momentumRafId = requestAnimationFrame(tick);
    }
    momentumRafId = requestAnimationFrame(tick);
  }

  container.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = getTouchDistance(e.touches);
        pinchStartFontSize = term.options.fontSize;
        // Clear both axes: a leftover touchStartX made the final finger
        // lift look like a tap, which focused xterm and opened the keyboard.
        touchStartY = null;
        touchStartX = null;
        gestureDirection = null;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.touches.length === 1) {
        // A touch that halts a coasting scroll is a "stop", not a tap
        stoppedMomentum = momentumRafId !== null;
        cancelMomentum();
        cancelScrollFlush();
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        scrollAccumulator = 0;
        gestureDirection = null;
        velocitySamples = [{ delta: 0, time: Date.now() }];
        // Blur so the already-focused textarea can't re-trigger the
        // keyboard during a gesture. Taps re-focus in touchend.
        term.blur();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true, passive: false },
  );

  container.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 2 && pinchStartDist !== null) {
        const dist = getTouchDistance(e.touches);
        const scale = dist / pinchStartDist;
        const newSize = Math.round(pinchStartFontSize * scale);
        if (
          newSize !== term.options.fontSize &&
          newSize >= 6 &&
          newSize <= 32
        ) {
          container.dispatchEvent(
            new CustomEvent("pinch-zoom", { detail: { fontSize: newSize } }),
          );
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (touchStartY === null || e.touches.length !== 1) return;

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = touchStartY - currentY;
      const deltaX = currentX - touchStartX;

      // Always claim the touch from the browser during direction detection
      e.preventDefault();
      e.stopPropagation();

      if (gestureDirection === null) {
        if (
          Math.abs(deltaY) > DIRECTION_LOCK_PX ||
          Math.abs(deltaX) > DIRECTION_LOCK_PX
        ) {
          gestureDirection =
            Math.abs(deltaX) > Math.abs(deltaY) * 1.5 ? "swipe" : "scroll";
        } else {
          return;
        }
      }

      if (gestureDirection === "swipe") {
        if (swipeLeftEl && swipeRightEl) {
          if (deltaX > DIRECTION_LOCK_PX) {
            swipeRightEl.classList.add("visible");
            swipeLeftEl.classList.remove("visible");
          } else if (deltaX < -DIRECTION_LOCK_PX) {
            swipeLeftEl.classList.add("visible");
            swipeRightEl.classList.remove("visible");
          } else {
            swipeLeftEl.classList.remove("visible");
            swipeRightEl.classList.remove("visible");
          }
        }
        return;
      }

      if (gestureDirection === "scroll") {
        const delta = touchStartY - currentY;
        touchStartY = currentY;
        if (Math.abs(delta) < 1) return;

        velocitySamples.push({ delta, time: Date.now() });
        if (velocitySamples.length > VELOCITY_WINDOW + 1) {
          velocitySamples.shift();
        }

        scrollAccumulator += delta;
        scheduleScrollFlush();
      }
    },
    { capture: true, passive: false },
  );

  container.addEventListener(
    "touchend",
    (e) => {
      if (pinchStartDist !== null && e.touches.length < 2) {
        pinchStartDist = null;
        pinchStartFontSize = null;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (gestureDirection === "swipe" && touchStartX !== null) {
        const endX = e.changedTouches[0]?.clientX ?? touchStartX;
        const deltaX = endX - touchStartX;
        if (Math.abs(deltaX) > window.innerWidth * SWIPE_THRESHOLD) {
          container.dispatchEvent(
            new CustomEvent("swipe-session", {
              detail: { direction: deltaX > 0 ? "next" : "prev" },
            }),
          );
        }
      }

      if (gestureDirection !== null) {
        if (gestureDirection === "scroll") {
          cancelScrollFlush();
          flushScroll();
          startMomentum();
        }
        e.preventDefault();
      }

      // Tap (no gesture detected) → synthesize mouse events so xterm
      // handles focus/cursor and the click handler in main.js fires.
      if (
        gestureDirection === null &&
        touchStartX !== null &&
        !stoppedMomentum
      ) {
        const touch = e.changedTouches[0];
        if (touch) {
          const target =
            document.elementFromPoint?.(touch.clientX, touch.clientY) ||
            container;
          const mouseOpts = {
            bubbles: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            button: 0,
          };
          target.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
          target.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
          target.dispatchEvent(new MouseEvent("click", mouseOpts));
        }
      }

      if (swipeLeftEl) swipeLeftEl.classList.remove("visible");
      if (swipeRightEl) swipeRightEl.classList.remove("visible");

      touchStartY = null;
      touchStartX = null;
      gestureDirection = null;
      velocitySamples = [];
    },
    { capture: true, passive: false },
  );

  container.addEventListener(
    "touchcancel",
    () => {
      cancelMomentum();
      cancelScrollFlush();
      if (swipeLeftEl) swipeLeftEl.classList.remove("visible");
      if (swipeRightEl) swipeRightEl.classList.remove("visible");
      touchStartY = null;
      touchStartX = null;
      scrollAccumulator = 0;
      gestureDirection = null;
      velocitySamples = [];
      pinchStartDist = null;
      pinchStartFontSize = null;
      stoppedMomentum = false;
    },
    { capture: true, passive: false },
  );
}
