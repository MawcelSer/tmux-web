/**
 * Session/Window switcher panel logic.
 */
export function createSessionSwitcher({ panel, list, title, closeBtn, sessionsBtn, windowsBtn, currentLabel, onSwitch }) {
  let currentSession = '';
  let mode = 'sessions'; // 'sessions' | 'windows'

  function hide() {
    panel.classList.add('hidden');
  }

  function show() {
    panel.classList.remove('hidden');
  }

  closeBtn.addEventListener('click', hide);

  sessionsBtn.addEventListener('click', async () => {
    mode = 'sessions';
    title.textContent = 'Sessions';
    show();
    await loadSessions();
  });

  windowsBtn.addEventListener('click', async () => {
    if (!currentSession) return;
    mode = 'windows';
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
          <span>${sess.name} <small>(${sess.windows} win)</small></span>
          <span class="badge ${sess.attached ? 'attached' : ''}">${sess.attached ? 'attached' : 'detached'}</span>
        `;
        li.addEventListener('click', async () => {
          setCurrentSession(sess.name);
          mode = 'windows';
          title.textContent = `Windows — ${sess.name}`;
          await loadWindows(sess.name);
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
      if (data.windows.length === 0) {
        list.innerHTML = '<li>No windows</li>';
        return;
      }
      for (const win of data.windows) {
        const li = document.createElement('li');
        li.innerHTML = `
          <span>${win.index}: ${win.name}</span>
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
  }

  return { setCurrentSession, hide, show, loadSessions, loadWindows };
}
