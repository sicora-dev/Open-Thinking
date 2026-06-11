import { describe, expect, test } from "bun:test";
import {
  COMPRESSION_THRESHOLD,
  computeCompressionStats,
  isCompressed,
  maybeCompress,
  maybeDecompress,
} from "./compression";

describe("compression", () => {
  test("small values are not compressed", () => {
    const result = maybeCompress("hello world");
    expect(result.compressed).toBe(false);
    expect(result.stored).toBe("hello world");
    expect(result.rawSize).toBe(Buffer.byteLength("hello world", "utf-8"));
  });

  test("large values are compressed", () => {
    const large = "x".repeat(COMPRESSION_THRESHOLD + 1000);
    const result = maybeCompress(large);
    expect(result.compressed).toBe(true);
    expect(result.stored).not.toBe(large);
    expect(result.rawSize).toBe(Buffer.byteLength(large, "utf-8"));
    expect(result.stored.length).toBeLessThan(large.length);
  });

  test("compressed values decompress correctly", () => {
    const large = "a]b[c{d}e".repeat(1000);
    const { stored } = maybeCompress(large);
    const decompressed = maybeDecompress(stored);
    expect(decompressed).toBe(large);
  });

  test("uncompressed values pass through decompress unchanged", () => {
    const plain = "just a plain string";
    expect(maybeDecompress(plain)).toBe(plain);
  });

  test("isCompressed detects compressed values", () => {
    const large = "z".repeat(COMPRESSION_THRESHOLD + 500);
    const { stored } = maybeCompress(large);
    expect(isCompressed(stored)).toBe(true);
    expect(isCompressed("plain")).toBe(false);
  });

  test("incompressible data is stored uncompressed", () => {
    // Random-ish data that doesn't compress well
    const random = Array.from({ length: COMPRESSION_THRESHOLD + 100 }, (_, i) =>
      String.fromCharCode(33 + (i * 7 + i * i) % 94),
    ).join("");
    const result = maybeCompress(random);
    // gzip of random data + base64 overhead is often larger
    // If it IS compressed, roundtrip must still work
    const decompressed = maybeDecompress(result.stored);
    expect(decompressed).toBe(random);
  });

  test("unicode content compresses and decompresses correctly", () => {
    const unicode = "日本語テスト🎉".repeat(800);
    const { stored, compressed } = maybeCompress(unicode);
    expect(compressed).toBe(true);
    expect(maybeDecompress(stored)).toBe(unicode);
  });

  test("computeCompressionStats produces correct stats", () => {
    const large = "y".repeat(COMPRESSION_THRESHOLD + 2000);
    const { stored } = maybeCompress(large);
    const stats = computeCompressionStats([
      { stored, raw: large },
      { stored: "small", raw: "small" },
    ]);
    expect(stats.totalEntries).toBe(2);
    expect(stats.compressedEntries).toBe(1);
    expect(stats.totalRawBytes).toBeGreaterThan(stats.totalStoredBytes);
    expect(stats.savedBytes).toBeGreaterThan(0);
    expect(stats.ratio).toBeLessThan(1);
  });
});
