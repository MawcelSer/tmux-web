/**
 * Decide which session the UI should switch to after fetching the list.
 * Returns null to keep the current session (or when nothing is available).
 *
 * @param {{name: string, attached: boolean}[]} sessions
 * @param {string} current - currently selected session ("" if none)
 */
export function pickSession(sessions, current) {
  if (sessions.length === 0) return null;
  if (current && sessions.some((s) => s.name === current)) return null;
  const attached = sessions.find((s) => s.attached);
  return (attached ?? sessions[0]).name;
}
