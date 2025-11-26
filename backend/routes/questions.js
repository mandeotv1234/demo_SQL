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
        // 1. Đọc text từ PDF
        const dataBuffer = req.file.buffer;
        const pdfData = await parsePdf(dataBuffer);
        const pdfText = pdfData.text || '';

        console.log("PDF Content extracted. Sending to AI...");

        // 2. Gọi Gemini AI để phân tích
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `
            You are a SQL Server Exam Generator. Based on the following text extracted from a PDF (which contains titles of questions), 
            generate a JSON Array of exam questions.
            
            Context: A Car Rental System (Tables: Xe, NhanVien, KhachHang, ThueXe...).
            Input Text: "${pdfText}"

            Output Requirements (Strict JSON Array):
            1. title: The question title.
            2. type: Must be one of ['DDL_CREATE', 'DML_INSERT', 'QUERY_SELECT', 'FUNC_PROC'].
            3. content: A creative, full word problem description based on the title.
            4. expected_sql: The correct T-SQL solution.
            5. verification_script: 
               - If type is DDL_CREATE: Just the Table Name (e.g., 'Xe').
               - If type is DML_INSERT: Just the minimum number of rows (e.g., '3').
               - If type is FUNC_PROC/TRIGGER: A T-SQL script to TEST the logic (use @SCHEMA placeholder).
               - If type is QUERY_SELECT: Keep it empty string.

            Example format:
            [
              {"title": "Tạo bảng Xe", "type": "DDL_CREATE", "content": "...", "expected_sql": "CREATE TABLE...", "verification_script": "Xe"},
              {"title": "Thêm xe", "type": "DML_INSERT", "content": "...", "expected_sql": "INSERT...", "verification_script": "3"}
            ]
            
            ONLY RETURN THE JSON ARRAY. NO MARKDOWN.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Clean JSON string
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        const questions = JSON.parse(text);

        // 3. Lưu vào Database
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const q of questions) {
                // FIX: Tạo request mới cho mỗi vòng lặp và dùng tham số chuẩn
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