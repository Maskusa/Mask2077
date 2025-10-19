
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}

const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', ...props }) => {
  const baseClasses = "w-full font-bold py-3 px-4 rounded-lg focus:outline-none focus:ring-4 transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed shadow-lg";
  
  const variantClasses = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-800",
    secondary: "bg-red-600 hover:bg-red-700 text-white focus:ring-red-800",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]}`}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
