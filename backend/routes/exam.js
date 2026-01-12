const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');
const gradeAllWithAI = require('../services/grading/aiGrader');

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

// javascript
// In `backend/routes/exam.js` replace the run-query handler with the code below.

router.post('/run-query', async (req, res) => {
    const { studentId, questionId, studentSql } = req.body;
    const userName = `user_${studentId}`;
    const schemaName = `exam_sv_${studentId}`;
    try {
        const pool = await getPool();
        const qRes = await pool.request().input('id', sql.Int, questionId).query('SELECT * FROM questions WHERE id = @id');
        if (qRes.recordset.length === 0) return res.status(404).json({ error: "Question not found" });
        const question = qRes.recordset[0];

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = new sql.Request(transaction);

        // helpers
        const escapeForN = s => s.replace(/'/g, "''");
        const splitBatches = s => (s || '').split(/^\s*GO\s*$/gim).map(b => b.trim()).filter(Boolean);

        try {
            let resultData = null, metadata = null;

            // Phân loại lại type FUNC_PROC thành FUNCTION, PROCEDURE, TRIGGER dựa vào expected_sql
            const funcProcTypes = ['FUNCTION', 'PROCEDURE', 'TRIGGER'];
            if (funcProcTypes.includes(question.type) || (question.type === 'FUNC_PROC' && question.expected_sql)) {
                const expectedSql = question.expected_sql.trim();
                if (expectedSql.startsWith('CREATE FUNCTION')) {
                    question.type = 'FUNCTION';
                } else if (expectedSql.startsWith('CREATE PROCEDURE')) {
                    question.type = 'PROCEDURE';
                } else if (expectedSql.startsWith('CREATE TRIGGER')) {
                    question.type = 'TRIGGER';
                }
            }

            // Thực thi câu lệnh SQL của sinh viên
            if (['DDL_CREATE', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(question.type)) {
                const batches = splitBatches(studentSql);
                for (const batch of batches) {
                    const inner = escapeForN(batch);
                    console.log(`[${question.type}] [student ${studentId}] Executing batch:`);
                    console.log(batch);
                    try {
                        await request.query(`EXECUTE AS USER = '${userName}'; EXEC(N'${inner}'); REVERT;`);
                        console.log(`[${question.type}] [student ${studentId}] Batch executed successfully.`);
                    } catch (err) {
                        console.error(`[${question.type}] [student ${studentId}] Error executing batch:`);
                        console.error(err.message);
                        throw err;
                    }
                }
            } else {
                const batches = splitBatches(studentSql);
                for (const batch of batches) {
                    if (!batch) continue;
                    await request.query(`EXECUTE AS USER = '${userName}'; ${batch}; REVERT;`);
                }
            }

            // Thực thi verification_script cho các loại FUNCTION, PROCEDURE, TRIGGER
            if (['FUNCTION', 'PROCEDURE'].includes(question.type)) {
                const verificationBatches = splitBatches(question.verification_script);
                for (const batch of verificationBatches) {
                    const replacedBatch = batch.replace(/@SCHEMA/g, schemaName);
                    const inner = escapeForN(replacedBatch);
                    console.log(`[${question.type}] [student ${studentId}] Executing verification batch:`);
                    console.log(replacedBatch);
                    try {
                        await request.query(`EXECUTE AS USER = '${userName}'; EXEC(N'${inner}'); REVERT;`);
                        console.log(`[${question.type}] [student ${studentId}] Verification batch executed successfully.`);
                    } catch (err) {
                        console.error(`[${question.type}] [student ${studentId}] Error executing verification batch:`);
                        console.error(err.message);
                        throw err;
                    }
                }
            } else if (question.type === 'TRIGGER') {
                const verificationBatches = splitBatches(question.verification_script);
                for (const batch of verificationBatches) {
                    const replacedBatch = batch.replace(/@SCHEMA/g, schemaName);
                    const inner = escapeForN(replacedBatch);
                    console.log(`[TRIGGER] [student ${studentId}] Executing verification batch (separate transaction):`);
                    console.log(replacedBatch);
                    try {
                        // Mỗi batch thực thi trong transaction riêng biệt
                        const triggerPool = await getPool();
                        const triggerTransaction = new sql.Transaction(triggerPool);
                        await triggerTransaction.begin();
                        const triggerRequest = new sql.Request(triggerTransaction);
                        await triggerRequest.query(`EXECUTE AS USER = '${userName}'; EXEC(N'${inner}'); REVERT;`);
                        await triggerTransaction.commit();
                        console.log(`[TRIGGER] [student ${studentId}] Verification batch executed successfully.`);
                    } catch (err) {
                        console.error(`[TRIGGER] [student ${studentId}] Error executing verification batch:`);
                        console.error(err.message);
                        // Không throw để các batch sau vẫn chạy
                    }
                }
            }

            if (question.type === 'QUERY_SELECT') {
                const selectRes = await request.query(`EXECUTE AS USER = '${userName}'; ${studentSql}; REVERT;`);
                resultData = selectRes.recordset;
            } else if (question.type === 'DDL_CREATE') {
                const tableNames = question.verification_script.split(',').map(t => t.trim());
                metadata = [];
                for (const tableName of tableNames) {
                    try {
                        const metaRes = await request.query(`
                            SELECT DISTINCT
                                '${tableName}' as TABLE_NAME,
                                c.COLUMN_NAME,
                                c.DATA_TYPE,
                                c.CHARACTER_MAXIMUM_LENGTH,
                                c.ORDINAL_POSITION,
                                CASE WHEN EXISTS (
                                    SELECT 1
                                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                                             JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                                                  ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                                    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                                      AND ku.TABLE_SCHEMA = '${schemaName}'
                                      AND ku.TABLE_NAME = '${tableName}'
                                      AND ku.COLUMN_NAME = c.COLUMN_NAME
                                ) THEN 1 ELSE 0 END as IS_PK
                            FROM INFORMATION_SCHEMA.COLUMNS c
                            WHERE c.TABLE_SCHEMA = '${schemaName}'
                              AND c.TABLE_NAME = '${tableName}'
                            ORDER BY c.ORDINAL_POSITION
                        `);
                        if (metaRes.recordset.length > 0) metadata = metadata.concat(metaRes.recordset);
                    } catch (e) {
                        console.log(`Table ${tableName} not found or error:`, e.message);
                    }
                }
            } else if (question.type === 'DML_INSERT') {
                const insertStatements = question.expected_sql.match(/INSERT INTO\s+(\w+)/gi) || [];
                const tableNames = [...new Set(insertStatements.map(stmt => {
                    const match = stmt.match(/INSERT INTO\s+(\w+)/i);
                    return match ? match[1] : null;
                }))].filter(Boolean);
                resultData = {};
                for (const tableName of tableNames) {
                    try {
                        const dataRes = await request.query(`SELECT * FROM [${schemaName}].[${tableName}]`);
                        resultData[tableName] = { rows: dataRes.recordset, count: dataRes.recordset.length };
                    } catch (e) {
                        console.log(`Table ${tableName} not found or error:`, e.message);
                        resultData[tableName] = { rows: [], count: 0, error: e.message };
                    }
                }
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
    const { studentId, answers } = req.body;
    const schemaName = `exam_sv_${studentId}`;
    try {
        const pool = await getPool();
        const questions = (await pool.request().query('SELECT * FROM questions ORDER BY id')).recordset;

        // Gắn studentSql từ frontend vào questions
        const questionsWithAnswers = questions.map(q => {
            const answer = answers?.find(a => a.questionId === q.id);
            return {
                ...q,
                studentSql: answer?.studentSql || ''
            };
        });

        // Chấm bằng AI - Gọi 1 lần cho tất cả câu
        console.log('Grading with AI...');
        console.log('Student answers:', JSON.stringify(answers, null, 2));
        const aiResults = await gradeAllWithAI(pool, schemaName, questionsWithAnswers);

        let totalScore = 0;
        const details = aiResults.map(result => {
            const question = questions.find(q => q.id === result.questionId);
            const answer = answers?.find(a => a.questionId === result.questionId);
            totalScore += result.score;

            return {
                questionId: result.questionId,
                title: question ? question.title : 'Unknown',
                score: result.score,
                maxScore: result.maxScore,
                feedback: result.feedback,
                status: result.status,
                studentSql: answer?.studentSql || ''
            };
        });

        res.json({ success: true, totalScore, details });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}); module.exports = router;