import React from 'react';

export default function NavButton({ active, children, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
                active ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'
            }`}
        >
            {children}
        </button>
    );
}