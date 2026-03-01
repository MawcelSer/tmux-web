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
 * Create and mount the toolbar DOM.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {(seq: string) => void} opts.onKey - called with the escape sequence to send
 * @param {() => void} opts.onIncrease - font size increase
 * @param {() => void} opts.onDecrease - font size decrease
 */
export function createToolbar(container, { onKey, onIncrease, onDecrease }) {
  let prefixMode = false;

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  function renderButtons() {
    toolbar.innerHTML = '';

    if (prefixMode) {
      // Show tmux prefix keys
      const label = document.createElement('span');
      label.className = 'toolbar-prefix-label';
      label.textContent = 'Prefix:';
      toolbar.appendChild(label);

      for (const key of TMUX_PREFIX_KEYS) {
        const btn = makeButton(key, () => {
          onKey(key);
          prefixMode = false;
          renderButtons();
        });
        toolbar.appendChild(btn);
      }

      const cancel = makeButton('✕', () => {
        prefixMode = false;
        renderButtons();
      });
      cancel.classList.add('toolbar-cancel');
      toolbar.appendChild(cancel);
    } else {
      // Standard toolbar
      const ctrlB = makeButton('Ctrl+b', () => {
        onKey(KEYS['Ctrl+b']);
        prefixMode = true;
        renderButtons();
      });
      ctrlB.classList.add('toolbar-prefix-btn');
      toolbar.appendChild(ctrlB);

      for (const key of ['Esc', 'Tab', '←', '↑', '↓', '→', 'PgUp', 'PgDn']) {
        toolbar.appendChild(makeButton(key, () => onKey(KEYS[key])));
      }
      for (const key of ['Ctrl+C', 'Ctrl+D', 'Ctrl+Z']) {
        toolbar.appendChild(makeButton(key, () => onKey(KEYS[key])));
      }

      // Font size controls
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
