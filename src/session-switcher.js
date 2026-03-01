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

export function createSessionSwitcher({ panel, list, title, closeBtn, sessionsBtn, windowsBtn, currentLabel, onSwitch, onNewWindow }) {
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

  async function loadSessions() {
    list.innerHTML = '<li>Loading...</li>';
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      list.innerHTML = '';
      if (data.sessions.length === 0) {
        list.innerHTML = '<li>No tmux sessions</li>';
        return;
      }
      for (const sess of data.sessions) {
        const li = document.createElement('li');
        li.innerHTML = `
          <span>${esc(sess.name)} <small>(${sess.windows} win)</small></span>
          <span class="badge ${sess.attached ? 'attached' : ''}">${sess.attached ? 'attached' : 'detached'}</span>
        `;
        li.addEventListener('click', () => {
          setCurrentSession(sess.name);
          onSwitch(sess.name, null);
          hide();
        });
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
        li.innerHTML = `
          <span>${win.index}: ${esc(win.name)}</span>
          <span class="badge ${win.active ? 'attached' : ''}">${win.active ? 'active' : ''}</span>
        `;
        li.addEventListener('click', () => {
          onSwitch(session, win.index);
          hide();
        });
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
