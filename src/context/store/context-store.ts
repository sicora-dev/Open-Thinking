/**
 * SQLite-backed context store with namespaced keys, TTL, and policy-aware access.
 * Uses bun:sqlite in Bun-powered development/tests and better-sqlite3 in the
 * published Node CLI so installs from npm, pnpm, or bun all work.
 *
 * Entries larger than COMPRESSION_THRESHOLD are transparently compressed with
 * gzip to reduce storage and context-window cost for long-running pipelines.
 */
import { createRequire } from "node:module";
import { ContextError } from "../../shared/errors";
import { type Result, err, ok } from "../../shared/result";
import type { ContextEntry, ContextStore } from "../../shared/types";
import {
  type CompressionStats,
  computeCompressionStats,
  maybeCompress,
  maybeDecompress,
} from "./compression";

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

const CREATE_SNAPSHOTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    entry_count INTEGER NOT NULL,
    data TEXT NOT NULL
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

// Snapshot SQL
const INSERT_SNAPSHOT_SQL = `
  INSERT INTO context_snapshots (id, name, description, created_at, created_by, entry_count, data)
  VALUES ($id, $name, $description, $created_at, $created_by, $entry_count, $data)
`;
const SELECT_SNAPSHOT_SQL = "SELECT * FROM context_snapshots WHERE id = $id";
const LIST_SNAPSHOTS_SQL = "SELECT id, name, description, created_at, created_by, entry_count FROM context_snapshots ORDER BY created_at DESC";
const DELETE_SNAPSHOT_SQL = "DELETE FROM context_snapshots WHERE id = $id";

export type ContextSnapshot = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  createdBy: string;
  entryCount: number;
};

export type ContextSnapshotFull = ContextSnapshot & {
  entries: Array<{ key: string; value: string; createdBy: string }>;
};

type SnapshotRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  created_by: string;
  entry_count: number;
  data?: string;
};

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
    value: maybeDecompress(row.value),
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
  compressionStats(): Result<CompressionStats>;
  close(): void;
  /** Save a snapshot of the current context state. */
  saveSnapshot(name: string, createdBy: string, description?: string): Result<ContextSnapshot>;
  /** Restore context from a snapshot (replaces current entries). */
  restoreSnapshot(snapshotId: string): Result<{ restored: number }>;
  /** List all snapshots (metadata only). */
  listSnapshots(): Result<ContextSnapshot[]>;
  /** Delete a snapshot by ID. */
  deleteSnapshot(snapshotId: string): Result<boolean>;
  /** Get a snapshot with its full entry data. */
  getSnapshot(snapshotId: string): Result<ContextSnapshotFull | null>;
} {
  const { dbPath, defaultTtlMs } = config;
  const db = new Database(dbPath);
  db.prepare("PRAGMA journal_mode = WAL").run();
  db.prepare(CREATE_TABLE_SQL).run();
  db.prepare(CREATE_SNAPSHOTS_TABLE_SQL).run();

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
      const { stored } = maybeCompress(value);
      stmtUpsert.run({
        $key: key,
        $value: stored,
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

  // ─── Snapshot methods ───────────────────────────────────

  const stmtInsertSnapshot = db.prepare(INSERT_SNAPSHOT_SQL);
  const stmtSelectSnapshot = db.prepare(SELECT_SNAPSHOT_SQL);
  const stmtListSnapshots = db.prepare(LIST_SNAPSHOTS_SQL);
  const stmtDeleteSnapshot = db.prepare(DELETE_SNAPSHOT_SQL);

  function saveSnapshot(
    name: string,
    createdBy: string,
    description?: string,
  ): Result<ContextSnapshot> {
    try {
      const rows = stmtListAll.all() as Row[];
      const entries = rows.filter((r) => !isExpired(r)).map((r) => ({
        key: r.key,
        value: maybeDecompress(r.value),
        createdBy: r.created_by,
      }));

      const id = crypto.randomUUID().slice(0, 8);
      const now = new Date().toISOString();

      stmtInsertSnapshot.run({
        $id: id,
        $name: name,
        $description: description ?? null,
        $created_at: now,
        $created_by: createdBy,
        $entry_count: entries.length,
        $data: JSON.stringify(entries),
      });

      return ok({ id, name, description, createdAt: now, createdBy, entryCount: entries.length });
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "WRITE_ERROR"));
    }
  }

  function restoreSnapshot(snapshotId: string): Result<{ restored: number }> {
    try {
      const row = stmtSelectSnapshot.get({ $id: snapshotId }) as SnapshotRow | null;
      if (!row) return err(new ContextError(`Snapshot not found: ${snapshotId}`, "READ_ERROR"));

      const entries = JSON.parse(row.data!) as Array<{ key: string; value: string; createdBy: string }>;

      // Clear current context and restore from snapshot
      stmtClear.run();
      const now = new Date().toISOString();
      for (const entry of entries) {
        const { stored } = maybeCompress(entry.value);
        stmtUpsert.run({
          $key: entry.key,
          $value: stored,
          $created_by: entry.createdBy,
          $created_at: now,
          $expires_at: defaultTtlMs ? new Date(Date.now() + defaultTtlMs).toISOString() : null,
        });
      }

      return ok({ restored: entries.length });
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "READ_ERROR"));
    }
  }

  function listSnapshots(): Result<ContextSnapshot[]> {
    try {
      const rows = stmtListSnapshots.all() as SnapshotRow[];
      return ok(rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? undefined,
        createdAt: r.created_at,
        createdBy: r.created_by,
        entryCount: r.entry_count,
      })));
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "READ_ERROR"));
    }
  }

  function deleteSnapshot(snapshotId: string): Result<boolean> {
    try {
      stmtDeleteSnapshot.run({ $id: snapshotId });
      const result = db.prepare("SELECT changes() as c").get() as { c: number };
      return ok(result.c > 0);
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "WRITE_ERROR"));
    }
  }

  function getSnapshot(snapshotId: string): Result<ContextSnapshotFull | null> {
    try {
      const row = stmtSelectSnapshot.get({ $id: snapshotId }) as SnapshotRow | null;
      if (!row) return ok(null);
      const entries = JSON.parse(row.data!) as Array<{ key: string; value: string; createdBy: string }>;
      return ok({
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        createdAt: row.created_at,
        createdBy: row.created_by,
        entryCount: row.entry_count,
        entries,
      });
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "READ_ERROR"));
    }
  }

  function compressionStats(): Result<CompressionStats> {
    try {
      const rows = stmtListAll.all() as Row[];
      const pairs = rows.map((row) => ({
        stored: row.value,
        raw: maybeDecompress(row.value),
      }));
      return ok(computeCompressionStats(pairs));
    } catch (e) {
      return err(new ContextError(e instanceof Error ? e.message : String(e), "READ_ERROR"));
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
    compressionStats,
    close,
    saveSnapshot,
    restoreSnapshot,
    listSnapshots,
    deleteSnapshot,
    getSnapshot,
  };
}
