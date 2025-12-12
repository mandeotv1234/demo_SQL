import React, { useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

export default function TeacherView() {
    const [formData, setFormData] = useState({
        title: '', type: 'DDL_CREATE', content: '', expectedSql: '', verificationScript: ''
    });

    const [file, setFile] = useState(null);
    const [uploadLoading, setUploadLoading] = useState(false);

    const handleSubmit = async () => {
        try {
            await axios.post(`${API_URL}/questions`, formData);
            alert('Đã thêm câu hỏi thành công!');
            setFormData({ ...formData, title: '', content: '' });
        } catch(e) { alert(e.message); }
    };

    const handleUpload = async () => {
        if (!file) return alert("Vui lòng chọn file PDF!");

        const data = new FormData();
        data.append('file', file);

        setUploadLoading(true);
        try {
            const res = await axios.post(`${API_URL}/upload-questions`, data, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            alert(res.data.message);
            setFile(null); // Reset file sau khi up thành công
        } catch (e) {
            alert("Lỗi AI Generate: " + (e.response?.data?.error || e.message));
        }
        setUploadLoading(false);
    };

    return (
        <div className="w-full  bg-white p-8 rounded-xl shadow-lg">
            <h2 className="text-2xl font-bold mb-6 text-green-700 border-b pb-2">Soạn Đề Thi (SQL Server)</h2>

            <div className="mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-200 shadow-inner">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="font-bold text-lg text-blue-800 flex items-center gap-2">
                            <span>🤖</span> Tạo đề tự động bằng AI
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                            Tải lên file PDF chứa danh sách câu hỏi. AI sẽ tự động tạo đề bài, đáp án và script chấm điểm.
                        </p>
                    </div>
                </div>

                <div className="flex gap-4 items-center bg-white p-4 rounded-lg border border-gray-200">
                    <input
                        type="file"
                        accept="application/pdf"
                        onChange={e => setFile(e.target.files[0])}
                        className="block w-full text-sm text-gray-500
                            file:mr-4 file:py-2 file:px-4
                            file:rounded-full file:border-0
                            file:text-sm file:font-semibold
                            file:bg-blue-50 file:text-blue-700
                            hover:file:bg-blue-100
                            cursor-pointer
                        "
                    />
                    <button
                        onClick={handleUpload}
                        disabled={uploadLoading}
                        className={`px-6 py-2 rounded-lg font-bold text-white whitespace-nowrap transition-all shadow-md ${
                            uploadLoading
                                ? 'bg-gray-400 cursor-wait'
                                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg transform active:scale-95'
                        }`}
                    >
                        {uploadLoading ? '⏳ Đang xử lý...' : '✨ Upload & Generate'}
                    </button>
                </div>
            </div>

            <div className="relative flex py-5 items-center">
                <div className="flex-grow border-t border-gray-300"></div>
                <span className="flex-shrink-0 mx-4 text-gray-400 font-medium text-sm uppercase tracking-wider">Hoặc nhập thủ công</span>
                <div className="flex-grow border-t border-gray-300"></div>
            </div>

            <div className="grid gap-5">
                <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                        <label className="label">Tiêu đề</label>
                        <input className="input" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="VD: Tạo bảng NhanVien" />
                    </div>
                    <div>
                        <label className="label">Loại câu hỏi</label>
                        <select className="input" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                            <option value="DDL_CREATE">Create Table</option>
                            <option value="DML_INSERT">Insert Data</option>
                            <option value="QUERY_SELECT">Select Query</option>
                            <option value="FUNC_PROC">Func/Proc/Trigger</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className="label">Nội dung đề bài</label>
                    <textarea className="input h-24" value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} />
                </div>

                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 text-sm">
                    <h4 className="font-bold text-yellow-800 mb-2">💡 Hướng dẫn Config (Nhập tay):</h4>
                    <ul className="list-disc ml-5 space-y-1 text-yellow-900">
                        <li><b>DDL_CREATE:</b> Verification = Tên bảng (VD: <code>NhanVien</code>)</li>
                        <li><b>DML_INSERT:</b> Expected = Tên bảng. Verification = Số dòng tối thiểu (VD: <code>5</code>)</li>
                        <li><b>Trigger/Proc:</b> Verification = Script Test (VD: <code>INSERT INTO...</code> để test trigger). Dùng <code>@SCHEMA</code> để thay thế tên schema động.</li>
                    </ul>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="label">Expected SQL / Table Name</label>
                        <textarea className="input h-32 font-mono text-sm" value={formData.expectedSql} onChange={e => setFormData({...formData, expectedSql: e.target.value})} />
                    </div>
                    <div>
                        <label className="label">Verification Script / Min Rows</label>
                        <textarea className="input h-32 font-mono text-sm" value={formData.verificationScript} onChange={e => setFormData({...formData, verificationScript: e.target.value})} />
                    </div>
                </div>

                <button onClick={handleSubmit} className="btn-primary bg-green-600 hover:bg-green-700 w-full py-3 text-lg shadow-md">
                    Lưu Câu Hỏi Thủ Công
                </button>
            </div>
        </div>
    );
}