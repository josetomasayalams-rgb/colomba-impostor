import { SqliteStore } from './sqlite-store.mjs';
import { GameEngineCore } from './engine-core.mjs';
export { GameError, cleanText } from './engine-core.mjs';
export class GameEngine extends GameEngineCore {
  constructor({ dbPath = ':memory:', ...options } = {}) {
    const store = new SqliteStore(dbPath);
    super({ ...options, store });
    this.db = store.db;
  }
}
