// npm run sync            -> import changed snapshots + live sync (if configured) + alerts
// npm run sync -- import  -> force re-import of discovery snapshots
import { importSnapshots } from "./import-snapshots";
import { runAll } from "./run";

async function main() {
  const cmd = process.argv[2] ?? "all";
  const out = cmd === "import" ? importSnapshots() : await runAll();
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
