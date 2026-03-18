/**
 * Structured logger for OpenMind.
 * Outputs JSON in production, pretty-printed in development.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
};

let currentLevel: LogLevel = "info";

export const setLogLevel = (level: LogLevel): void => {
  currentLevel = level;
};

const shouldLog = (level: LogLevel): boolean => LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];

const isDev = (): boolean =>
  (typeof Bun !== "undefined" ? Bun.env.NODE_ENV : process.env.NODE_ENV) !== "production";

const formatEntry = (entry: LogEntry): string => {
  if (isDev()) {
    const prefix = {
      debug: "\x1b[90m[DEBUG]\x1b[0m",
      info: "\x1b[36m[INFO]\x1b[0m",
      warn: "\x1b[33m[WARN]\x1b[0m",
      error: "\x1b[31m[ERROR]\x1b[0m",
    }[entry.level];
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    return `${prefix} ${entry.message}${ctx}`;
  }
  return JSON.stringify(entry);
};

const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
  if (!shouldLog(level)) return;
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context && { context }),
  };
  const output = formatEntry(entry);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
};

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
};
