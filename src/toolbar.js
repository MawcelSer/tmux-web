/** Key label → escape sequence mapping for the mobile toolbar. */
export const KEYS = {
  'ESC': '\x1b',
  'TAB': '\t',
  '-': '-',
  '/': '/',
  '|': '|',
  '_': '_',
  '~': '~',
  '←': '\x1b[D',
  '↑': '\x1b[A',
  '↓': '\x1b[B',
  '→': '\x1b[C',
  'PGUP': '\x1b[5~',
  'PGDN': '\x1b[6~',
  'HOME': '\x1b[H',
  'END': '\x1b[F',
};

/** Get the escape sequence for a key label. */
export function getKeySequence(label) {
  return KEYS[label];
}

/**
 * Create and mount the toolbar DOM — JuiceSSH-style extra keys bar
 * with CTRL/ALT as sticky toggle modifiers.
 */
export function createToolbar(container, { onKey, onIncrease, onDecrease }) {
  let ctrlActive = false;
  let altActive = false;

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  function sep() {
    const s = document.createElement('span');
    s.className = 'toolbar-sep';
    return s;
  }

  function makeButton(label, onClick, extraClass = '') {
    const btn = document.createElement('button');
    btn.className = `toolbar-btn ${extraClass}`.trim();
    btn.textContent = label;
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      onClick();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return btn;
  }

  // ESC
  toolbar.appendChild(makeButton('ESC', () => onKey(KEYS['ESC']), 'toolbar-btn-wide'));

  toolbar.appendChild(sep());

  // CTRL toggle
  const ctrlBtn = makeButton('CTRL', () => {
    ctrlActive = !ctrlActive;
    ctrlBtn.classList.toggle('active', ctrlActive);
  }, 'toolbar-mod');
  toolbar.appendChild(ctrlBtn);

  // ALT toggle
  const altBtn = makeButton('ALT', () => {
    altActive = !altActive;
    altBtn.classList.toggle('active', altActive);
  }, 'toolbar-mod');
  toolbar.appendChild(altBtn);

  toolbar.appendChild(sep());

  // TAB
  toolbar.appendChild(makeButton('TAB', () => onKey(KEYS['TAB']), 'toolbar-btn-wide'));

  toolbar.appendChild(sep());

  // Special characters
  for (const ch of ['-', '/', '|', '_', '~']) {
    toolbar.appendChild(makeButton(ch, () => onKey(ch)));
  }

  toolbar.appendChild(sep());

  // Arrows
  for (const key of ['←', '↑', '↓', '→']) {
    toolbar.appendChild(makeButton(key, () => onKey(KEYS[key]), 'toolbar-btn-arrow'));
  }

  toolbar.appendChild(sep());

  // Page/position navigation
  for (const key of ['PGUP', 'PGDN', 'HOME', 'END']) {
    toolbar.appendChild(makeButton(key, () => onKey(KEYS[key]), 'toolbar-btn-wide'));
  }

  toolbar.appendChild(sep());

  // Font size
  toolbar.appendChild(makeButton('A-', onDecrease, 'toolbar-font'));
  toolbar.appendChild(makeButton('A+', onIncrease, 'toolbar-font'));

  container.appendChild(toolbar);

  function getModifiers() {
    return { ctrl: ctrlActive, alt: altActive };
  }

  function clearModifiers() {
    ctrlActive = false;
    altActive = false;
    ctrlBtn.classList.remove('active');
    altBtn.classList.remove('active');
  }

  return { toolbar, getModifiers, clearModifiers };
}
