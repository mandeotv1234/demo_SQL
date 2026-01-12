// Create many schemas + users for schema-per-student stress testing
// Usage examples:
//   node tools/createSchemas.js --count=1000 --concurrency=50 --start=1 --logFile=./create_schemas.jsonl
//   node tools/createSchemas.js --count=3 --concurrency=3 --start=1 --logFile=./create_schemas_test.jsonl --dry

const { getPool } = require('../config/db');
const argv = require('minimist')(process.argv.slice(2));
const fs = require('fs');

const COUNT = parseInt(argv.count || argv.c || '1000', 10);
const START = parseInt(argv.start || argv.s || '1', 10);
const CONCURRENCY = parseInt(argv.concurrency || argv.p || '50', 10);
const DRY = !!argv.dry || !!argv.n;
const LOG_FILE = argv.logFile || argv.logfile || './create_schemas_results.jsonl';
const VERBOSE = !!argv.verbose || !!argv.v;

function makeStudentId(i) {
  return `sv_${String(i).padStart(4, '0')}`;
}

async function createOne(pool, studentId) {
  const schema = `exam_sv_${studentId}`;
  const user = `user_${studentId}`;
  const entry = { timestamp: new Date().toISOString(), studentId, schema, user, dry: DRY };

  if (DRY) {
    try { fs.appendFileSync(LOG_FILE, JSON.stringify({ ...entry, success: true, note: 'dry-run' }) + '\n', 'utf8'); } catch(_) {}
    if (VERBOSE) console.log(`[create ${studentId}] dry-run`);
    return { studentId, success: true, dry: true };
  }

  const script = `
    IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'${schema}')
    BEGIN
      EXEC('CREATE SCHEMA [${schema}]');
    END;
    IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = N'${user}')
    BEGIN
      CREATE USER [${user}] WITHOUT LOGIN WITH DEFAULT_SCHEMA = [${schema}];
      ALTER ROLE db_owner ADD MEMBER [${user}];
    END;
  `;
  try {
    await pool.request().query(script);
    entry.success = true;
    try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8'); } catch(_) {}
    if (VERBOSE) console.log(`[create ${studentId}] OK`);
    return { studentId, success: true };
  } catch (err) {
    entry.success = false;
    entry.error = err.message;
    try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8'); } catch(_) {}
    console.error(`[create ${studentId}] ERROR:`, err.message);
    return { studentId, success: false, error: err.message };
  }
}

async function run() {
  console.log(`Create schemas starting: count=${COUNT}, start=${START}, concurrency=${CONCURRENCY}, dry=${DRY}`);
  const pool = await getPool();
  const studentIds = Array.from({ length: COUNT }, (_, i) => makeStudentId(START + i));

  const results = [];
  let i = 0;
  const running = new Set();

  function launchNext() {
    if (i >= studentIds.length) return null;
    const sid = studentIds[i++];
    const p = (async () => {
      try {
        const r = await createOne(pool, sid);
        results.push(r);
        return r;
      } finally {
        running.delete(p);
      }
    })();
    running.add(p);
    return p;
  }

  while (running.size < CONCURRENCY && i < studentIds.length) launchNext();
  while (running.size > 0) {
    try { await Promise.race(running); } catch(_) {}
    while (running.size < CONCURRENCY && i < studentIds.length) launchNext();
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`Create schemas complete. success ${successCount}/${COUNT}. Log written to ${LOG_FILE}`);
  await pool.close();
}

run().catch(err => { console.error('Fatal error', err); process.exit(1); });

