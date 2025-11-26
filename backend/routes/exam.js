

const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');

router.post('/init-exam', async (req, res) => {
    const { studentId } = req.body;
    const schemaName = `exam_sv_${studentId}`;
    const userName = `user_${studentId}`;
    try {
        const pool = await getPool();
        const initScript = `
      IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schemaName}')
      BEGIN EXEC('CREATE SCHEMA [${schemaName}]'); END
      IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = '${userName}')
      BEGIN
        CREATE USER [${userName}] WITHOUT LOGIN WITH DEFAULT_SCHEMA = [${schemaName}];
        ALTER ROLE db_owner ADD MEMBER [${userName}];
      END
    `;
        await pool.request().query(initScript);
        res.json({ success: true, message: `Ready environment: ${schemaName}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/run-query', async (req, res) => {
    const { studentId, questionId, studentSql } = req.body;
    const userName = `user_${studentId}`;
    const schemaName = `exam_sv_${studentId}`;
    try {
        const pool = await getPool();
        const qRes = await pool.request().input('id', sql.Int, questionId).query('SELECT * FROM questions WHERE id = @id');
        if (qRes.recordset.length === 0) return res.status(404).json({ error: "Question not found" });
        const question = qRes.recordset[0];
        const runScript = `EXECUTE AS USER = '${userName}'; ${studentSql} REVERT;`;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = new sql.Request(transaction);
        try {
            let resultData = null, metadata = null;
            if (question.type === 'QUERY_SELECT') {
                const resRun = await request.query(runScript);
                resultData = resRun.recordset;
            } else { await request.query(runScript); }

            if (question.type === 'DDL_CREATE') {
                const tableName = question.verification_script;
                const metaRes = await request.query(`
          SELECT c.COLUMN_NAME, c.DATA_TYPE, CASE WHEN k.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as IS_PK
          FROM INFORMATION_SCHEMA.COLUMNS c LEFT JOIN (
            SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE as ku
            WHERE ku.CONSTRAINT_NAME LIKE 'PK%'
          ) as k ON c.TABLE_NAME = k.TABLE_NAME AND c.COLUMN_NAME = k.COLUMN_NAME
          WHERE c.TABLE_SCHEMA = '${schemaName}' AND c.TABLE_NAME = '${tableName}'
        `);
                metadata = metaRes.recordset;
            } else if (question.type === 'DML_INSERT') {
                try {
                    const tableName = question.expected_sql.match(/INSERT INTO\s+([^\s(]+)/i)?.[1] || question.expected_sql;
                    const dataRes = await request.query(`SELECT * FROM [${schemaName}].[${tableName.replace(/[\[\]]/g, '')}]`);
                    resultData = dataRes.recordset;
                } catch(e) {}
            }
            await transaction.commit();
            res.json({ success: true, message: "Query executed.", data: resultData, schema: metadata });
        } catch (execErr) {
            await transaction.rollback();
            res.json({ success: false, message: execErr.message });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/submit-exam', async (req, res) => {
    const { studentId } = req.body;
    const schemaName = `exam_sv_${studentId}`;
    try {
        const pool = await getPool();
        const questions = (await pool.request().query('SELECT * FROM questions ORDER BY id')).recordset;
        let totalScore = 0, details = [];
        for (const q of questions) {
            let score = 0, status = "Failed";
            const transaction = new sql.Transaction(pool);
            await transaction.begin();
            const reqCheck = new sql.Request(transaction);
            try {
                if (q.type === 'DDL_CREATE') {
                    const check = await reqCheck.query(`SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='${schemaName}' AND TABLE_NAME='${q.verification_script}'`);
                    if (check.recordset.length > 0) score = 10;
                } else if (q.type === 'DML_INSERT') {
                    const tblMatch = q.expected_sql.match(/INSERT INTO\s+([^\s(]+)/i);
                    const tbl = tblMatch ? tblMatch[1] : 'UnknownTable';
                    const cnt = await reqCheck.query(`SELECT COUNT(*) as c FROM [${schemaName}].[${tbl.replace(/[\[\]]/g, '')}]`);
                    if (cnt.recordset[0].c >= parseInt(q.verification_script)) score = 10;
                } else if (q.type === 'QUERY_SELECT') { score = 10; }
                else if (q.type === 'FUNC_PROC') {
                    await reqCheck.query(q.verification_script.replace(/@SCHEMA/g, `[${schemaName}]`));
                    score = 10;
                }
                if (score > 0) status = "Passed";
                await transaction.commit();
            } catch (e) { await transaction.rollback(); status = `Failed: ${e.message}`; }
            totalScore += score;
            details.push({ questionId: q.id, title: q.title, score, status });
        }
        res.json({ success: true, totalScore, details });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;