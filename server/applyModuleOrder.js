#!/usr/bin/env node
'use strict';

/**
 * Apply Module Completion from an explicit module order list.
 *
 * Usage:
 *   node server/applyModuleOrder.js path/to/order.json
 *   node server/applyModuleOrder.js path/to/order.json --dry-run
 *
 * order.json — JSON array of module names in schedule order, e.g.:
 *   ["T4 149", "T4 150", "T4 151", "T4 152", ...]
 * or:
 *   [{ "tower": "T4", "name": "149" }, ...]
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');
  const file = args[0];
  if (!file) {
    console.error('Usage: node server/applyModuleOrder.js <order.json> [--dry-run]');
    process.exit(1);
  }
  const abs = path.resolve(file);
  const order = JSON.parse(fs.readFileSync(abs, 'utf8'));
  await db.init();
  const out = db.applyModuleBulkScheduleFromExplicitOrder(order, { dryRun });
  console.log(JSON.stringify(out, null, 2));
  if (out.error) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
