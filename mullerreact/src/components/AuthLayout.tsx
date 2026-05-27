import React from 'react';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children, title, subtitle }) => {
  return (
    <div className="min-h-screen bg-slate-50 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-100 via-slate-50 to-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md animate-fade-in-scale">
        <div className="flex justify-center">
          {/* Refined Logo */}
          <div className="h-12 w-12 rounded-xl bg-violet-600 shadow-lg shadow-violet-200 flex items-center justify-center text-white font-bold text-2xl rotate-3 hover:rotate-0 transition-transform duration-300 cursor-pointer">
            M
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-slate-900">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-2 text-center text-sm text-slate-600 px-4">
            {subtitle}
          </p>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md animate-fade-in-scale" style={{ animationDelay: '100ms' }}>
        <div className="bg-white/80 backdrop-blur-sm py-8 px-4 shadow-xl shadow-slate-200/50 ring-1 ring-slate-200 sm:rounded-2xl sm:px-10">
          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;