import React, { useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

export default function QuestionRunner({ question, index, studentId, onSqlChange }) {
    const [sqlCode, setSqlCode] = useState('');
    const [output, setOutput] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleRun = async () => {
        setLoading(true);
        setOutput(null);
        try {
            const res = await axios.post(`${API_URL}/run-query`, {
                studentId, questionId: question.id, studentSql: sqlCode
            });
            setOutput(res.data);
        } catch (e) {
            setOutput({ success: false, message: "Lỗi thực thi: " + e.message });
        }
        setLoading(false);
    };

    return (
        <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b flex justify-between items-start">
                <div>
                    <h3 className="font-bold text-lg text-gray-800">Câu {index}: {question.title}</h3>
                    <p className="text-gray-600 mt-1 whitespace-pre-wrap">{question.content}</p>
                </div>
                <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded uppercase font-bold tracking-wider">{question.type}</span>
            </div>

            <div className="flex flex-col lg:flex-row h-[500px]">
                <div className="lg:w-1/2 flex flex-col border-r border-gray-200">
                    <div className="bg-gray-100 px-4 py-2 text-xs font-bold text-gray-500 uppercase">SQL Editor</div>
                    <textarea
                        className="flex-1 w-full bg-[#1e1e1e] text-green-400 font-mono p-4 resize-none focus:outline-none text-sm leading-6"
                        placeholder="-- Viết lệnh SQL Server tại đây..."
                        value={sqlCode}
                        onChange={e => {
                            setSqlCode(e.target.value);
                            onSqlChange && onSqlChange(question.id, e.target.value);
                        }}
                    />
                    <div className="p-3 bg-gray-100 border-t">
                        <button
                            onClick={handleRun} disabled={loading}
                            className={`w-full py-2 rounded font-bold text-white transition-all ${
                                loading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 shadow-md transform active:scale-95'
                            }`}
                        >
                            {loading ? 'Executing...' : '▶ Run Query'}
                        </button>
                    </div>
                </div>

                <div className="lg:w-1/2 flex flex-col bg-white">
                    <div className="bg-gray-100 px-4 py-2 text-xs font-bold text-gray-500 uppercase flex justify-between">
                        <span>Result Visualizer</span>
                        {output && output.success && <span className="text-green-600">Success</span>}
                        {output && !output.success && <span className="text-red-600">Error</span>}
                    </div>

                    <div className="flex-1 overflow-auto p-4 relative">
                        {!output ? (
                            <div className="absolute inset-0 flex items-center justify-center text-gray-400 italic">
                                Chạy code để xem kết quả trực quan...
                            </div>
                        ) : !output.success ? (
                            <div className="text-red-600 bg-red-50 p-4 rounded border border-red-200 font-mono text-sm">
                                ⚠ {output.message}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="text-green-700 bg-green-50 p-2 rounded border border-green-200 text-sm">
                                    ✔ {output.message}
                                </div>

                                {/* DDL_CREATE - Hiển thị NHIỀU BẢNG */}
                                {output.schema && output.schema.length > 0 && (
                                    <div className="space-y-4">
                                        {(() => {
                                            // Group columns by TABLE_NAME
                                            const tableGroups = output.schema.reduce((acc, col) => {
                                                const tableName = col.TABLE_NAME || 'Unknown';
                                                if (!acc[tableName]) acc[tableName] = [];
                                                acc[tableName].push(col);
                                                return acc;
                                            }, {});

                                            return Object.entries(tableGroups).map(([tableName, columns]) => (
                                                <div key={tableName} className="border border-gray-800 rounded shadow-lg bg-white">
                                                    <div className="bg-blue-600 text-white border-b border-gray-800 p-2 font-bold text-center text-sm">
                                                        {tableName}
                                                    </div>
                                                    <div className="p-2 text-sm space-y-1">
                                                        {columns.map((col, i) => (
                                                            <div key={i} className="flex items-center gap-2 border-b border-dotted last:border-0 pb-1">
                                                                <span className="w-4 flex justify-center">
                                                                    {col.IS_PK === 1 ? <span className="text-yellow-500 text-xs">🔑</span> : ''}
                                                                </span>
                                                                <span className="font-semibold text-gray-800">{col.COLUMN_NAME}</span>
                                                                <span className="text-xs text-gray-500 ml-auto">
                                                                    {col.DATA_TYPE}
                                                                    {col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : ''}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                )}

                                {/* DML_INSERT - Hiển thị NHIỀU BẢNG với data */}
                                {output.data && typeof output.data === 'object' && !Array.isArray(output.data) && (
                                    <div className="space-y-4">
                                        {Object.entries(output.data).map(([tableName, tableData]) => (
                                            <div key={tableName} className="border rounded shadow-sm">
                                                <div className="bg-blue-600 text-white p-2 font-bold text-sm flex justify-between items-center">
                                                    <span>{tableName}</span>
                                                    <span className="text-xs bg-blue-700 px-2 py-1 rounded">
                                                        {tableData.count || 0} rows
                                                    </span>
                                                </div>
                                                
                                                {tableData.error ? (
                                                    <div className="p-3 text-red-600 text-sm">
                                                        ⚠ {tableData.error}
                                                    </div>
                                                ) : tableData.rows && tableData.rows.length > 0 ? (
                                                    <div className="overflow-x-auto">
                                                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                                                            <thead className="bg-gray-100">
                                                                <tr>
                                                                    {Object.keys(tableData.rows[0]).map(key => (
                                                                        <th key={key} className="px-3 py-2 text-left font-bold text-gray-600 uppercase tracking-wider">
                                                                            {key}
                                                                        </th>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody className="bg-white divide-y divide-gray-200">
                                                                {tableData.rows.map((row, i) => (
                                                                    <tr key={i} className="hover:bg-gray-50">
                                                                        {Object.values(row).map((val, j) => (
                                                                            <td key={j} className="px-3 py-2 whitespace-nowrap text-gray-700">
                                                                                {val === null ? 'NULL' : val.toString()}
                                                                            </td>
                                                                        ))}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                ) : (
                                                    <div className="p-3 text-gray-500 text-sm italic">
                                                        Chưa có dữ liệu
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* QUERY_SELECT - Hiển thị kết quả query (array) */}
                                {output.data && Array.isArray(output.data) && output.data.length > 0 && (
                                    <div className="overflow-x-auto border rounded shadow-sm">
                                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                                            <thead className="bg-gray-100">
                                            <tr>
                                                {Object.keys(output.data[0]).map(key => (
                                                    <th key={key} className="px-3 py-2 text-left font-bold text-gray-600 uppercase tracking-wider">{key}</th>
                                                ))}
                                            </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                                            {output.data.map((row, i) => (
                                                <tr key={i} className="hover:bg-gray-50">
                                                    {Object.values(row).map((val, j) => (
                                                        <td key={j} className="px-3 py-2 whitespace-nowrap text-gray-700">
                                                            {val === null ? 'NULL' : val.toString()}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                        <div className="p-2 text-xs text-gray-500 text-right bg-gray-50">
                                            Total rows: {output.data.length}
                                        </div>
                                    </div>
                                )}

                                {/* FUNCTION, PROCEDURE, TRIGGER - Hiển thị kết quả đặc biệt */}
                                {['FUNCTION','PROCEDURE','TRIGGER'].includes(question.type) && (
                                    <div className="space-y-2">
                                        {output.data && (
                                            <div className="bg-gray-50 border p-2 rounded text-sm">
                                                <pre>{JSON.stringify(output.data, null, 2)}</pre>
                                            </div>
                                        )}
                                        {output.message && (
                                            <div className="bg-yellow-50 border p-2 rounded text-sm text-yellow-800">
                                                {output.message}
                                            </div>
                                        )}
                                        {!output.data && !output.message && (
                                            <div className="bg-gray-100 border p-2 rounded text-sm text-gray-600">
                                                Đã thực thi lệnh {question.type}. Nếu là trigger, hãy kiểm tra dữ liệu hoặc thông báo lỗi.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}