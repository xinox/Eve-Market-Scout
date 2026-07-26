import type { SnapshotBatch, StructureSnapshotBatch } from "@eve-market-scout/shared";

/**
 * Swappable storage backend. This is the seam that lets us start with zero
 * infrastructure (JsonFileStore) and later move to Cloudflare D1
 * (HttpIngestStore) without touching collector logic at all — just change
 * STORAGE_MODE and, if needed, write a new adapter implementing this.
 */
export interface MarketStore {
  saveSnapshot(batch: SnapshotBatch): Promise<void>;
}

/** Separate interface rather than folding into MarketStore -- structures
 * and regions have different identity (structureId vs regionId) and are
 * genuinely different data, even though the same store classes below
 * implement both by simply writing to a second table/path. */
export interface StructureMarketStore {
  saveStructureSnapshot(batch: StructureSnapshotBatch): Promise<void>;
}
