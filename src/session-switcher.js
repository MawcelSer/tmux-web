/**
 * Session/Window switcher panel logic.
 */

const SESSION_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f85149',
  '#39d353', '#79c0ff', '#d2a8ff', '#ff7b72', '#e3b341',
];

function sessionColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return SESSION_COLORS[Math.abs(hash) % SESSION_COLORS.length];
}

export function createSessionSwitcher({ panel, list, title, closeBtn, sessionsBtn, windowsBtn, currentLabel, onSwitch, onNewWindow, onNewSession, onKillSession, onKillWindow }) {
  let currentSession = '';

  function hide() {
    panel.classList.add('hidden');
  }

  function show() {
    panel.classList.remove('hidden');
  }

  closeBtn.addEventListener('click', hide);

  sessionsBtn.addEventListener('click', async () => {
    title.textContent = 'Sessions';
    show();
    await loadSessions();
  });

  windowsBtn.addEventListener('click', async () => {
    if (!currentSession) return;
    title.textContent = `Windows — ${currentSession}`;
    show();
    await loadWindows(currentSession);
  });

  /**
   * Attach long-press behavior to a list item.
   * After 500ms hold, shows the kill button and hides the badge.
   */
  function attachLongPress(li, badgeSpan, killBtn) {
    let pressTimer = null;

    li.addEventListener('touchstart', (e) => {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        killBtn.classList.remove('hidden');
        badgeSpan.classList.add('hidden');
        if (navigator.vibrate) navigator.vibrate(30);
      }, 500);
    }, { passive: true });

    li.addEventListener('touchmove', () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }, { passive: true });

    li.addEventListener('touchend', () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }, { passive: true });

    // Tapping the row when kill is visible → dismiss
    li.addEventListener('click', (e) => {
      if (!killBtn.classList.contains('hidden') && e.target !== killBtn) {
        killBtn.classList.add('hidden');
        badgeSpan.classList.remove('hidden');
        e.stopPropagation();
      }
    });
  }

  async function loadSessions() {
    list.innerHTML = '<li>Loading...</li>';
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      list.innerHTML = '';

      // "+ New Session" button at top
      const newSessLi = document.createElement('li');
      newSessLi.className = 'switcher-new-session';
      newSessLi.innerHTML = '<span>+ New Session</span>';
      newSessLi.addEventListener('click', () => {
        newSessLi.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'switcher-input';
        input.placeholder = 'Session name...';
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');

        const createBtn = document.createElement('button');
        createBtn.className = 'switcher-confirm-btn';
        createBtn.textContent = 'Create';

        newSessLi.appendChild(input);
        newSessLi.appendChild(createBtn);
        input.focus();

        function submitNewSession() {
          const name = input.value.trim();
          if (!name || !/^[\w\-. ]+$/.test(name)) {
            input.style.borderColor = '#f85149';
            return;
          }
          onNewSession(name);
          hide();
        }

        createBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          submitNewSession();
        });

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitNewSession();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            loadSessions();
          }
        });

        input.addEventListener('click', (e) => e.stopPropagation());
      });
      list.appendChild(newSessLi);

      if (data.sessions.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No tmux sessions';
        list.appendChild(li);
        return;
      }
      for (const sess of data.sessions) {
        const li = document.createElement('li');

        const contentSpan = document.createElement('span');
        contentSpan.innerHTML = `${esc(sess.name)} <small>(${sess.windows} win)</small>`;

        const badgeSpan = document.createElement('span');
        badgeSpan.className = `badge ${sess.attached ? 'attached' : ''}`;
        badgeSpan.textContent = sess.attached ? 'attached' : 'detached';

        const killBtn = document.createElement('button');
        killBtn.className = 'switcher-kill-btn hidden';
        killBtn.textContent = 'Kill';

        li.appendChild(contentSpan);
        li.appendChild(badgeSpan);
        li.appendChild(killBtn);

        const isCurrentSession = sess.name === currentSession;

        killBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          onKillSession(sess.name, isCurrentSession);
          hide();
        });

        contentSpan.addEventListener('click', () => {
          if (!killBtn.classList.contains('hidden')) return;
          setCurrentSession(sess.name);
          onSwitch(sess.name, null);
          hide();
        });

        attachLongPress(li, badgeSpan, killBtn);
        list.appendChild(li);
      }
    } catch {
      list.innerHTML = '<li>Error loading sessions</li>';
    }
  }

  async function loadWindows(session) {
    list.innerHTML = '<li>Loading...</li>';
    try {
      const res = await fetch(`/api/windows/${encodeURIComponent(session)}`);
      const data = await res.json();
      list.innerHTML = '';

      // "New Window" button at the top
      const newWinLi = document.createElement('li');
      newWinLi.className = 'switcher-new-window';
      newWinLi.innerHTML = '<span>+ New Window</span>';
      newWinLi.addEventListener('click', () => {
        onNewWindow(session);
        hide();
      });
      list.appendChild(newWinLi);

      if (data.windows.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No windows';
        list.appendChild(li);
        return;
      }
      for (const win of data.windows) {
        const li = document.createElement('li');

        const contentSpan = document.createElement('span');
        contentSpan.innerHTML = `${win.index}: ${esc(win.name)}`;

        const badgeSpan = document.createElement('span');
        badgeSpan.className = `badge ${win.active ? 'attached' : ''}`;
        badgeSpan.textContent = win.active ? 'active' : '';

        const killBtn = document.createElement('button');
        killBtn.className = 'switcher-kill-btn hidden';
        killBtn.textContent = 'Kill';

        li.appendChild(contentSpan);
        li.appendChild(badgeSpan);
        li.appendChild(killBtn);

        killBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          onKillWindow(session, win.index);
          hide();
        });

        contentSpan.addEventListener('click', () => {
          if (!killBtn.classList.contains('hidden')) return;
          onSwitch(session, win.index);
          hide();
        });

        attachLongPress(li, badgeSpan, killBtn);
        list.appendChild(li);
      }
    } catch {
      list.innerHTML = '<li>Error loading windows</li>';
    }
  }

  function setCurrentSession(name) {
    currentSession = name;
    currentLabel.textContent = name || '—';
    currentLabel.style.color = name ? sessionColor(name) : '#8b949e';
    currentLabel.style.fontWeight = name ? '600' : 'normal';
  }

  return {
    setCurrentSession,
    hide,
    show,
    loadSessions,
    loadWindows,
    get _currentSession() { return currentSession; },
  };
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
