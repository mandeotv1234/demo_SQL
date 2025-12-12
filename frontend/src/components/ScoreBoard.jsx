import React from 'react';

export default function ScoreBoard({ result, studentId }) {
    return (
        <div className="w-full mx-auto mt-10 bg-white p-8 rounded-xl shadow-2xl border-t-8 border-blue-600 text-center">
            <h2 className="text-3xl font-bold text-gray-800 mb-2">KẾT QUẢ BÀI THI</h2>
            <p className="text-gray-500 mb-6">Sinh viên: {studentId}</p>

            <div className="text-6xl font-bold text-blue-600 mb-8">
                {result.totalScore} <span className="text-2xl text-gray-400">/ {result.details.length * 10}</span>
            </div>

            <div className="text-left bg-gray-50 rounded-lg p-6 border">
                <h3 className="font-bold text-gray-700 mb-4 border-b pb-2">Chi tiết từng câu:</h3>
                <div className="space-y-6">
                    {result.details.map((d, i) => (
                        <div key={i} className="bg-white p-4 rounded shadow-sm border border-gray-200">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex-1">
                                    <span className="font-bold text-gray-800 mr-2">Câu {d.questionId}:</span>
                                    <span className="text-gray-600">{d.title}</span>
                                </div>
                                <div className={`font-bold px-3 py-1 rounded text-sm whitespace-nowrap ml-4 ${
                                    d.status === 'Passed' ? 'bg-green-100 text-green-700' : 
                                    d.status === 'Failed' ? 'bg-red-100 text-red-700' : 
                                    'bg-gray-100 text-gray-700'
                                }`}>
                                    {d.score.toFixed(2)}/{d.maxScore}đ
                                </div>
                            </div>
                            
                            {/* Feedback chi tiết */}
                            {d.feedback && d.feedback.length > 0 && (
                                <div className="mt-2 bg-gray-50 p-3 rounded border border-gray-200">
                                    <div className="text-xs font-bold text-gray-500 uppercase mb-2">Nhận xét:</div>
                                    <div className="space-y-1 text-sm text-gray-700">
                                        {d.feedback.map((fb, idx) => (
                                            <div key={idx} className="leading-relaxed">{fb}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
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