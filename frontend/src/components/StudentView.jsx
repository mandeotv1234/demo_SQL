import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import QuestionRunner from './QuestionRunner';
import ScoreBoard from './ScoreBoard';

export default function StudentView() {
    const [studentId] = useState(() => 'sv_' + Math.floor(Math.random() * 9000 + 1000));
    const [questions, setQuestions] = useState([]);
    const [isInit, setIsInit] = useState(false);
    const [submitResult, setSubmitResult] = useState(null);
    const [studentAnswers, setStudentAnswers] = useState({});
    const [loadingSubmit, setLoadingSubmit] = useState(false);

    useEffect(() => {
        axios.get(`${API_URL}/questions`).then(res => setQuestions(res.data));
    }, []);

    const initEnv = async () => {
        try {
            await axios.post(`${API_URL}/init-exam`, { studentId });
            setIsInit(true);
        } catch (e) { alert("Lỗi init: " + e.message); }
    };

    const handleSqlChange = (questionId, sqlCode) => {
        setStudentAnswers(prev => ({
            ...prev,
            [questionId]: sqlCode
        }));
    };

    const handleSubmitExam = async () => {
        if (!confirm("Bạn có chắc chắn muốn nộp bài? Hành động này sẽ tính điểm cuối cùng.")) return;
        setLoadingSubmit(true);
        try {
            // Chuẩn bị dữ liệu gửi lên BE
            const submissionData = {
                studentId,
                answers: questions.map(q => ({
                    questionId: q.id,
                    questionTitle: q.title,
                    questionType: q.type,
                    studentSql: studentAnswers[q.id] || ''
                }))
            };
            const res = await axios.post(`${API_URL}/submit-exam`, submissionData);
            setSubmitResult(res.data);
        } catch (e) { alert("Lỗi nộp bài: " + e.message); }
        setLoadingSubmit(false);
    };

    if (!isInit) return (
        <div className="flex flex-col items-center justify-center h-96">
            <h2 className="text-3xl font-bold mb-4">Chào {studentId}</h2>
            <button onClick={initEnv} className="btn-primary py-3 px-8 text-lg">Bắt đầu làm bài</button>
        </div>
    );

    if (submitResult) return <ScoreBoard result={submitResult} studentId={studentId} />;

    return (
        <div className="w-full mx-auto relative">
            {loadingSubmit && (
                <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center">
                    <div className="bg-white rounded-xl shadow-lg p-8 flex flex-col items-center">
                        <div className="animate-spin h-12 w-12 border-4 border-blue-500 border-t-transparent rounded-full mb-4"></div>
                        <div className="font-bold text-lg text-blue-700">Đang nộp bài và chấm điểm...</div>
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center mb-6 bg-white p-4 rounded-lg shadow-sm">
                <div>
                    <h2 className="font-bold text-lg">Thí sinh: {studentId}</h2>
                    <span className="text-sm text-gray-500">Môi trường thi đã được cô lập.</span>
                </div>
                <button onClick={handleSubmitExam} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded font-bold shadow animate-pulse">
                    NỘP BÀI & CHẤM ĐIỂM
                </button>
            </div>

            <div className="space-y-10">
                {questions.map((q, idx) => (
                    <QuestionRunner 
                        key={q.id} 
                        question={q} 
                        index={idx + 1} 
                        studentId={studentId}
                        onSqlChange={handleSqlChange}
                    />
                ))}
            </div>

            <div className="mt-10 text-center">
                <button onClick={handleSubmitExam} className="bg-red-600 hover:bg-red-700 text-white px-10 py-4 rounded-xl font-bold text-xl shadow-lg">
                    HOÀN THÀNH BÀI THI
                </button>
            </div>
        </div>
    );
}