// Stress test: one-student-one-schema approach
// Usage: node tools/stressTestSchema.js --count=150 --concurrency=50 --rows=10 --verbose --logFile=./schema_results.jsonl

const { getPool, sql } = require('../config/db');
const argv = require('minimist')(process.argv.slice(2));
const fs = require('fs');

const TOTAL = parseInt(argv.count || argv.c || '100', 10);
const CONCURRENCY = parseInt(argv.concurrency || argv.p || argv.con || '50', 10);
const INSERT_ROWS = parseInt(argv.rows || '10', 10);
const VERBOSE_THRESHOLD = parseInt(process.env.VERBOSE_THRESHOLD || '200', 10);
const VERBOSE = !!(argv.verbose || argv.v) || TOTAL <= VERBOSE_THRESHOLD;
const LOG_FILE = argv.logFile || argv.logfile || argv.lf || './stressTestSchema_results.jsonl';
const OUT_FILE = argv.out || argv.o || null;

function makeStudentId(i) {
  return `sv_${String(i).padStart(4, '0')}`;
}

async function ensureSchema(pool, schemaName, userName) {
  const script = `
    IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schemaName}')
      EXEC('CREATE SCHEMA [${schemaName}]');
    IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = '${userName}')
    BEGIN
      CREATE USER [${userName}] WITHOUT LOGIN WITH DEFAULT_SCHEMA = [${schemaName}];
      ALTER ROLE db_owner ADD MEMBER [${userName}];
    END
  `;
  await pool.request().query(script);
}

async function setupAndTestSchema(studentId, pool) {
  const schema = `exam_sv_${studentId}`;
  const user = `user_${studentId}`;

  // start a transaction scoped to this schema's operations
  const tx = new sql.Transaction(pool);
  try {
    await ensureSchema(pool, schema, user);

    await tx.begin();
    const req = new sql.Request(tx);

    // create tables in that schema
    await req.query(`
      IF OBJECT_ID('${schema}.Departments','U') IS NULL
      CREATE TABLE ${schema}.Departments (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(200),
        location NVARCHAR(200),
        createdAt DATETIME2 DEFAULT SYSUTCDATETIME()
      );
      IF OBJECT_ID('${schema}.Projects','U') IS NULL
      CREATE TABLE ${schema}.Projects (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(200),
        budget DECIMAL(18,2),
        startDate DATETIME2
      );
      IF OBJECT_ID('${schema}.Employees','U') IS NULL
      CREATE TABLE ${schema}.Employees (
        id INT IDENTITY(1,1) PRIMARY KEY,
        dept_id INT,
        name NVARCHAR(200),
        title NVARCHAR(200),
        hireDate DATETIME2,
        salary DECIMAL(18,2),
        email NVARCHAR(200)
      );
      IF OBJECT_ID('${schema}.EmployeeProjects','U') IS NULL
      CREATE TABLE ${schema}.EmployeeProjects (
        id INT IDENTITY(1,1) PRIMARY KEY,
        emp_id INT,
        project_id INT,
        role NVARCHAR(200),
        allocationPercent INT
      );
    `);

    // create dept rows
    const deptNames = ['Engineering', 'Sales', 'HR'];
    const deptIds = [];
    for (let d = 0; d < deptNames.length; d++) {
      const nameVal = `${deptNames[d]} - ${studentId}`;
      const resDept = await req.input('dname', sql.NVarChar(200), nameVal)
        .input('loc', sql.NVarChar(200), `Location-${d+1}`)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM ${schema}.Departments WHERE name = @dname)
          INSERT INTO ${schema}.Departments (name, location) OUTPUT INSERTED.id AS id VALUES (@dname, @loc);
        `);
      let id = resDept.recordset?.[0]?.id;
      if (!id) {
        const sel = await req.input('dnameSel', sql.NVarChar(200), nameVal).query(`SELECT id FROM ${schema}.Departments WHERE name = @dnameSel;`);
        id = sel.recordset?.[0]?.id;
      }
      if (id) deptIds.push(id);
    }

    // create projects
    const projectIds = [];
    for (let p = 0; p < 2; p++) {
      const pname = `Project_${studentId}_${p}`;
      const pres = await req.input('pname', sql.NVarChar(200), pname)
        .input('budget', sql.Decimal(18,2), 100000.00 + p * 50000)
        .input('sdate', sql.DateTime2, new Date())
        .query(`
          IF NOT EXISTS (SELECT 1 FROM ${schema}.Projects WHERE name = @pname)
          INSERT INTO ${schema}.Projects (name, budget, startDate) OUTPUT INSERTED.id AS id VALUES (@pname, @budget, @sdate);
        `);
      let pid = pres.recordset?.[0]?.id;
      if (!pid) {
        const selP = await req.input('pnameSel', sql.NVarChar(200), pname).query(`SELECT id FROM ${schema}.Projects WHERE name = @pnameSel;`);
        pid = selP.recordset?.[0]?.id;
      }
      if (pid) projectIds.push(pid);
    }

    if (deptIds.length === 0 || projectIds.length === 0) {
      await tx.rollback();
      return { studentId, success: false, error: 'Missing dept or project ids' };
    }

    const inserted = [];
    for (let r = 0; r < INSERT_ROWS; r++) {
      const name = `emp_${studentId}_${r}`;
      const title = r % 5 === 0 ? 'Senior Engineer' : 'Engineer';
      const hireDate = new Date(Date.now() - (r % 7) * 365 * 24 * 3600 * 1000);
      const salary = 50000 + (r * 1234) % 70000;
      const email = `${name}@example.com`;
      const deptId = deptIds[r % deptIds.length];

      const empRes = await req
        .input('deptId', sql.Int, deptId)
        .input('name', sql.NVarChar(200), name)
        .input('title', sql.NVarChar(200), title)
        .input('hireDate', sql.DateTime2, hireDate)
        .input('salary', sql.Decimal(18,2), salary)
        .input('email', sql.NVarChar(200), email)
        .query(`INSERT INTO ${schema}.Employees (dept_id, name, title, hireDate, salary, email) OUTPUT INSERTED.id AS id VALUES (@deptId, @name, @title, @hireDate, @salary, @email);`);
      const empId = empRes.recordset?.[0]?.id;
      if (!empId) continue;

      for (let j = 0; j < projectIds.length; j++) {
        const alloc = 30 + ((r + j) * 17) % 70;
        await req.input('empId', sql.Int, empId)
          .input('projId', sql.Int, projectIds[j])
          .input('role', sql.NVarChar(200), j === 0 ? 'Developer' : 'Contributor')
          .input('alloc', sql.Int, alloc)
          .query(`INSERT INTO ${schema}.EmployeeProjects (emp_id, project_id, role, allocationPercent) VALUES (@empId, @projId, @role, @alloc);`);
      }
      inserted.push(empId);
    }

    // complex query per schema
    const qRes = await req.query(`
      SELECT d.id, d.name, d.location,
        (SELECT COUNT(*) FROM ${schema}.Employees e WHERE e.dept_id = d.id) AS employeeCount,
        (SELECT ISNULL(AVG(e.salary),0) FROM ${schema}.Employees e WHERE e.dept_id = d.id) AS avgSalary,
        (SELECT COUNT(DISTINCT ep.project_id) FROM ${schema}.EmployeeProjects ep JOIN ${schema}.Employees e2 ON e2.id = ep.emp_id WHERE e2.dept_id = d.id) AS projectCount,
        (
          SELECT STRING_AGG(topNames, ', ') WITHIN GROUP (ORDER BY topSalaries DESC) FROM (
            SELECT TOP (3) e3.name AS topNames, e3.salary AS topSalaries
            FROM ${schema}.Employees e3 WHERE e3.dept_id = d.id
            ORDER BY e3.salary DESC
          ) t
        ) AS topEarners
      FROM ${schema}.Departments d
      WHERE EXISTS (
        SELECT 1 FROM ${schema}.Employees e4 WHERE e4.dept_id = d.id AND e4.hireDate >= DATEADD(year, -5, SYSUTCDATETIME())
      )
      AND EXISTS (
        SELECT 1 FROM ${schema}.EmployeeProjects ep2 WHERE ep2.emp_id IN (SELECT id FROM ${schema}.Employees e5 WHERE e5.dept_id = d.id) AND ep2.allocationPercent > 50
      );
    `);

    await tx.commit();

    const summary = qRes.recordset || [];
    const out = { studentId, success: true, inserted: inserted.length, deptSummaryCount: summary.length, deptSummary: summary };

    // write JSONL
    try { fs.appendFileSync(LOG_FILE, JSON.stringify({ timestamp: new Date().toISOString(), type: 'schema', studentId, out }) + '\n', 'utf8'); } catch(e) { if (VERBOSE) console.error('Failed to write log file', e && e.message); }

    if (VERBOSE) console.log(`[schema ${studentId}]`, JSON.stringify(out));
    return out;
  } catch (err) {
    try { await tx.rollback(); } catch(_){}
    try { fs.appendFileSync(LOG_FILE, JSON.stringify({ timestamp: new Date().toISOString(), type: 'schema', studentId, success: false, error: err.message }) + '\n', 'utf8'); } catch(e){}
    if (VERBOSE) console.error(`[schema ${studentId}] ERROR:`, err.message);
    return { studentId, success: false, error: err.message };
  }
}

async function run() {
  console.log(`Stress test (schema) starting: total=${TOTAL}, concurrency=${CONCURRENCY}, insertRows=${INSERT_ROWS}`);
  const start = Date.now();
  const pool = await getPool();

  const studentIds = Array.from({ length: TOTAL }, (_, i) => makeStudentId(i+1));

  const results = [];
  let i = 0;
  const running = new Set();

  function launchNext() {
    if (i >= studentIds.length) return null;
    const sid = studentIds[i++];
    const p = (async () => {
      try {
        const r = await setupAndTestSchema(sid, pool);
        results.push(r);
        if (!r.success) console.error('Error for', sid, r.error);
        if (VERBOSE) console.log(`[${new Date().toISOString()}] [schema ${sid}] result: ${JSON.stringify(r)}`);
        return r;
      } catch (err) {
        const r = { studentId: sid, success: false, error: err.message };
        results.push(r);
        console.error('Unhandled error for', sid, err.message);
        if (VERBOSE) console.log(`[schema ${sid}] UNHANDLED ERROR: ${err.message}`);
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
    try { await Promise.race(running); } catch(_){}
    while (running.size < CONCURRENCY && i < studentIds.length) launchNext();
  }

  const elapsed = (Date.now() - start) / 1000;
  const successCount = results.filter(r => r.success).length;
  console.log('Schema stress complete.', `Elapsed ${elapsed}s, success ${successCount}/${TOTAL}, failed ${results.length - successCount}`);

  if (OUT_FILE) {
    try { fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf8'); console.log('Wrote results to', OUT_FILE); } catch (e) { console.error('Failed to write out file', e && e.message); }
  }

  await pool.close();
}

run().catch(err => { console.error('Fatal error', err); process.exit(1); });

