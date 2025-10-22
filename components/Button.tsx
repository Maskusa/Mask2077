import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'neutral' | 'highlight';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-800',
  secondary: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-800',
  neutral: 'bg-gray-700 hover:bg-gray-600 text-white focus:ring-gray-500',
  highlight: 'bg-yellow-400 hover:bg-yellow-300 text-black focus:ring-yellow-500',
};

const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', className = '', ...props }) => {
  const baseClasses =
    'w-full font-semibold py-3 px-4 rounded-lg focus:outline-none focus:ring-4 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md';

  return (
    <button className={`${baseClasses} ${variantClasses[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

export default Button;
