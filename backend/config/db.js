const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'Password123!',
    server: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'ExamDB',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 1000, min: 0, idleTimeoutMillis: 30000 }
};

async function getPool() {
    try {
        return await sql.connect(dbConfig);
    } catch (err) {
        if (err.code === 'ELOGIN' || err.originalError?.info?.number === 4060) {
            console.log("Database ExamDB not found. Creating...");
            const masterConfig = { ...dbConfig, database: 'master' };
            const masterPool = await sql.connect(masterConfig);
            await masterPool.request().query("CREATE DATABASE ExamDB;");
            await masterPool.close();
            console.log("Created ExamDB. Reconnecting...");
            return await sql.connect(dbConfig);
        }
        throw err;
    }
}

async function initDb() {
    try {
        const pool = await getPool();
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
        console.log("System initialized successfully.");
    } catch (err) {
        console.error("Init DB Error:", err.message);
    }
}

module.exports = { getPool, initDb, sql };
