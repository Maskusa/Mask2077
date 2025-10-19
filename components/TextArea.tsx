
import React from 'react';

interface TextAreaProps {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
}

const TextArea: React.FC<TextAreaProps> = ({ label, value, onChange, placeholder, rows = 6 }) => {
  return (
    <div className="flex flex-col w-full">
      <label htmlFor={label} className="mb-2 text-sm font-medium text-gray-400">
        {label}
      </label>
      <textarea
        id={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 resize-y"
      />
    </div>
  );
};

export default TextArea;
