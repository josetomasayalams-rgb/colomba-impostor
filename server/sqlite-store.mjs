import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export class SqliteStore {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, member_id TEXT NOT NULL, csrf TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS sessions_room ON sessions(room_code, member_id);
      CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms(expires_at);`);
    if (path !== ':memory:') chmodSync(path, 0o600);
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  all() { return this.db.prepare('SELECT data FROM rooms').all(); }
  cleanup(now) { return this.db.prepare('DELETE FROM rooms WHERE expires_at <= ?').run(now).changes; }
  close() { this.db.close(); }
  get(code) { return this.db.prepare('SELECT data, expires_at FROM rooms WHERE code = ?').get(code); }
  save(code, data, expiry) { this.db.prepare('UPDATE rooms SET data = ?, expires_at = ? WHERE code = ?').run(data, expiry, code); }
  insert(code, data, expiry) { this.db.prepare('INSERT INTO rooms VALUES (?, ?, ?)').run(code, data, expiry); }
  has(code) { return Boolean(this.db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code)); }
  count() { return this.db.prepare('SELECT count(*) AS n FROM rooms').get().n; }
  addSession(token, code, member, csrf) { this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(token, code, member, csrf); }
  findSession(code, token) { return this.db.prepare('SELECT member_id, csrf FROM sessions WHERE room_code = ? AND token_hash = ?').get(code, token); }
  deleteSessions(code, member) { this.db.prepare('DELETE FROM sessions WHERE room_code = ? AND member_id = ?').run(code, member); }
}
