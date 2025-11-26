const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAIKey = process.env.GENAI_API_KEY;
if (!genAIKey) {
    console.error('❌ Missing GENAI_API_KEY in .env (backend/.env recommended).');
}

const genAI = genAIKey ? new GoogleGenerativeAI(genAIKey) : null;

module.exports = { genAI };