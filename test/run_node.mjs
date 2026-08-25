// Engine math pins under node (CI-equivalent). Browser truth still comes
// from tests/engine.test.html in Chrome/Firefox/Safari.
import { runAll } from "./cases.mjs";

const results = runAll();
let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`  ok   ${r.name}`);
  else { failed++; console.error(`  FAIL ${r.name}\n       ${r.err}`); }
}
console.log(`${results.length - failed}/${results.length} engine cases passed`);
process.exit(failed ? 1 : 0);
