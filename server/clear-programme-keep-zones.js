#!/usr/bin/env node
'use strict';

/**
 * Clears programme_items, schedule, completions, zone_activities, and related logs;
 * keeps zones, drawings, templates, users. Run against DATABASE_PATH (or default data/119hs.db).
 *
 *   npm run clear-programme-keep-zones
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const db = require('./db');

(async () => {
  await db.init();
  const out = db.clearProgrammeKeepZones();
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
