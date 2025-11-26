const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- CẤU HÌNH SQL SERVER ---
const dbConfig = {
    user: 'sa',
    password: 'Password123!', // <--- Đã đồng bộ với Docker Compose
    server: 'localhost',
    database: 'ExamDB',
    port: 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true
    },
    pool: {
        max: 50,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Hàm kết nối an toàn (Tự tạo DB nếu chưa có)
async function getPool() {
    try {
        // 1. Thử kết nối thẳng vào ExamDB
        const pool = await sql.connect(dbConfig);
        return pool;
    } catch (err) {
        // 2. Nếu lỗi do chưa có DB "ExamDB" (Lỗi code 4060), ta kết nối vào master để tạo
        if (err.code === 'ELOGIN' || err.originalError?.info?.number === 4060) {
            console.log("Database ExamDB chưa tồn tại. Đang khởi tạo...");

            // Config kết nối tạm vào master
            const masterConfig = { ...dbConfig, database: 'master' };
            const masterPool = await sql.connect(masterConfig);

            // Tạo DB
            await masterPool.request().query("CREATE DATABASE ExamDB;");
            await masterPool.close();

            console.log("Đã tạo ExamDB. Kết nối lại...");
            // Kết nối lại vào ExamDB
            return await sql.connect(dbConfig);
        }
        throw err;
    }
}

// --- INIT SYSTEM TABLE ---
const initDb = async () => {
    try {
        const pool = await getPool(); // Dùng hàm getPool thông minh ở trên

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'questions')
            BEGIN
                CREATE TABLE questions (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    title NVARCHAR(255),
                    type VARCHAR(50),
                    content NVARCHAR(MAX),
                    expected_sql NVARCHAR(MAX),
                    verification_script NVARCHAR(MAX)
                )
            END
        `);
        console.log("System initialized successfully on Docker SQL Server.");
    } catch (err) {
        console.error("Init DB Error:", err.message);
    }
};

// Gọi khởi tạo
initDb();

// --- API 1: KHỞI TẠO MÔI TRƯỜNG THI (SCHEMA ISOLATION) ---
app.post('/api/init-exam', async (req, res) => {
    const { studentId } = req.body;
    const schemaName = `exam_sv_${studentId}`;
    const userName = `user_${studentId}`;

    try {
        const pool = await getPool();
        const initScript = `
            IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schemaName}')
            BEGIN
                EXEC('CREATE SCHEMA [${schemaName}]');
            END
            
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

// --- API: LẤY CÂU HỎI ---
app.get('/api/questions', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM questions ORDER BY id');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: THÊM CÂU HỎI ---
app.post('/api/questions', async (req, res) => {
    const { title, type, content, expectedSql, verificationScript } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('t', sql.NVarChar, title)
            .input('type', sql.VarChar, type)
            .input('c', sql.NVarChar, content)
            .input('e', sql.NVarChar, expectedSql)
            .input('v', sql.NVarChar, verificationScript)
            .query('INSERT INTO questions (title, type, content, expected_sql, verification_script) VALUES (@t, @type, @c, @e, @v)');
        res.json({ success: true, msg: "Added question" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API 2: RUN QUERY (VISUALIZER) ---
app.post('/api/run-query', async (req, res) => {
    const { studentId, questionId, studentSql } = req.body;
    const userName = `user_${studentId}`;
    const schemaName = `exam_sv_${studentId}`;

    try {
        const pool = await getPool();

        const qRes = await pool.request()
            .input('id', sql.Int, questionId)
            .query('SELECT * FROM questions WHERE id = @id');

        if (qRes.recordset.length === 0) return res.status(404).json({ error: "Question not found" });
        const question = qRes.recordset[0];

        const runScript = `
            EXECUTE AS USER = '${userName}';
            ${studentSql}
            REVERT;
        `;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = new sql.Request(transaction);

        try {
            let resultData = null;
            let metadata = null;

            if (question.type === 'QUERY_SELECT') {
                const resRun = await request.query(runScript);
                resultData = resRun.recordset;
            } else {
                await request.query(runScript);
            }

            if (question.type === 'DDL_CREATE') {
                const tableName = question.verification_script;
                const metaQuery = `
                    SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE,
                           CASE WHEN k.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as IS_PK
                    FROM INFORMATION_SCHEMA.COLUMNS c
                             LEFT JOIN (
                        SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
                        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS as tc
                                 JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE as ku
                                      ON tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                                          AND tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                    ) as k
                                       ON c.TABLE_SCHEMA = k.TABLE_SCHEMA
                                           AND c.TABLE_NAME = k.TABLE_NAME
                                           AND c.COLUMN_NAME = k.COLUMN_NAME
                    WHERE c.TABLE_SCHEMA = '${schemaName}' AND c.TABLE_NAME = '${tableName}'
                `;
                const metaRes = await request.query(metaQuery);
                metadata = metaRes.recordset;
            }
            else if (question.type === 'DML_INSERT') {
                const tableName = question.expected_sql;
                const dataRes = await request.query(`SELECT * FROM [${schemaName}].[${tableName}]`);
                resultData = dataRes.recordset;
            }

            await transaction.commit();

            res.json({
                success: true,
                message: "Query executed successfully.",
                data: resultData,
                schema: metadata
            });

        } catch (execErr) {
            await transaction.rollback();
            res.json({ success: false, message: execErr.message });
        }

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- API 3: SUBMIT EXAM ---
app.post('/api/submit-exam', async (req, res) => {
    const { studentId } = req.body;
    const schemaName = `exam_sv_${studentId}`;

    try {
        const pool = await getPool();
        const qRes = await pool.request().query('SELECT * FROM questions ORDER BY id');
        const questions = qRes.recordset;

        let totalScore = 0;
        let details = [];

        for (const q of questions) {
            let score = 0;
            let status = "Failed";

            const transaction = new sql.Transaction(pool);
            await transaction.begin();
            const reqCheck = new sql.Request(transaction);

            try {
                if (q.type === 'DDL_CREATE') {
                    const tbl = q.verification_script;
                    const check = await reqCheck.query(`SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='${schemaName}' AND TABLE_NAME='${tbl}'`);

                   console.log(check);
                    if (check.recordset.length > 0) score = 10;

                } else if (q.type === 'DML_INSERT') {
                    const tbl = q.expected_sql;
                    const minRow = parseInt(q.verification_script);
                    const cnt = await reqCheck.query(`SELECT COUNT(*) as c FROM [${schemaName}].[${tbl}]`);
                    if (cnt.recordset[0].c >= minRow) score = 10;

                } else if (q.type === 'QUERY_SELECT') {
                    score = 10;

                } else if (q.type === 'FUNC_PROC' || q.type === 'TRIGGER') {
                    const testScript = q.verification_script.replace(/@SCHEMA/g, `[${schemaName}]`);
                    await reqCheck.query(testScript);
                    score = 10;
                }

                if (score > 0) status = "Passed";
                await transaction.commit();

            } catch (e) {
                await transaction.rollback();
                status = `Failed: ${e.message}`;
            }

            totalScore += score;
            details.push({ questionId: q.id, title: q.title, score, status });
        }

        res.json({ success: true, totalScore, details });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});