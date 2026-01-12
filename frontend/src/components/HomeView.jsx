import React from 'react';

export default function HomeView() {
    return (
        <div className="text-center mt-20 w-full mx-auto">
            <h1 className="text-4xl font-bold text-gray-800 mb-6">Hệ thống thi CSDL Trực Quan</h1>
            <p className="text-lg text-gray-600 mb-8">
                Hỗ trợ SQL Server, Schema Isolation. <br/>
                Tính năng nổi bật: <b>Vẽ Diagram tự động</b> khi chạy lệnh Create Table và <b>Data Grid</b> khi chạy Query.
            </p>
            <div className="grid grid-cols-2 gap-6">
                <div className="p-6 bg-white rounded-xl shadow border hover:border-blue-500 transition cursor-pointer">
                    <h3 className="text-xl font-bold mb-2 text-green-600">Teacher Mode</h3>
                    <p>Soạn đề thi, đáp án và script chấm điểm tự động.</p>
                </div>
                <div className="p-6 bg-white rounded-xl shadow border hover:border-purple-500 transition cursor-pointer">
                    <h3 className="text-xl font-bold mb-2 text-purple-600">Student Mode</h3>
                    <p>Làm bài thi với database riêng biệt. Chạy thử code xem kết quả trực quan trước khi nộp.</p>
                </div>
            </div>
        </div>
    );
}
