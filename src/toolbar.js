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
 * Two-row layout matching JuiceSSH / Termux extra-keys:
 *   Row 1: ESC  /  -  HOME  ↑  END  PGUP  |  _  ~  A-  A+
 *   Row 2: TAB  CTRL  ALT  ←  ↓  →  PGDN
 */
export function createToolbar(container, { onKey, onIncrease, onDecrease }) {
  let ctrlActive = false;
  let altActive = false;

  const wrapper = document.createElement('div');
  wrapper.className = 'toolbar-wrapper';

  const row1 = document.createElement('div');
  row1.className = 'toolbar toolbar-row';

  const row2 = document.createElement('div');
  row2.className = 'toolbar toolbar-row';

  function sep(row) {
    const s = document.createElement('span');
    s.className = 'toolbar-sep';
    row.appendChild(s);
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

  function keyBtn(row, label, extraClass) {
    row.appendChild(makeButton(label, () => onKey(KEYS[label]), extraClass || ''));
  }

  // --- Row 1: ESC  /  -  HOME  ↑  END  PGUP  |  _  ~  A-  A+ ---
  row1.appendChild(makeButton('ESC', () => onKey(KEYS['ESC']), 'toolbar-btn-wide'));
  keyBtn(row1, '/');
  keyBtn(row1, '-');
  sep(row1);
  keyBtn(row1, 'HOME', 'toolbar-btn-wide');
  keyBtn(row1, '↑', 'toolbar-btn-arrow');
  keyBtn(row1, 'END', 'toolbar-btn-wide');
  keyBtn(row1, 'PGUP', 'toolbar-btn-wide');
  sep(row1);
  keyBtn(row1, '|');
  keyBtn(row1, '_');
  keyBtn(row1, '~');
  sep(row1);
  row1.appendChild(makeButton('A-', onDecrease, 'toolbar-font'));
  row1.appendChild(makeButton('A+', onIncrease, 'toolbar-font'));

  // --- Row 2: TAB  CTRL  ALT  ←  ↓  →  PGDN ---
  row2.appendChild(makeButton('TAB', () => onKey(KEYS['TAB']), 'toolbar-btn-wide'));
  sep(row2);

  const ctrlBtn = makeButton('CTRL', () => {
    ctrlActive = !ctrlActive;
    ctrlBtn.classList.toggle('active', ctrlActive);
  }, 'toolbar-mod');
  row2.appendChild(ctrlBtn);

  const altBtn = makeButton('ALT', () => {
    altActive = !altActive;
    altBtn.classList.toggle('active', altActive);
  }, 'toolbar-mod');
  row2.appendChild(altBtn);

  sep(row2);
  keyBtn(row2, '←', 'toolbar-btn-arrow');
  keyBtn(row2, '↓', 'toolbar-btn-arrow');
  keyBtn(row2, '→', 'toolbar-btn-arrow');
  sep(row2);
  keyBtn(row2, 'PGDN', 'toolbar-btn-wide');

  wrapper.appendChild(row1);
  wrapper.appendChild(row2);
  container.appendChild(wrapper);

  function getModifiers() {
    return { ctrl: ctrlActive, alt: altActive };
  }

  function clearModifiers() {
    ctrlActive = false;
    altActive = false;
    ctrlBtn.classList.remove('active');
    altBtn.classList.remove('active');
  }

  return { toolbar: wrapper, getModifiers, clearModifiers };
}
