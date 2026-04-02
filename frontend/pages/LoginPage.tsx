
import React, { useState } from 'react';
import { Eye, EyeOff, Lock, User as UserIcon, Play } from 'lucide-react';
import Logo from '../components/Logo';

interface LoginPageProps {
  onLogin: (accountNo: string, pass: string) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [accountNo, setAccountNo] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLogin(accountNo, password);
  };

  const handleLogin = (acc: string, pass: string) => {
    setIsLoading(true);
    setTimeout(() => {
      onLogin(acc, pass);
      setIsLoading(false);
    }, 800);
  };

  const quickLogin = (acc: string) => {
    setAccountNo(acc);
    setPassword('password123'); // Standard demo password
    handleLogin(acc, 'password123');
  };

  const isFormValid = accountNo.length > 0 && password.length >= 8;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-blue-600 rounded-[2.5rem] shadow-2xl shadow-blue-500/20 mb-8 group transition-transform hover:scale-105 duration-300 relative overflow-hidden">
            <Logo size={56} variant="white" />
            <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none"></div>
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">FinSight Advisor</h1>
          <p className="text-slate-500 mt-3 font-medium">Empowering your financial decisions with AI</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl shadow-slate-200/50 p-8 lg:p-10 border border-slate-100">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 tracking-tight">Account Number</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <UserIcon size={18} className="text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                <input
                  type="text"
                  placeholder="Enter Account Number"
                  className="block w-full pl-11 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent transition-all placeholder:text-slate-400 font-semibold"
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 tracking-tight">Password</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock size={18} className="text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  className="block w-full pl-11 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent transition-all placeholder:text-slate-400 font-semibold"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={!isFormValid || isLoading}
              className={`w-full py-4 rounded-2xl font-black text-white shadow-lg shadow-blue-500/20 transition-all transform active:scale-[0.98] ${
                isFormValid && !isLoading 
                ? 'bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5' 
                : 'bg-slate-300 cursor-not-allowed'
              }`}
            >
              {isLoading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Logging in...</span>
                </div>
              ) : 'Login to Dashboard'}
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-slate-100 flex flex-col items-center gap-4">
             <p className="text-xs text-slate-400 font-bold tracking-widest uppercase">Quick Start (Demo Mode)</p>
             <div className="flex gap-2">
               <button 
                 onClick={() => quickLogin('SA001')}
                 className="px-3 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 rounded-full text-[10px] font-black text-slate-600 transition-all flex items-center gap-1"
               >
                 <Play size={10} className="fill-current" /> Super Admin
               </button>
               <button 
                 onClick={() => quickLogin('ADM001')}
                 className="px-3 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 rounded-full text-[10px] font-black text-slate-600 transition-all flex items-center gap-1"
               >
                 <Play size={10} className="fill-current" /> Admin
               </button>
               <button 
                 onClick={() => quickLogin('EMP001')}
                 className="px-3 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 rounded-full text-[10px] font-black text-slate-600 transition-all flex items-center gap-1"
               >
                 <Play size={10} className="fill-current" /> Employee
               </button>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
