// One request-local snapshot. D1 owns durability and the compare-and-swap commit.
// This store never survives a request and cannot be a source of truth by itself.
export class RoomStore {
  constructor(code, row) {
    this.rows = new Map(); this.sessions = new Map(); this.dirty = false;
    if (row) {
      this.rows.set(code, { data: row.data, expires_at: row.expires_at });
      for (const [token, value] of Object.entries(JSON.parse(row.sessions))) this.sessions.set(token, value);
    }
  }
  all() { return [...this.rows.values()]; }
  transaction(fn) {
    const rows = structuredClone(this.rows), sessions = structuredClone(this.sessions), dirty = this.dirty;
    try { return fn(); } catch (e) { this.rows = rows; this.sessions = sessions; this.dirty = dirty; throw e; }
  }
  cleanup(now) { let n = 0; for (const [code, row] of this.rows) if (row.expires_at <= now) { this.rows.delete(code); n++; } return n; }
  close() {}
  get(code) { return this.rows.get(code); }
  save(code, data, expires_at) { this.rows.set(code, { data, expires_at }); this.dirty = true; }
  insert(code, data, expires_at) { this.save(code, data, expires_at); }
  count() { return this.rows.size; }
  has(code) { return this.rows.has(code); }
  addSession(token, code, member_id, csrf) { this.sessions.set(token, { room_code: code, member_id, csrf }); this.dirty = true; }
  findSession(code, token) { const session = this.sessions.get(token); return session?.room_code === code ? session : undefined; }
  deleteSessions(code, member) { for (const [token, session] of this.sessions) if (session.room_code === code && session.member_id === member) this.sessions.delete(token); this.dirty = true; }
  record(code) { return { ...this.get(code), sessions: JSON.stringify(Object.fromEntries(this.sessions)) }; }
}
