import { logger, type SnapshotBatch, type StructureSnapshotBatch } from "@eve-market-scout/shared";
import type { MarketStore, StructureMarketStore } from "./store.js";

/**
 * Production storage: POSTs the batch to the ingest-api Cloudflare Worker,
 * which writes it into D1 (see packages/ingest-api and db/migrations).
 * Auth is a shared secret header — fine for a single-writer GitHub Actions
 * job; swap for signed requests if you ever add more writers.
 */
export class HttpIngestStore implements MarketStore, StructureMarketStore {
  constructor(
    private readonly ingestUrl: string,
    private readonly sharedSecret: string
  ) {}

  private async post(url: string, body: unknown, rowCount: number, label: string): Promise<void> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ingest-Secret": this.sharedSecret,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(
        `Ingest API rejected ${label} snapshot: ${res.status} ${await res.text()}`
      );
    }

    logger.info(`Sent ${label} snapshot to ingest API`, { url, rows: rowCount, status: res.status });
  }

  async saveSnapshot(batch: SnapshotBatch): Promise<void> {
    await this.post(this.ingestUrl, batch, batch.rows.length, "region");
  }

  async saveStructureSnapshot(batch: StructureSnapshotBatch): Promise<void> {
    // Deliberately not using `new URL('structures', this.ingestUrl)` --
    // relative URL resolution replaces the base's last path segment rather
    // than appending (".../ingest" + "structures" -> ".../structures", not
    // ".../ingest/structures"), which isn't what we want here.
    const structuresUrl = `${this.ingestUrl.replace(/\/+$/, "")}/structures`;
    await this.post(structuresUrl, batch, batch.rows.length, "structure");
  }
}
