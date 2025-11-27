const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { getPool, sql } = require('../config/db');
const { parsePdf } = require('../utils/pdfParser');
const { genAI } = require('../config/genai');

router.get('/questions', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM questions ORDER BY id');
        console.log("Fetched questions:", result.recordset.length);
        console.log(result.recordset);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/questions', async (req, res) => {
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

// Upload PDF -> AI parse -> insert questions
router.post('/upload-questions', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!genAI) return res.status(500).json({ error: "AI Key chưa được cấu hình trong server." });

    try {
        console.log("PDF received. Sending directly to AI...");

        // 1. Chuyển PDF buffer sang base64
        const pdfBase64 = req.file.buffer.toString('base64');

        // 2. Gọi Gemini AI với file PDF trực tiếp
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

        const prompt = `
            You are a STRICT SQL Server Exam Question Generator.

            INPUT: A PDF containing SQL Server exam questions with database schema and requirements.

            OUTPUT: A JSON array of question objects. NO MARKDOWN. NO EXPLANATIONS. ONLY THE JSON ARRAY.

            TASK STEPS:
            1. If the PDF contains multiple exam codes (e.g., "Đề 1000", "Đề 1010"):
            - Extract ONLY the FIRST exam code section
            - Ignore all other exam codes completely

            2. From that exam section, extract:
            - Database schema (table names, columns, data types, constraints)
            - Exam requirements (usually 5 questions)

            3. For EACH exam requirement, generate ONE question object with these fields:

            {
            "title": "<Brief question title based on requirement>",
            "type": "<ONE of: DDL_CREATE | DML_INSERT | QUERY_SELECT | FUNC_PROC>",
            "content": "<Full problem description - use ONLY info from PDF, do NOT invent anything>",
            "expected_sql": "<Correct T-SQL solution using schema from PDF>",
            "verification_script": "<See rules below>"
            }

            VERIFICATION_SCRIPT RULES - READ EVERY WORD:

            A) For DDL_CREATE type - EXTREMELY IMPORTANT:
            
            STEP 1: Write your expected_sql first
            STEP 2: Count CREATE TABLE statements in expected_sql
            STEP 3: Extract the table name from EACH CREATE TABLE statement
            STEP 4: Join ALL table names with commas (no spaces)
            
            EXAMPLES TO FOLLOW:
            
            Example 1:
            expected_sql contains:
                CREATE TABLE GIAITHUONG(...)
                CREATE TABLE LETRAOGIAI(...)
                CREATE TABLE PHIM(...)
            → verification_script MUST BE: "GIAITHUONG,LETRAOGIAI,PHIM"
            ❌ WRONG: "PHIM"
            ❌ WRONG: "GIAITHUONG"
            ✅ CORRECT: "GIAITHUONG,LETRAOGIAI,PHIM"
            
            Example 2:
            expected_sql contains:
                CREATE TABLE Students(...)
            → verification_script MUST BE: "Students"
            ✅ CORRECT: "Students"
            
            Example 3:
            expected_sql contains:
                CREATE TABLE A(...)
                CREATE TABLE B(...)
            → verification_script MUST BE: "A,B"
            ❌ WRONG: "B"
            ✅ CORRECT: "A,B"

            B) For DML_INSERT type:
            - verification_script = minimum number of rows to insert (e.g., "5")

            C) For QUERY_SELECT type:
            - verification_script = ""

            D) For FUNC_PROC type:
            - verification_script = SQL test script using @SCHEMA placeholder

            SELF-CHECK BEFORE RETURNING JSON:
            For each DDL_CREATE question, ask yourself:
            "Did I list EVERY table name from my expected_sql in verification_script?"
            If NO → Fix it!

            CONSTRAINTS:
            - Use ONLY table names, column names, data types from the PDF
            - Do NOT invent new tables, columns, or requirements
            - Do NOT use examples from previous conversations
            - If PDF data is insufficient, return: {"error": "PDF data insufficient"}

            OUTPUT FORMAT: Pure JSON array. No \`\`\`json\`\`\` markers.
        `;

        const result = await model.generateContent([
            {
                inlineData: {
                    mimeType: 'application/pdf',
                    data: pdfBase64
                }
            },
            { text: prompt }
        ]);

        const response = await result.response;

        console.log("AI Response received. Parsing...");
        console.log(response.text());

        let text = response.text();

        // Clean JSON string
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        const questions = JSON.parse(text);

        // Check for error response
        if (questions.error) {
            return res.status(400).json({ error: questions.error });
        }

        // 3. Lưu vào Database
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const q of questions) {
                const request = new sql.Request(transaction);
                await request
                    .input('title', sql.NVarChar, q.title)
                    .input('type', sql.VarChar, q.type)
                    .input('content', sql.NVarChar, q.content)
                    .input('expected_sql', sql.NVarChar, q.expected_sql)
                    .input('verification_script', sql.NVarChar, q.verification_script)
                    .query(`INSERT INTO questions (title, type, content, expected_sql, verification_script)
                            VALUES (@title, @type, @content, @expected_sql, @verification_script)`);
            }
            await transaction.commit();
            res.json({ success: true, message: `Successfully generated & imported ${questions.length} questions from PDF!` });
        } catch (dbErr) {
            await transaction.rollback();
            throw dbErr;
        }
    } catch (err) {
        console.error("AI/DB Error:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;