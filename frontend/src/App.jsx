import React, { useState } from 'react';
import NavBar from './components/NavBar';
import HomeView from './components/HomeView';
import TeacherView from './components/TeacherView';
import StudentView from './components/StudentView';

function App() {
    const [view, setView] = useState('home');

    return (
        <div className=" bg-gray-100 font-sans text-gray-800">
            <NavBar view={view} setView={setView} />
            <div className="p-6">
                {view === 'home' && <HomeView />}
                {view === 'teacher' && <TeacherView />}
                {view === 'student' && <StudentView />}
            </div>
        </div>
    );
}

export default App;