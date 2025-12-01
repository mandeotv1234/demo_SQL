// Cleanup script for per-student databases created by stressTest.js
// Usage: node tools/cleanupTestDbs.js --dry --logFile=./cleanup_db_log.jsonl

const sql = require('mssql');
const argv = require('minimist')(process.argv.slice(2));
const fs = require('fs');

const DRY = !!argv.dry || !!argv.n;
const LOG_FILE = argv.logFile || argv.logfile || './cleanup_db_log.jsonl';

const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'Password123!',
    server: process.env.DB_HOST || 'localhost',
    database: 'master',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    options: { encrypt: false, trustServerCertificate: true }
};

async function dropDatabase(pool, dbName) {
    const entry = { timestamp: new Date().toISOString(), db: dbName };
    try {
        // set single user with rollback immediate to drop active connections
        const q = `ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}];`;
        await pool.request().query(q);
        entry.success = true;
        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
        return entry;
    } catch (err) {
        entry.success = false;
        entry.error = err.message;
        try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8'); } catch (_) {}
        return entry;
    }
}

async function run() {
    console.log('Starting cleanup of per-student databases...');
    const pool = await sql.connect(dbConfig);

    const res = await pool.request().query("SELECT name FROM sys.databases WHERE name LIKE 'exam_student_%';");
    const dbs = res.recordset.map(r => r.name);
    if (dbs.length === 0) {
        console.log('No test databases found.');
        await pool.close();
        return;
    }

    console.log('Found DBs:', dbs.join(', '));
    if (DRY) console.log('Running in dry mode: no changes will be made.');

    const results = [];
    for (const d of dbs) {
        if (DRY) {
            const entry = { timestamp: new Date().toISOString(), db: d, dry: true };
            results.push(entry);
            fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
            continue;
        }
        const r = await dropDatabase(pool, d);
        results.push(r);
        console.log('Cleanup result for', d, r.success ? 'OK' : 'ERROR', r.error || '');
    }

    await pool.close();
    console.log('Cleanup finished. Wrote logs to', LOG_FILE);
}

run().catch(err => { console.error('Fatal cleanup error:', err); process.exit(1); });
