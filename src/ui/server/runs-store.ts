/**
 * Run history store backed by SQLite (~/.openthk/runs.db).
 *
 * Persists pipeline runs initiated from the UI plus their event stream.
 * The UI uses this for the "Runs" view (history) and to replay events
 * for clients that connect to /api/runs/:id/stream after a run started.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getOpenthkConfigDir } from "../../config/paths";

type SQLiteStatement = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
};

type SQLiteDatabase = {
  prepare(sql: string): SQLiteStatement;
  exec(sql: string): unknown;
  close(): void;
};

type SQLiteDatabaseConstructor = new (path: string) => SQLiteDatabase;

const runtimeRequire = createRequire(import.meta.url);
const Database = (
  process.versions.bun
    ? runtimeRequire("bun:sqlite").Database
    : runtimeRequire("better-sqlite3")
) as SQLiteDatabaseConstructor;

function getRunsDbPath(): string {
  return join(getOpenthkConfigDir(), "runs.db");
}

export type RunStatus = "running" | "success" | "failed" | "cancelled";

export type RunRow = {
  id: string;
  pipelineName: string;
  pipelinePath: string | null;
  input: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  totalTokens: number;
  totalCost: number;
};

export type RunEventRow = {
  id: number;
  runId: string;
  seq: number;
  ts: string;
  type: string;
  payload: string; // JSON
};

let db: SQLiteDatabase | null = null;

function getDb(): SQLiteDatabase {
  if (db) return db;
  const configDir = getOpenthkConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  db = new Database(getRunsDbPath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      pipeline_name TEXT NOT NULL,
      pipeline_path TEXT,
      input TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
  `);
  return db;
}

function rowToRun(row: Record<string, unknown>): RunRow {
  return {
    id: row.id as string,
    pipelineName: row.pipeline_name as string,
    pipelinePath: (row.pipeline_path as string | null) ?? null,
    input: row.input as string,
    status: row.status as RunStatus,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string | null) ?? null,
    totalTokens: (row.total_tokens as number) ?? 0,
    totalCost: (row.total_cost as number) ?? 0,
  };
}

export function createRun(input: {
  id: string;
  pipelineName: string;
  pipelinePath: string | null;
  input: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO runs (id, pipeline_name, pipeline_path, input, status, started_at)
       VALUES (?, ?, ?, ?, 'running', ?)`,
    )
    .run(input.id, input.pipelineName, input.pipelinePath, input.input, new Date().toISOString());
}

export function finalizeRun(
  id: string,
  status: RunStatus,
  totals: { tokens: number; cost: number },
): void {
  getDb()
    .prepare(
      `UPDATE runs SET status = ?, ended_at = ?, total_tokens = ?, total_cost = ? WHERE id = ?`,
    )
    .run(status, new Date().toISOString(), totals.tokens, totals.cost, id);
}

export function appendEvent(runId: string, seq: number, type: string, payload: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO run_events (run_id, seq, ts, type, payload) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(runId, seq, new Date().toISOString(), type, JSON.stringify(payload));
}

export function listRuns(limit = 50): RunRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToRun);
}

export function getRun(id: string): RunRow | null {
  const row = getDb().prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToRun(row) : null;
}

/**
 * Update only the totals (tokens + cost) for a run without changing status/endedAt.
 */
export function updateRunTotals(id: string, totals: { tokens: number; cost: number }): void {
  getDb()
    .prepare(`UPDATE runs SET total_tokens = ?, total_cost = ? WHERE id = ?`)
    .run(totals.tokens, totals.cost, id);
}

export function getRunEvents(runId: string, sinceSeq = 0): RunEventRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, run_id, seq, ts, type, payload FROM run_events
       WHERE run_id = ? AND seq > ? ORDER BY seq ASC`,
    )
    .all(runId, sinceSeq) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    runId: r.run_id as string,
    seq: r.seq as number,
    ts: r.ts as string,
    type: r.type as string,
    payload: r.payload as string,
  }));
}
