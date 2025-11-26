require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const questionsRouter = require('./routes/questions');
const examRouter = require('./routes/exam');
const { initDb } = require('./config/db');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use('/api', questionsRouter);
app.use('/api', examRouter);

initDb();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});