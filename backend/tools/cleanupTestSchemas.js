// Cleanup test schemas and their users created by stressTestSchema.js
// Usage: node tools/cleanupTestSchemas.js --dry --logFile=./cleanup_schema_log.jsonl

const { getPool, sql } = require('../config/db');
const argv = require('minimist')(process.argv.slice(2));
const fs = require('fs');

const DRY = !!argv.dry || !!argv.n;
const LOG_FILE = argv.logFile || argv.logfile || './cleanup_schema_log.jsonl';

async function dropSchemaObjectsAndUser(pool, schemaName) {
    const studentPart = schemaName.replace(/^exam_sv_/, '');
    const userName = `user_${studentPart}`;
    const logEntry = { timestamp: new Date().toISOString(), schema: schemaName, user: userName };

    try {
        // 1) Drop foreign key constraints inside the schema
        const fkSql = `
      DECLARE @sql NVARCHAR(MAX) = N'';
      SELECT @sql += N'ALTER TABLE [' + s.name + '].[' + t.name + '] DROP CONSTRAINT [' + fk.name + '];\n'
      FROM sys.foreign_keys fk
      JOIN sys.tables t ON fk.parent_object_id = t.object_id
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE s.name = '${schemaName}';
      EXEC sp_executesql @sql;
    `;
        await pool.request().query(fkSql);

        // 2) Drop tables in the schema
        const dropTablesSql = `
      DECLARE @sql2 NVARCHAR(MAX) = N'';
      SELECT @sql2 += N'DROP TABLE [' + s.name + '].[' + t.name + '];\n'
      FROM INFORMATION_SCHEMA.TABLES t
      JOIN sys.schemas s ON t.TABLE_SCHEMA = s.name
      WHERE t.TABLE_SCHEMA = '${schemaName}' AND t.TABLE_TYPE = 'BASE TABLE';
      EXEC sp_executesql @sql2;
    `;
        await pool.request().query(dropTablesSql);

        // 3) Drop user if exists
        const dropUserSql = `
      IF EXISTS (SELECT * FROM sys.database_principals WHERE name = '${userName}')
      BEGIN
        EXEC('DROP USER [${userName}]');
      END
    `;
        await pool.request().query(dropUserSql);

        // 4) Drop schema if exists
        const dropSchemaSql = `
      IF EXISTS (SELECT * FROM sys.schemas WHERE name = '${schemaName}')
      BEGIN
        EXEC('DROP SCHEMA [${schemaName}]');
      END
    `;
        await pool.request().query(dropSchemaSql);

        logEntry.success = true;
        fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n', 'utf8');
        return logEntry;
    } catch (err) {
        logEntry.success = false;
        logEntry.error = err.message;
        try { fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n', 'utf8'); } catch (_) {}
        return logEntry;
    }
}

async function run() {
    console.log('Starting cleanup of test schemas...');
    const pool = await getPool();

    // find schemas matching our test pattern
    const res = await pool.request().query("SELECT name FROM sys.schemas WHERE name LIKE 'exam_sv_%';");
    const schemas = res.recordset.map(r => r.name);
    if (schemas.length === 0) {
        console.log('No test schemas found.');
        await pool.close();
        return;
    }

    console.log('Found schemas:', schemas.join(', '));
    if (DRY) console.log('Running in dry mode: no changes will be made.');

    const results = [];
    for (const s of schemas) {
        if (DRY) {
            const entry = { timestamp: new Date().toISOString(), schema: s, dry: true };
            results.push(entry);
            fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
            continue;
        }
        const r = await dropSchemaObjectsAndUser(pool, s);
        results.push(r);
        console.log('Cleanup result for', s, r.success ? 'OK' : 'ERROR', r.error || '');
    }

    await pool.close();
    console.log('Cleanup finished. Wrote logs to', LOG_FILE);
}

run().catch(err => { console.error('Fatal cleanup error:', err); process.exit(1); });
