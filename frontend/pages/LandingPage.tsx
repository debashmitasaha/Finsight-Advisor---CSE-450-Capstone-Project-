
import React from 'react';
import { ArrowRight, ShieldCheck, BarChart3, PieChart, Zap, PlayCircle } from 'lucide-react';
import Logo from '../components/Logo';

interface LandingPageProps {
  onEnter: () => void;
  onStartTour: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onEnter, onStartTour }) => {
  return (
    <div className="min-h-screen bg-slate-900 text-white overflow-hidden relative">
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px]"></div>

      {/* Navigation */}
      <nav className="relative z-10 px-6 py-8 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-3.5">
          <div className="bg-blue-600/20 p-2 rounded-xl border border-blue-500/30">
            <Logo size={32} variant="white" />
          </div>
          <span className="text-2xl font-black tracking-tighter">FinSight</span>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={onStartTour}
            className="hidden md:flex items-center gap-2 text-blue-400 hover:text-blue-300 font-bold text-sm px-6 py-3 transition-all"
          >
            <PlayCircle size={20} /> Watch Product Tour
          </button>
          <button 
            onClick={onEnter}
            className="bg-white/10 hover:bg-white/20 backdrop-blur-md px-8 py-3 rounded-2xl font-bold text-sm transition-all border border-white/10"
          >
            Partner Login
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-20 pb-32 grid lg:grid-cols-2 gap-16 items-center">
        <div className="space-y-8 animate-in fade-in slide-in-from-left-8 duration-1000">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 text-xs font-bold uppercase tracking-widest">
            <Zap size={14} className="fill-blue-400" /> Next-Gen Financial Intelligence
          </div>
          
          <h1 className="text-6xl lg:text-8xl font-black tracking-tight leading-[0.9]">
            The Future of <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">Corporate Audit.</span>
          </h1>
          
          <p className="text-xl text-slate-400 font-medium max-w-lg leading-relaxed">
            Eliminate financial blind spots with FinSight Advisor. Real-time forensic auditing, AI budget forecasting, and enterprise-grade transparency.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <button 
              onClick={onEnter}
              className="px-12 py-5 bg-blue-600 hover:bg-blue-700 rounded-[2rem] font-black text-xl flex items-center justify-center gap-3 shadow-2xl shadow-blue-500/30 transition-all hover:-translate-y-1 active:scale-95"
            >
              Get Started <ArrowRight size={24} />
            </button>
            <button 
              onClick={onStartTour}
              className="px-12 py-5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-[2rem] font-black text-xl flex items-center justify-center gap-3 transition-all"
            >
              Interactive Tour
            </button>
          </div>

          <div className="flex items-center gap-8 pt-10 border-t border-white/5">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="w-10 h-10 rounded-full border-2 border-slate-900 bg-slate-800 flex items-center justify-center text-[10px] font-bold">
                  {String.fromCharCode(64 + i)}
                </div>
              ))}
            </div>
            <p className="text-sm font-bold text-slate-500">Trusted by Leading Enterprises</p>
          </div>
        </div>

        <div className="relative animate-in fade-in slide-in-from-right-8 duration-1000 delay-300">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 p-8 rounded-[3rem] shadow-2xl relative z-20">
            <div className="grid grid-cols-2 gap-6">
              <FeatureBox 
                icon={ShieldCheck} 
                title="Forensic Audit" 
                desc="Automated ML scanning for transaction anomalies." 
                color="blue"
              />
              <FeatureBox 
                icon={BarChart3} 
                title="AI Forecast" 
                desc="Predictive modeling for quarterly TK provisions." 
                color="emerald"
              />
              <FeatureBox 
                icon={PieChart} 
                title="Unit Control" 
                desc="Dynamic budget allocation per department." 
                color="indigo"
              />
              <FeatureBox 
                icon={Zap} 
                title="Real-time Ingest" 
                desc="Append datasets via CSV for instant analysis." 
                color="amber"
              />
            </div>
          </div>
          {/* Decorative Elements */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-blue-600/10 blur-[100px] z-10"></div>
        </div>
      </main>

      {/* Footer */}
      <footer className="absolute bottom-10 w-full text-center text-slate-600 text-xs font-bold uppercase tracking-[0.2em]">
        &copy; 2025 FinSight Advisor &bull; Intelligence Driven Finance
      </footer>
    </div>
  );
};

const FeatureBox = ({ icon: Icon, title, desc, color }: any) => {
  const colors: any = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  };
  return (
    <div className="p-6 bg-slate-900/40 border border-white/5 rounded-[2rem] hover:border-white/10 transition-all group">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border ${colors[color]} group-hover:scale-110 transition-transform`}>
        <Icon size={24} />
      </div>
      <h4 className="text-lg font-bold mb-1">{title}</h4>
      <p className="text-xs text-slate-500 leading-relaxed font-medium">{desc}</p>
    </div>
  );
};

export default LandingPage;
