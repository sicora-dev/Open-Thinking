/**
 * SQLite-backed context store with namespaced keys, TTL, and policy-aware access.
 * Uses bun:sqlite in Bun-powered development/tests and better-sqlite3 in the
 * published Node CLI so installs from npm, pnpm, or bun all work.
 */
import { createRequire } from "node:module";
import { ContextError } from "../../shared/errors";
import { type Result, err, ok } from "../../shared/result";
import type { ContextEntry, ContextStore } from "../../shared/types";

type SQLiteStatement = {
  get(params?: Record<string, unknown>): unknown;
  all(params?: Record<string, unknown>): unknown[];
  run(params?: Record<string, unknown>): unknown;
};

type SQLiteDatabase = {
  prepare(sql: string): SQLiteStatement;
  close(): void;
};

type SQLiteDatabaseConstructor = new (path: string) => SQLiteDatabase;

const runtimeRequire = createRequire(import.meta.url);
const Database = (
  process.versions.bun
    ? runtimeRequire("bun:sqlite").Database
    : runtimeRequire("better-sqlite3")
) as SQLiteDatabaseConstructor;

export type ContextStoreConfig = {
  /** Path to SQLite database file. Use ":memory:" for in-memory store. */
  dbPath: string;
  /** Default TTL for entries, in milliseconds. Undefined means no expiration. */
  defaultTtlMs?: number;
};

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS context_entries (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
  )
`;

const UPSERT_SQL = `
  INSERT INTO context_entries (key, value, created_by, created_at, expires_at)
  VALUES ($key, $value, $created_by, $created_at, $expires_at)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    created_by = excluded.created_by,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at
`;

const SELECT_SQL = "SELECT * FROM context_entries WHERE key = $key";
const DELETE_SQL = "DELETE FROM context_entries WHERE key = $key";
const LIST_SQL = "SELECT * FROM context_entries WHERE key LIKE $prefix";
const LIST_ALL_SQL = "SELECT * FROM context_entries";
const CLEAR_SQL = "DELETE FROM context_entries";
const PURGE_EXPIRED_SQL =
  "DELETE FROM context_entries WHERE expires_at IS NOT NULL AND expires_at < $now";

type Row = {
  key: string;
  value: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
};

function rowToEntry(row: Row): ContextEntry {
  return {
    key: row.key,
    value: row.value,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
  };
}

function isExpired(row: Row): boolean {
  if (!row.expires_at) return false;
  return new Date(row.expires_at).getTime() < Date.now();
}

export function createContextStore(config: ContextStoreConfig): ContextStore & {
  inspect(): Result<ContextEntry[]>;
  purgeExpired(): Result<number>;
  close(): void;
} {
  const { dbPath, defaultTtlMs } = config;
  const db = new Database(dbPath);
  db.prepare("PRAGMA journal_mode = WAL").run();
  db.prepare(CREATE_TABLE_SQL).run();

  const stmtUpsert = db.prepare(UPSERT_SQL);
  const stmtSelect = db.prepare(SELECT_SQL);
  const stmtDelete = db.prepare(DELETE_SQL);
  const stmtList = db.prepare(LIST_SQL);
  const stmtListAll = db.prepare(LIST_ALL_SQL);
  const stmtClear = db.prepare(CLEAR_SQL);
  const stmtPurgeExpired = db.prepare(PURGE_EXPIRED_SQL);

  async function get(key: string): Promise<Result<ContextEntry | null>> {
    try {
      const row = stmtSelect.get({ $key: key }) as Row | null;
      if (!row) return ok(null);
      if (isExpired(row)) {
        stmtDelete.run({ $key: key });
        return ok(null);
      }
      return ok(rowToEntry(row));
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "READ_ERROR", key));
    }
  }

  async function set(key: string, value: string, createdBy: string): Promise<Result<void>> {
    try {
      const now = new Date().toISOString();
      const expiresAt = defaultTtlMs ? new Date(Date.now() + defaultTtlMs).toISOString() : null;
      stmtUpsert.run({
        $key: key,
        $value: value,
        $created_by: createdBy,
        $created_at: now,
        $expires_at: expiresAt,
      });
      return ok(undefined);
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "WRITE_ERROR", key));
    }
  }

  async function del(key: string): Promise<Result<void>> {
    try {
      stmtDelete.run({ $key: key });
      return ok(undefined);
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "WRITE_ERROR", key));
    }
  }

  async function list(prefix?: string): Promise<Result<ContextEntry[]>> {
    try {
      const rows = (prefix ? stmtList.all({ $prefix: `${prefix}%` }) : stmtListAll.all()) as Row[];
      const entries = rows.filter((r) => !isExpired(r)).map(rowToEntry);
      return ok(entries);
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "READ_ERROR"));
    }
  }

  async function clear(): Promise<Result<void>> {
    try {
      stmtClear.run();
      return ok(undefined);
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "WRITE_ERROR"));
    }
  }

  function inspect(): Result<ContextEntry[]> {
    try {
      const rows = stmtListAll.all() as Row[];
      return ok(rows.map(rowToEntry));
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "READ_ERROR"));
    }
  }

  function purgeExpired(): Result<number> {
    try {
      stmtPurgeExpired.run({ $now: new Date().toISOString() });
      const result = db.prepare("SELECT changes() as c").get() as { c: number };
      return ok(result.c);
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "WRITE_ERROR"));
    }
  }

  function close(): void {
    db.close();
  }

  return {
    get,
    set,
    delete: del,
    list,
    clear,
    inspect,
    purgeExpired,
    close,
  };
}
