

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
            } else {
                await request.query(runScript);
            }

            if (question.type === 'DDL_CREATE') {
                // Xử lý NHIỀU BẢNG - verification_script chứa danh sách bảng cách nhau bởi dấu phẩy
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

                        if (metaRes.recordset.length > 0) {
                            metadata = metadata.concat(metaRes.recordset);
                        }
                    } catch (e) {
                        console.log(`Table ${tableName} not found or error:`, e.message);
                    }
                }

            } else if (question.type === 'DML_INSERT') {
                // Xử lý NHIỀU BẢNG - lấy tất cả bảng từ expected_sql
                const insertStatements = question.expected_sql.match(/INSERT INTO\s+(\w+)/gi) || [];
                const tableNames = [...new Set(insertStatements.map(stmt => {
                    const match = stmt.match(/INSERT INTO\s+(\w+)/i);
                    return match ? match[1] : null;
                }))].filter(Boolean);

                resultData = {};

                for (const tableName of tableNames) {
                    try {
                        const dataRes = await request.query(`SELECT * FROM [${schemaName}].[${tableName}]`);
                        resultData[tableName] = {
                            rows: dataRes.recordset,
                            count: dataRes.recordset.length
                        };
                    } catch (e) {
                        console.log(`Table ${tableName} not found or error:`, e.message);
                        resultData[tableName] = {
                            rows: [],
                            count: 0,
                            error: e.message
                        };
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