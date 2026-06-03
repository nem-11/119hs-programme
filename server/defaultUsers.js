/**
 * Default programme accounts.
 * - Empty DB bootstrap: admin password from SEED_ADMIN_PASSWORD (production) or dev fallback; others use passwordPlain.
 * - Existing DBs: ensureStandardProgrammeUsers() inserts any of the non-admin rows that are still missing (e.g. after an older bootstrap that only created admin).
 *
 * Optional manual seed (`node server/seed.js`) imports this list and uses admin password `119hs` for the demo dump.
 */
exports.DEFAULT_BOOTSTRAP_USERS = [
  {
    username: 'admin',
    name: 'Nem',
    role: 'admin',
    tabs: ['groundworks', 'internals', 'project_programme', 'module_handover'],
    /** Ignored in bootstrap — uses SEED_ADMIN_PASSWORD or dev-only `119hs`. */
    passwordPlain: null,
  },
  {
    username: 'site',
    passwordPlain: 'site123',
    name: 'Site Team',
    role: 'site_editor',
    tabs: ['groundworks', 'internals', 'project_programme', 'module_handover'],
  },
  {
    username: 'DBs',
    passwordPlain: 'ground1',
    name: 'DBs',
    role: 'gw_subbie',
    tabs: ['groundworks', 'project_programme'],
  },
  {
    username: 'IKEW',
    passwordPlain: 'Ikew1',
    name: 'IKEW',
    role: 'int_subbie',
    tabs: ['internals', 'project_programme'],
  },
  {
    username: 'board',
    passwordPlain: 'board119',
    name: 'Board',
    role: 'board_viewer',
    tabs: ['groundworks', 'internals', 'project_programme', 'module_handover'],
  },
  {
    username: 'Team',
    passwordPlain: '119team',
    name: 'Team',
    role: 'board_viewer',
    tabs: ['groundworks', 'internals', 'project_programme', 'module_handover'],
  },
];
