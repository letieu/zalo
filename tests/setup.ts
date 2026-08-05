import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Point the app's SQLite store at a per-run temp file BEFORE anything
 * imports src/lib/db/sqlite (which opens the DB at module load).
 */
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-test-'));
process.env.ZALO_DB_PATH = path.join(dbDir, 'test.db');
