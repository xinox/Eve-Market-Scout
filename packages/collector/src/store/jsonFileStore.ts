import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logger, type SnapshotBatch, type StructureSnapshotBatch } from "@eve-market-scout/shared";
import type { MarketStore, StructureMarketStore } from "./store.js";

/**
 * Zero-infrastructure storage: writes one JSON file per collector run under
 * ./data/snapshots/ (regions) or ./data/structure-snapshots/ (structures).
 * Good for local development, CI smoke tests, or a very first "does this
 * even work end to end" pass before wiring up D1.
 *
 * Not meant for production long-term storage — git-committing these or
 * relying on GitHub Actions' ephemeral disk will not give you real history.
 */
export class JsonFileStore implements MarketStore, StructureMarketStore {
  private readonly dir: string;
  private readonly structureDir: string;

  constructor(dir = "data/snapshots", structureDir = "data/structure-snapshots") {
    this.dir = dir;
    this.structureDir = structureDir;
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(this.structureDir, { recursive: true });
  }

  async saveSnapshot(batch: SnapshotBatch): Promise<void> {
    const file = path.join(this.dir, `${batch.runId}.json`);
    writeFileSync(file, JSON.stringify(batch, null, 2));
    logger.info("Saved snapshot to local file", {
      file,
      rows: batch.rows.length,
    });
  }

  async saveStructureSnapshot(batch: StructureSnapshotBatch): Promise<void> {
    const file = path.join(this.structureDir, `${batch.runId}.json`);
    writeFileSync(file, JSON.stringify(batch, null, 2));
    logger.info("Saved structure snapshot to local file", {
      file,
      rows: batch.rows.length,
    });
  }
}
