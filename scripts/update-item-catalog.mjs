import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const source = "https://data.everef.net/reference-data/reference-data-latest.tar.xz";
const destination = path.resolve("apps/web/src/itemCatalog.json");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "eve-market-catalog-"));
const archivePath = path.join(temporaryDirectory, "reference-data.tar.xz");

try {
  const response = await fetch(source, {
    headers: { "User-Agent": "eve-market-scout/0.1" },
  });
  if (!response.ok) throw new Error(`Catalog download failed: ${response.status}`);
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));

  const extracted = spawnSync("tar", ["-xf", archivePath, "-C", temporaryDirectory, "types.json"], {
    encoding: "utf8",
  });
  if (extracted.status !== 0) throw new Error(`Catalog extraction failed: ${extracted.stderr}`);

  const payload = JSON.parse(await readFile(path.join(temporaryDirectory, "types.json"), "utf8"));
  const types = Array.isArray(payload) ? payload : Object.values(payload);
  const catalog = types
    .filter((item) => item?.published === true && item?.market_group_id && item?.name?.en)
    .map((item) => ({ id: item.type_id, name: item.name.en }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(catalog)}\n`, "utf8");
  console.log(`Wrote ${catalog.length} market items to ${destination}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
