import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = process.env.SQLITE_PATH ?? path.resolve(process.cwd(), 'data.sqlite');

// Singleton
let _db: Database.Database | null = null;

export function db() {
  if (_db) return _db;
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      status TEXT NOT NULL,
      mint TEXT NOT NULL,
      stake INTEGER NOT NULL,
      creatorPubkey TEXT NOT NULL,
      joinerPubkey TEXT,
      winnerPubkey TEXT,
      creatorDepositTx TEXT,
      joinerDepositTx TEXT,
      settleTx TEXT,
      serverSeed TEXT,
      serverFlip INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_matches_createdAt ON matches(createdAt DESC);
  `);

  return _db;
}

export function cuid() {
  // good-enough id for MVP
  return 'm_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
