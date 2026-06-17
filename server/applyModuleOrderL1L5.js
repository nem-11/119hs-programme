#!/usr/bin/env node
'use strict';

/** Apply Module Completion to Levels 1–5 in Nem's floor-plan order. */

const db = require('./db');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await db.init();
  const out = db.applyModuleOrderL1L5({ dryRun, skipMissing: true });
  console.log(JSON.stringify(out, null, 2));
  if (out.error) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
