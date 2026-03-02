// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionSwitcher } from '../src/session-switcher.js';

function makeEl(tag = 'div') {
  const el = document.createElement(tag);
  el.classList.add = vi.fn();
  el.classList.remove = vi.fn();
  el.classList.contains = vi.fn(() => false);
  return el;
}

function makeDom() {
  return {
    panel: makeEl(),
    list: document.createElement('ul'),
    title: document.createElement('div'),
    closeBtn: document.createElement('button'),
    sessionsBtn: document.createElement('button'),
    windowsBtn: document.createElement('button'),
    currentLabel: document.createElement('span'),
  };
}

describe('createSessionSwitcher', () => {
  let dom;
  let switcher;
  const callbacks = {
    onSwitch: vi.fn(),
    onNewWindow: vi.fn(),
    onNewSession: vi.fn(),
    onKillSession: vi.fn(),
    onKillWindow: vi.fn(),
  };

  beforeEach(() => {
    dom = makeDom();
    vi.resetAllMocks();
    switcher = createSessionSwitcher({ ...dom, ...callbacks });
  });

  describe('getCurrentSession / setCurrentSession', () => {
    it('returns empty string initially', () => {
      expect(switcher.getCurrentSession()).toBe('');
    });

    it('returns the session after setCurrentSession', () => {
      switcher.setCurrentSession('mydev');
      expect(switcher.getCurrentSession()).toBe('mydev');
    });

    it('updates currentLabel text', () => {
      switcher.setCurrentSession('prod');
      expect(dom.currentLabel.textContent).toBe('prod');
    });

    it('shows dash when name is empty', () => {
      switcher.setCurrentSession('');
      expect(dom.currentLabel.textContent).toBe('—');
    });
  });

  describe('hide / show', () => {
    it('hide adds hidden class', () => {
      switcher.hide();
      expect(dom.panel.classList.add).toHaveBeenCalledWith('hidden');
    });

    it('show removes hidden class', () => {
      switcher.show();
      expect(dom.panel.classList.remove).toHaveBeenCalledWith('hidden');
    });
  });

  describe('loadSessions', () => {
    it('renders session items from API', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          sessions: [
            { name: 'dev', windows: 2, attached: true },
            { name: 'prod', windows: 1, attached: false },
          ],
        }),
      });

      await switcher.loadSessions();

      const items = dom.list.querySelectorAll('li');
      // First li is "+ New Session", then one per session
      expect(items.length).toBe(3);
      expect(items[1].textContent).toContain('dev (2 win)');
      expect(items[2].textContent).toContain('prod (1 win)');
    });

    it('shows error on fetch failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
      await switcher.loadSessions();
      expect(dom.list.innerHTML).toContain('Error loading sessions');
    });

    it('shows "No tmux sessions" when empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ sessions: [] }),
      });
      await switcher.loadSessions();
      expect(dom.list.textContent).toContain('No tmux sessions');
    });
  });

  describe('loadWindows', () => {
    it('renders window items from API', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          windows: [
            { index: 0, name: 'bash', active: true },
            { index: 1, name: 'vim', active: false },
          ],
        }),
      });

      await switcher.loadWindows('dev');

      const items = dom.list.querySelectorAll('li');
      // First is "+ New Window", then one per window
      expect(items.length).toBe(3);
      expect(items[1].textContent).toContain('0: bash');
      expect(items[2].textContent).toContain('1: vim');
    });

    it('shows error on fetch failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
      await switcher.loadWindows('dev');
      expect(dom.list.innerHTML).toContain('Error loading windows');
    });
  });

  describe('XSS safety', () => {
    it('session names with HTML are rendered as text, not HTML', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          sessions: [{ name: '<script>alert(1)</script>', windows: 1, attached: false }],
        }),
      });

      await switcher.loadSessions();

      const items = dom.list.querySelectorAll('li');
      // The session name should be in textContent, not interpreted as HTML
      expect(items[1].textContent).toContain('<script>alert(1)</script>');
      expect(dom.list.innerHTML).not.toContain('<script>alert(1)</script>');
    });
  });
});
