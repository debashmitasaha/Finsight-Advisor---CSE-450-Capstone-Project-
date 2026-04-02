
import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import Logo from '../components/Logo';

interface SplashScreenProps {
  onComplete: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Trigger entry animation
    setTimeout(() => setIsVisible(true), 100);

    // Auto-transition after 4 seconds for maximum impact
    const timer = setTimeout(() => {
      handleExit();
    }, 4000);

    return () => clearTimeout(timer);
  }, []);

  const handleExit = () => {
    setIsExiting(true);
    setTimeout(onComplete, 800); // Wait for exit animation
  };

  return (
    <div 
      className={`fixed inset-0 z-[2000] bg-slate-950 flex items-center justify-center transition-all duration-1000 ease-in-out ${
        isExiting ? 'opacity-0 scale-110 pointer-events-none' : 'opacity-100'
      }`}
      onClick={handleExit}
    >
      {/* Dynamic Background Effects */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/10 rounded-full blur-[160px] animate-pulse"></div>
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-indigo-600/5 rounded-full blur-[120px]"></div>

      <div className="relative flex flex-col items-center">
        {/* Main Logo Animation Container */}
        <div 
          className={`relative transition-all duration-1000 ease-out transform ${
            isVisible ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-20 opacity-0 scale-75'
          }`}
        >
          {/* Animated Background Rings */}
          <div className="absolute inset-0 -m-8 border border-blue-500/20 rounded-[3rem] animate-ping opacity-20"></div>
          <div className="absolute inset-0 -m-12 border border-blue-400/10 rounded-[4rem] animate-ping opacity-10 [animation-delay:0.5s]"></div>
          
          <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-white/5 relative z-10 overflow-hidden">
            <Logo size={120} variant="white" />
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/20 to-transparent pointer-events-none"></div>
          </div>
        </div>

        {/* Company Branding */}
        <div className="mt-12 text-center overflow-hidden">
          <h1 
            className={`text-5xl font-black tracking-[0.25em] text-white transition-all duration-1000 delay-500 ease-out transform ${
              isVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
            }`}
          >
            FINSIGHT ADVISOR
          </h1>
          
          <div 
            className={`flex items-center justify-center gap-3 mt-6 text-blue-400 font-bold uppercase tracking-[0.5em] text-[11px] transition-all duration-1000 delay-800 ease-out transform ${
              isVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <Sparkles size={14} className="animate-pulse" />
            AI PRECISION FINANCE
          </div>
        </div>

        {/* Status indicator */}
        <div 
          className={`absolute bottom-[-140px] transition-all duration-1000 delay-1000 ease-out transform ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="flex flex-col items-center gap-3">
             <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden relative">
               <div className="absolute top-0 left-0 h-full bg-blue-500 animate-[loading_4s_ease-in-out]"></div>
             </div>
             <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.3em]">Establishing Secure Instance...</p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes loading {
          0% { width: 0%; }
          100% { width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default SplashScreen;
