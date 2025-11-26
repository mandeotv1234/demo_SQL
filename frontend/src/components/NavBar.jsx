import React from 'react';
import NavButton from './NavButton';

export default function NavBar({ view, setView }) {
    return (
        <nav className="bg-white shadow px-6 py-3 flex items-center justify-between">
            <div className="font-bold text-xl text-blue-800 flex items-center gap-2">
                <span>🗄️</span> SQL Exam Simulator
            </div>
            <div className="flex gap-3">
                <NavButton active={view === 'home'} onClick={() => setView('home')}>Home</NavButton>
                <NavButton active={view === 'teacher'} onClick={() => setView('teacher')}>Giảng Viên</NavButton>
                <NavButton active={view === 'student'} onClick={() => setView('student')}>Sinh Viên (Thi)</NavButton>
            </div>
        </nav>
    );
}