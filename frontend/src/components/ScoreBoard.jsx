import React from 'react';

export default function ScoreBoard({ result, studentId }) {
    return (
        <div className="max-w-3xl mx-auto mt-10 bg-white p-8 rounded-xl shadow-2xl border-t-8 border-blue-600 text-center">
            <h2 className="text-3xl font-bold text-gray-800 mb-2">KẾT QUẢ BÀI THI</h2>
            <p className="text-gray-500 mb-6">Sinh viên: {studentId}</p>

            <div className="text-6xl font-bold text-blue-600 mb-8">
                {result.totalScore} <span className="text-2xl text-gray-400">/ {result.details.length * 10}</span>
            </div>

            <div className="text-left bg-gray-50 rounded-lg p-6 border">
                <h3 className="font-bold text-gray-700 mb-4 border-b pb-2">Chi tiết từng câu:</h3>
                <div className="space-y-3">
                    {result.details.map((d, i) => (
                        <div key={i} className="flex justify-between items-center bg-white p-3 rounded shadow-sm border border-gray-100">
                            <div>
                                <span className="font-bold text-gray-800 mr-2">Câu {d.questionId}:</span>
                                <span className="text-gray-600">{d.title}</span>
                            </div>
                            <div className={`font-bold px-3 py-1 rounded text-sm ${d.score > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {d.score > 0 ? 'Đạt (10đ)' : '0đ'}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <button onClick={() => window.location.reload()} className="mt-8 text-blue-600 hover:underline">
                Làm bài thi khác
            </button>
        </div>
    );
}