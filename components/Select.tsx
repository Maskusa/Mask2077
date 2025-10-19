
import React from 'react';
import type { SelectOption } from '../types';

interface SelectProps {
  label: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: SelectOption[];
  disabled?: boolean;
}

const Select: React.FC<SelectProps> = ({ label, value, onChange, options, disabled = false }) => {
  return (
    <div className="flex flex-col w-full">
      <label htmlFor={label} className="mb-2 text-sm font-medium text-gray-400">
        {label}
      </label>
      <select
        id={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default Select;
