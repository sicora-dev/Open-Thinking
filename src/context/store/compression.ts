/**
 * Transparent compression for context store entries.
 *
 * Uses Node.js built-in zlib (gzip) to compress entries larger than a
 * configurable threshold. Compressed values are stored as base64-encoded
 * strings with a magic prefix so the reader knows to decompress.
 *
 * The compression is fully transparent to callers — they always see
 * plain-text values via get/list/inspect.
 */
import { gunzipSync, gzipSync } from "node:zlib";

/** Entries smaller than this (bytes) are stored uncompressed. */
export const COMPRESSION_THRESHOLD = 4096;

/**
 * Magic prefix prepended to compressed values so the reader can
 * distinguish them from plain text without needing a schema column.
 * Chosen to be highly unlikely in real context data.
 */
const COMPRESSED_PREFIX = "\x00GZ:";

/** Compress a value if it exceeds the threshold. Returns the (possibly compressed) string. */
export function maybeCompress(value: string): { stored: string; compressed: boolean; rawSize: number } {
  const rawSize = Buffer.byteLength(value, "utf-8");
  if (rawSize <= COMPRESSION_THRESHOLD) {
    return { stored: value, compressed: false, rawSize };
  }

  const compressed = gzipSync(Buffer.from(value, "utf-8"), { level: 6 });
  const encoded = COMPRESSED_PREFIX + compressed.toString("base64");

  // Only use compressed form if it's actually smaller
  if (Buffer.byteLength(encoded, "utf-8") >= rawSize) {
    return { stored: value, compressed: false, rawSize };
  }

  return { stored: encoded, compressed: true, rawSize };
}

/** Decompress a value if it was compressed, otherwise return as-is. */
export function maybeDecompress(stored: string): string {
  if (!stored.startsWith(COMPRESSED_PREFIX)) {
    return stored;
  }

  const base64 = stored.slice(COMPRESSED_PREFIX.length);
  const buffer = gunzipSync(Buffer.from(base64, "base64"));
  return buffer.toString("utf-8");
}

/** Check whether a stored value is compressed. */
export function isCompressed(stored: string): boolean {
  return stored.startsWith(COMPRESSED_PREFIX);
}

export type CompressionStats = {
  totalEntries: number;
  compressedEntries: number;
  totalRawBytes: number;
  totalStoredBytes: number;
  savedBytes: number;
  ratio: number;
};

/**
 * Calculate compression stats from a list of stored values.
 * Each entry needs its raw value (decompressed) and stored value.
 */
export function computeCompressionStats(
  entries: Array<{ stored: string; raw: string }>,
): CompressionStats {
  let compressedEntries = 0;
  let totalRawBytes = 0;
  let totalStoredBytes = 0;

  for (const entry of entries) {
    const rawSize = Buffer.byteLength(entry.raw, "utf-8");
    const storedSize = Buffer.byteLength(entry.stored, "utf-8");
    totalRawBytes += rawSize;
    totalStoredBytes += storedSize;
    if (isCompressed(entry.stored)) compressedEntries++;
  }

  const savedBytes = totalRawBytes - totalStoredBytes;
  const ratio = totalRawBytes > 0 ? totalStoredBytes / totalRawBytes : 1;

  return {
    totalEntries: entries.length,
    compressedEntries,
    totalRawBytes,
    totalStoredBytes,
    savedBytes,
    ratio,
  };
}
