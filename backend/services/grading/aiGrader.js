const { genAI } = require('../../config/genai');
const { sql } = require('../../config/db');

/**
 * AI Grading Service - Chấm TẤT CẢ câu hỏi trong 1 lần gọi AI
 * 
 * Workflow ĐƠN GIẢN:
 * 1. Gửi đề + expected_sql + student_sql cho AI
 * 2. AI phân tích và trả về điểm + feedback
 * 3. Không cần query schema info phức tạp
 * 
 * @param {object} pool - Database connection pool (không dùng)
 * @param {string} schemaName - Schema của sinh viên (không dùng)
 * @param {Array} questions - Mảng tất cả câu hỏi (có studentSql)
 * @returns {Promise<Array>} Mảng kết quả cho từng câu
 */
async function gradeAllWithAI(pool, schemaName, questions) {
    try {
        if (!genAI) {
            return questions.map(q => ({
                questionId: q.id,
                score: 0,
                maxScore: 10,
                feedback: ['AI chấm điểm chưa được cấu hình'],
                status: 'Error'
            }));
        }

        // Tạo prompt đơn giản - chỉ gửi đề + expected + student answer
        const prompt = buildSimpleGradingPrompt(questions);

        // Gọi AI 1 lần duy nhất
        console.log('Calling AI for batch grading...');
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        const result = await model.generateContent(prompt);
        const response = await result.response;

        console.log("AI Batch Grading Response:", response.text());

        // Parse kết quả từ AI
        let text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const gradingResults = JSON.parse(text);

        // Validate và format kết quả
        if (!Array.isArray(gradingResults)) {
            throw new Error('AI response must be an array');
        }

        return gradingResults.map(result => ({
            questionId: result.questionId,
            score: result.score || 0,
            maxScore: 10,
            feedback: result.feedback || ['Không có feedback'],
            status: result.status || 'Error'
        }));

    } catch (error) {
        console.error('AI Batch Grading Error:', error);

        // Trả về lỗi cho tất cả câu
        return questions.map(q => ({
            questionId: q.id,
            score: 0,
            maxScore: 10,
            feedback: [`Lỗi AI: ${error.message}`],
            status: 'Error'
        }));
    }
}

/**
 * Tạo prompt ĐƠN GIẢN cho AI - chỉ gửi đề + expected + student answer
 */
function buildSimpleGradingPrompt(questions) {
    const questionsData = questions.map((q, index) => {
        return `
========================================
QUESTION ${index + 1} (ID: ${q.id})
========================================
Type: ${q.type}
Title: ${q.title}
Content: ${q.content}

Expected Solution (Đáp án chuẩn):
${q.expected_sql}

Student's Answer (Bài làm của sinh viên):
${q.studentSql || '(Không có bài làm)'}

Verification Script: ${q.verification_script}
        `.trim();
    }).join('\n\n');

    return `
You are a STRICT SQL exam grader for SQL Server.

You are grading ${questions.length} questions for a student. 

Compare the EXPECTED SOLUTION with the STUDENT'S ANSWER for each question and grade according to DETAILED CRITERIA below.

${questionsData}

========================================
DETAILED GRADING CRITERIA BY QUESTION TYPE
========================================

🔷 DDL_CREATE (Create Table) - 10 points total
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each table required (split 10 points evenly across tables):

📋 TIER 1 - Table Structure (30% per table = 3 points)
   • Table name exists and matches (case-insensitive)
   • If table missing entirely → 0 points for that table
   • If table name wrong → 0 points for that table

📋 TIER 2 - Columns (40% per table = 4 points)
   Check EACH column:
   • Column name matches (case-insensitive)
   • Data type EXACT match:
     - CHAR ≠ VARCHAR ≠ NVARCHAR
     - INT ≠ BIGINT ≠ SMALLINT
     - DECIMAL(10,2) ≠ DECIMAL(10,0)
   • Length matches:
     - CHAR(5) ≠ CHAR(10)
     - VARCHAR(50) ≠ VARCHAR(100)
   • NOT NULL constraint matches
   
   Score calculation:
   • (Correct columns / Total required columns) × 4 points
   • Wrong data type = wrong column
   • Wrong length = wrong column
   • Missing NOT NULL = -0.5 per column

📋 TIER 3 - Primary Key (15% per table = 1.5 points)
   • PRIMARY KEY constraint exists
   • Correct column(s) in PK
   • Single column PK vs Composite PK must match
   • If PK missing → 0 points for this tier
   • If PK on wrong column → 0 points

📋 TIER 4 - Foreign Key (15% per table = 1.5 points)
   • FOREIGN KEY constraint exists for each required FK
   • References correct parent table
   • References correct parent column
   • ON DELETE/ON UPDATE actions (if specified)
   • Score: (Correct FKs / Total required FKs) × 1.5
   • If no FK required and none provided → 1.5 points
   • If FK required but missing → 0 points

EXAMPLE: Question requires 3 tables
• Table 1 perfect: 10/3 = 3.33 points
• Table 2 has wrong data type on 1/4 columns: 3.33 × (0.3 + 0.3 + 0.15 + 0.15) = 3.0 points  
• Table 3 missing FK: 3.33 × (0.3 + 0.4 + 0.15 + 0) = 2.83 points
• TOTAL: 3.33 + 3.0 + 2.83 = 9.16 points

🔷 DML_INSERT (Insert Data) - 10 points total
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 TIER 1 - Syntax & Structure (30% = 3 points)
   • Valid INSERT INTO syntax
   • Correct table names
   • Correct column list (if specified)
   • VALUES keyword present
   • Semicolons if needed
   • No syntax errors

📋 TIER 2 - Number of Statements (40% = 4 points)
   • Count INSERT statements in student answer
   • Compare with expected solution
   • Score: (Student INSERTs / Expected INSERTs) × 4
   • Cap at 4 points max
   • If student has MORE inserts than required → still 4 points
   • If student has FEWER → proportional score

📋 TIER 3 - Data Values (20% = 2 points)
   • Check if data values are reasonable
   • Primary key values are unique
   • Foreign key values reference existing data
   • NOT NULL columns have values
   • Don't require EXACT match with expected values
   • Accept variations in names, dates, numbers
   • Just check if data makes sense

📋 TIER 4 - Table Coverage (10% = 1 point)
   • All required tables have INSERT statements
   • If expected solution inserts into 3 tables:
     - 3 tables covered → 1 point
     - 2 tables covered → 0.67 points
     - 1 table covered → 0.33 points

EXAMPLE:
• Syntax correct: 3 points
• Has 8/10 expected INSERTs: 4 × 0.8 = 3.2 points
• Data values reasonable: 2 points
• All 3 tables covered: 1 point
• TOTAL: 3 + 3.2 + 2 + 1 = 9.2 points

🔷 QUERY_SELECT (Select Query) - 10 points total
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 TIER 1 - SELECT Clause (25% = 2.5 points)
   • All required columns present
   • Correct column names or aliases
   • Correct aggregate functions (SUM, COUNT, AVG, etc.)
   • DISTINCT if required
   • Score: (Correct columns / Total required) × 2.5

📋 TIER 2 - FROM & JOIN (30% = 3 points)
   • All required tables in FROM clause
   • Correct JOIN types (INNER, LEFT, RIGHT, FULL)
   • Correct JOIN conditions (ON clause)
   • Correct number of joins
   • Score breakdown:
     - Correct tables: 1 point
     - Correct JOIN types: 1 point  
     - Correct JOIN conditions: 1 point

📋 TIER 3 - WHERE Clause (25% = 2.5 points)
   • All required filter conditions present
   • Correct operators (=, >, <, LIKE, IN, BETWEEN)
   • Correct logic (AND, OR, NOT)
   • Correct comparison values
   • Score: (Correct conditions / Total required) × 2.5

📋 TIER 4 - Other Clauses (20% = 2 points)
   • GROUP BY: correct columns (0.7 points)
   • HAVING: correct conditions (0.5 points)
   • ORDER BY: correct columns and direction (0.5 points)
   • TOP/LIMIT: correct if required (0.3 points)
   • If clause not required → give points

EXAMPLE:
• SELECT has 4/5 required columns: 2.5 × 0.8 = 2.0 points
• JOIN correct tables and type but wrong condition: 1 + 1 + 0 = 2.0 points
• WHERE has 2/3 conditions: 2.5 × 0.67 = 1.67 points
• Has GROUP BY and ORDER BY: 0.7 + 0.5 = 1.2 points
• TOTAL: 2.0 + 2.0 + 1.67 + 1.2 = 6.87 points

🔷 FUNC_PROC (Function/Procedure) - 10 points total
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 TIER 1 - Declaration (20% = 2 points)
   • Correct keyword (CREATE PROCEDURE or CREATE FUNCTION)
   • Correct procedure/function name
   • Valid syntax for SQL Server
   • If CREATE missing → 0 points

📋 TIER 2 - Parameters (25% = 2.5 points)
   • All required parameters present
   • Correct parameter names
   • Correct data types for each parameter
   • Correct direction (INPUT, OUTPUT, default)
   • Score: (Correct params / Total required) × 2.5

📋 TIER 3 - Logic & Body (40% = 4 points)
   • Main logic matches expected solution
   • Correct SQL statements inside body
   • Correct variable declarations (DECLARE)
   • Correct control flow (IF/ELSE, WHILE, etc.)
   • Correct calculations or operations
   • Score breakdown:
     - Basic structure: 1.5 points
     - Main logic: 1.5 points
     - Edge cases handled: 1 point

📋 TIER 4 - Return/Output (15% = 1.5 points)
   For FUNCTION:
   • RETURNS clause with correct data type
   • RETURN statement with correct value
   
   For PROCEDURE:
   • OUTPUT parameters if required
   • SELECT statement if required
   • Correct return value
   
   • If return/output correct → 1.5 points
   • If return/output wrong type → 0.5 points
   • If return/output missing → 0 points

EXAMPLE:
• CREATE PROCEDURE with correct name: 2 points
• Has 3/4 parameters with correct types: 2.5 × 0.75 = 1.87 points
• Logic mostly correct but missing edge case: 1.5 + 1.5 + 0 = 3.0 points
• Correct OUTPUT parameter: 1.5 points
• TOTAL: 2 + 1.87 + 3.0 + 1.5 = 8.37 points

========================================
OUTPUT FORMAT (CRITICAL - MUST FOLLOW)
========================================

You MUST return a JSON ARRAY with one object per question:

[
  {
    "questionId": <number>,
    "score": <number 0-10>,
    "feedback": [
      "line 1 of feedback in Vietnamese",
      "line 2 of feedback in Vietnamese",
      "..."
    ],
    "status": "<Passed | Failed | Error>"
  },
  {
    "questionId": <next question id>,
    "score": <number 0-10>,
    "feedback": [...],
    "status": "..."
  },
  ...
]

[
  {
    "questionId": <number>,
    "score": <number 0-10 with decimals>,
    "feedback": [
      "line 1 of detailed feedback in Vietnamese",
      "line 2 of detailed feedback in Vietnamese",
      "..."
    ],
    "status": "<Passed | Failed | Error>"
  },
  ...
]

CRITICAL REQUIREMENTS:
1. Output ONLY the JSON array, NO markdown, NO explanation, NO extra text
2. Array length MUST equal ${questions.length} (one result per question)
3. Each questionId MUST match the input question IDs exactly
4. Score must be 0-10 with decimals (e.g., 6.7, 8.33, 9.16)
5. Feedback MUST be simple and concise in Vietnamese
6. Status: "Passed" if score ≥ 5, "Failed" if score < 5, "Error" if no submission
7. Apply EXACT criteria percentages (30%, 40%, 15%, 15% for DDL_CREATE, etc.)
8. NO ICONS (❌✅⚠️💯📊) - just plain text
9. Only list criteria that got points, skip criteria with 0 points
10. Format: "Tiêu chí X: +Y điểm"

EXAMPLE OUTPUT FOR DDL_CREATE (3 tables required):
[
  {
    "questionId": 1,
    "score": 8.96,
    "feedback": [
      "Bảng GIAITHUONG (3.33đ):",
      "- Bảng tồn tại: +1.0đ",
      "- Cột đúng 4/4: +1.33đ",
      "- Primary Key đúng: +0.5đ",
      "- Foreign Key: +0.5đ",
      "",
      "Bảng PHIM (2.3đ):",
      "- Bảng tồn tại: +1.0đ",
      "- Cột đúng 3/5: +0.8đ",
      "- Primary Key đúng: +0.5đ",
      "",
      "Bảng LETRAOGIAI (3.33đ):",
      "- Bảng tồn tại: +1.0đ",
      "- Cột đúng 3/3: +1.33đ",
      "- Primary Key đúng: +0.5đ",
      "- Foreign Key đúng 2/2: +0.5đ",
      "",
      "Tổng: 8.96/10"
    ],
    "status": "Passed"
  }
]

EXAMPLE OUTPUT FOR DML_INSERT:
[
  {
    "questionId": 2,
    "score": 9.2,
    "feedback": [
      "Cú pháp INSERT đúng: +3.0đ",
      "Số lượng câu lệnh 8/10: +3.2đ",
      "Dữ liệu hợp lệ: +2.0đ",
      "Đủ 3 bảng yêu cầu: +1.0đ",
      "",
      "Tổng: 9.2/10"
    ],
    "status": "Passed"
  }
]

EXAMPLE OUTPUT FOR QUERY_SELECT:
[
  {
    "questionId": 3,
    "score": 7.37,
    "feedback": [
      "SELECT clause đúng 4/5 cột: +2.0đ",
      "FROM/JOIN đúng bảng và loại JOIN: +2.0đ",
      "WHERE đúng 3/3 điều kiện: +2.5đ",
      "ORDER BY đúng: +0.5đ",
      "Thiếu GROUP BY: +0đ",
      "",
      "Tổng: 7.37/10"
    ],
    "status": "Passed"
  }
]

EXAMPLE OUTPUT FOR NO SUBMISSION:
[
  {
    "questionId": 4,
    "score": 0,
    "feedback": [
      "Không có bài làm"
    ],
    "status": "Error"
  }
]

Now analyze all questions using the DETAILED CRITERIA above and return grading results as a JSON array.
Remember: NO ICONS, simple format "Tiêu chí: +điểm", only list criteria that got points.
    `.trim();
}

module.exports = gradeAllWithAI;
