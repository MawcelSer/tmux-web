import { createKineticScroller } from "./kinetic-scroll.js";

const NO_SELECTION = {
  isActive: () => false,
  startAt() {},
  dragTo() {},
  hitHandle: () => null,
  grab() {},
  clear() {},
};

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Set up touch gestures: scroll (with momentum), swipe, pinch, and
 * long-press text selection. Taps are re-synthesized as mouse events;
 * gestures suppress focus/keyboard.
 *
 * @param {HTMLElement} container
 * @param {import("@xterm/xterm").Terminal} term
 * @param {object} opts
 * @param {(lines: number) => void} opts.onScroll - positive = newer output
 * @param {() => number} opts.getLineHeight - px per terminal row
 * @param {object} [opts.selection] - touch selection (see touch-selection.js)
 */
export function setupTouchGestures(
  container,
  term,
  { onScroll, getLineHeight, selection = NO_SELECTION },
) {
  let touchStartY = null;
  let touchStartX = null;
  // null | 'scroll' | 'swipe' | 'select' (long-press) | 'handle'
  let gestureDirection = null;
  const SWIPE_THRESHOLD = 0.4;
  const DIRECTION_LOCK_PX = 10;
  const LONG_PRESS_MS = 450;

  let longPressTimer = null;
  let activeHandle; // "start" | "end" while dragging a selection handle
  let dismissSelection = false; // this touch should clear the selection

  function cancelLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function startLongPress(x, y) {
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (gestureDirection !== null || touchStartX === null) return;
      gestureDirection = "select";
      activeHandle = undefined;
      dismissSelection = false;
      selection.startAt(x, y);
      navigator.vibrate?.(20);
    }, LONG_PRESS_MS);
  }

  let pinchStartDist = null;
  let pinchStartFontSize = null;
  let stoppedMomentum = false;

  const kinetic = createKineticScroller({ getLineHeight, onScroll });

  const swipeLeftEl = document.getElementById("swipe-left");
  const swipeRightEl = document.getElementById("swipe-right");

  container.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        cancelLongPress();
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
        stoppedMomentum = kinetic.isCoasting();
        kinetic.begin();
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        gestureDirection = null;
        // Blur so the already-focused textarea can't re-trigger the
        // keyboard during a gesture. Taps re-focus in touchend.
        term.blur();
        e.preventDefault();
        e.stopPropagation();

        cancelLongPress();
        dismissSelection = false;
        if (selection.isActive()) {
          const handle = selection.hitHandle(touchStartX, touchStartY);
          if (handle) {
            gestureDirection = "handle";
            activeHandle = handle;
            selection.grab(handle, touchStartX, touchStartY);
            return;
          }
          dismissSelection = true; // tap or scroll elsewhere clears it
        }
        startLongPress(touchStartX, touchStartY);
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

      if (gestureDirection === "select" || gestureDirection === "handle") {
        selection.dragTo(currentX, currentY, activeHandle);
        return;
      }

      if (gestureDirection === null) {
        if (
          Math.abs(deltaY) > DIRECTION_LOCK_PX ||
          Math.abs(deltaX) > DIRECTION_LOCK_PX
        ) {
          gestureDirection =
            Math.abs(deltaX) > Math.abs(deltaY) * 1.5 ? "swipe" : "scroll";
          cancelLongPress();
          if (dismissSelection) {
            selection.clear();
            dismissSelection = false;
          }
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
        if (delta !== 0) kinetic.move(delta);
      }
    },
    { capture: true, passive: false },
  );

  container.addEventListener(
    "touchend",
    (e) => {
      cancelLongPress();
      if (gestureDirection === "select" || gestureDirection === "handle") {
        // Selection stays; the action bar takes it from here
        e.preventDefault();
        touchStartY = null;
        touchStartX = null;
        gestureDirection = null;
        return;
      }

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
        if (gestureDirection === "scroll") kinetic.release();
        e.preventDefault();
      }

      // Tap (no gesture detected) → synthesize mouse events so xterm
      // handles focus/cursor and the click handler in main.js fires.
      if (
        gestureDirection === null &&
        touchStartX !== null &&
        dismissSelection
      ) {
        // Tap outside the selection only dismisses it (no click/keyboard)
        selection.clear();
        dismissSelection = false;
      } else if (
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
    },
    { capture: true, passive: false },
  );

  container.addEventListener(
    "touchcancel",
    () => {
      kinetic.stop();
      cancelLongPress();
      if (swipeLeftEl) swipeLeftEl.classList.remove("visible");
      if (swipeRightEl) swipeRightEl.classList.remove("visible");
      touchStartY = null;
      touchStartX = null;
      gestureDirection = null;
      pinchStartDist = null;
      pinchStartFontSize = null;
      stoppedMomentum = false;
    },
    { capture: true, passive: false },
  );
}
