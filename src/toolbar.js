/** Key label → escape sequence mapping for the mobile toolbar. */
export const KEYS = {
  'Ctrl+b': '\x02',
  'Esc': '\x1b',
  'Tab': '\t',
  '↑': '\x1b[A',
  '↓': '\x1b[B',
  '→': '\x1b[C',
  '←': '\x1b[D',
  'PgUp': '\x1b[5~',
  'PgDn': '\x1b[6~',
  'Home': '\x1b[H',
  'End': '\x1b[F',
  'Ctrl+C': '\x03',
  'Ctrl+D': '\x04',
  'Ctrl+Z': '\x1a',
};

/** Tmux prefix keys (shown after Ctrl+b is pressed). */
export const TMUX_PREFIX_KEYS = ['%', '"', 'd', 'n', 'p', '[', ']', 'c', 'z', 'x', '&', ',', 's', 'w'];

/** Get the escape sequence or literal character for a key label. */
export function getKeySequence(label) {
  if (KEYS[label] !== undefined) return KEYS[label];
  if (TMUX_PREFIX_KEYS.includes(label)) return label;
  return undefined;
}

/**
 * Create and mount the toolbar DOM — compact, single-row, scrollable,
 * styled like JuiceSSH / Termius extra-keys bar.
 */
export function createToolbar(container, { onKey, onIncrease, onDecrease }) {
  let prefixMode = false;

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  function sep() {
    const s = document.createElement('span');
    s.className = 'toolbar-sep';
    return s;
  }

  function renderButtons() {
    toolbar.innerHTML = '';

    if (prefixMode) {
      const label = document.createElement('span');
      label.className = 'toolbar-prefix-label';
      label.textContent = 'C-b';
      toolbar.appendChild(label);

      for (const key of TMUX_PREFIX_KEYS) {
        toolbar.appendChild(makeButton(key, () => {
          onKey(key);
          prefixMode = false;
          renderButtons();
        }));
      }

      toolbar.appendChild(sep());
      const cancel = makeButton('ESC', () => {
        prefixMode = false;
        renderButtons();
      });
      cancel.classList.add('toolbar-cancel', 'toolbar-btn-wide');
      toolbar.appendChild(cancel);
    } else {
      // Prefix toggle
      const ctrlB = makeButton('C-b', () => {
        onKey(KEYS['Ctrl+b']);
        prefixMode = true;
        renderButtons();
      }, 'toolbar-prefix-btn toolbar-btn-wide');
      toolbar.appendChild(ctrlB);

      toolbar.appendChild(sep());

      // Navigation
      for (const key of ['Esc', 'Tab']) {
        toolbar.appendChild(makeButton(key, () => onKey(KEYS[key]), 'toolbar-btn-wide'));
      }

      toolbar.appendChild(sep());

      // Arrows
      for (const key of ['←', '↑', '↓', '→']) {
        toolbar.appendChild(makeButton(key, () => onKey(KEYS[key]), 'toolbar-btn-arrow'));
      }

      toolbar.appendChild(sep());

      // Page nav
      for (const key of ['PgUp', 'PgDn']) {
        toolbar.appendChild(makeButton(key, () => onKey(KEYS[key]), 'toolbar-btn-wide'));
      }

      toolbar.appendChild(sep());

      // Ctrl combos
      toolbar.appendChild(makeButton('C-c', () => onKey(KEYS['Ctrl+C']), 'toolbar-btn-wide'));
      toolbar.appendChild(makeButton('C-d', () => onKey(KEYS['Ctrl+D']), 'toolbar-btn-wide'));
      toolbar.appendChild(makeButton('C-z', () => onKey(KEYS['Ctrl+Z']), 'toolbar-btn-wide'));

      toolbar.appendChild(sep());

      // Font size
      toolbar.appendChild(makeButton('A-', onDecrease, 'toolbar-font'));
      toolbar.appendChild(makeButton('A+', onIncrease, 'toolbar-font'));
    }
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

  renderButtons();
  container.appendChild(toolbar);

  return { toolbar };
}
