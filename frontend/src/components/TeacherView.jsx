import React, { useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

export default function TeacherView() {
    const [formData, setFormData] = useState({
        title: '', type: 'DDL_CREATE', content: '', expectedSql: '', verificationScript: ''
    });

    const handleSubmit = async () => {
        try {
            await axios.post(`${API_URL}/questions`, formData);
            alert('Đã thêm câu hỏi thành công!');
            setFormData({ ...formData, title: '', content: '' });
        } catch(e) { alert(e.message); }
    };

    return (
        <div className="max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-lg">
            <h2 className="text-2xl font-bold mb-6 text-green-700 border-b pb-2">Soạn Đề Thi (SQL Server)</h2>
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

                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 text-sm">
                    <h4 className="font-bold text-blue-800 mb-2">💡 Hướng dẫn Config:</h4>
                    <ul className="list-disc ml-5 space-y-1 text-blue-900">
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

                <button onClick={handleSubmit} className="btn-primary bg-green-600 hover:bg-green-700">Lưu Câu Hỏi</button>
            </div>
        </div>
    );
}