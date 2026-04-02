
import React from 'react';
import { 
  ShieldCheck, 
  BarChart3, 
  PieChart, 
  Zap, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  X,
  LayoutDashboard,
  Users,
  Search,
  Settings,
  ShieldAlert,
  ChevronRight,
  LogOut,
  Maximize
} from 'lucide-react';
import Logo from '../components/Logo';

interface DesignSystemProps {
  onExit: () => void;
}

const DesignSystem: React.FC<DesignSystemProps> = ({ onExit }) => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-8 md:p-16">
      <div className="max-w-6xl mx-auto space-y-24">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-slate-200 pb-12">
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="bg-blue-600 p-3 rounded-2xl shadow-xl shadow-blue-500/20">
                <Logo size={40} variant="white" />
              </div>
              <h1 className="text-4xl font-black tracking-tighter">FinSight Design System</h1>
            </div>
            <p className="text-slate-500 text-lg font-medium">Core components, styles, and guidelines for the FinSight platform.</p>
          </div>
          <button 
            onClick={onExit}
            className="px-6 py-3 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all flex items-center gap-2"
          >
            <X size={20} /> Exit Design Mode
          </button>
        </header>

        {/* Brand & Identity */}
        <section className="space-y-10">
          <SectionHeader title="01. Identity" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="bg-slate-900 p-12 rounded-[2.5rem] flex flex-col items-center justify-center border border-slate-800">
              <Logo size={80} variant="white" />
              <p className="mt-6 text-white text-[10px] font-black uppercase tracking-[0.3em]">Logo Primary Dark</p>
            </div>
            <div className="bg-white p-12 rounded-[2.5rem] flex flex-col items-center justify-center border border-slate-100 shadow-sm">
              <Logo size={80} variant="blue" />
              <p className="mt-6 text-slate-900 text-[10px] font-black uppercase tracking-[0.3em]">Logo Accent Blue</p>
            </div>
            <div className="bg-blue-600 p-12 rounded-[2.5rem] flex flex-col items-center justify-center shadow-xl shadow-blue-500/20">
              <Logo size={80} variant="white" />
              <p className="mt-6 text-white text-[10px] font-black uppercase tracking-[0.3em]">Logo Inverse</p>
            </div>
            <div className="bg-slate-100 p-12 rounded-[2.5rem] flex flex-col items-center justify-center border border-slate-200">
              <Logo size={80} variant="slate" />
              <p className="mt-6 text-slate-900 text-[10px] font-black uppercase tracking-[0.3em]">Logo Monotone</p>
            </div>
          </div>
        </section>

        {/* Color Palette */}
        <section className="space-y-10">
          <SectionHeader title="02. Color Palette" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            <ColorSwatch label="Brand Blue" hex="#2563EB" bg="bg-blue-600" />
            <ColorSwatch label="Deep Slate" hex="#0F172A" bg="bg-slate-900" />
            <ColorSwatch label="Success" hex="#10B981" bg="bg-emerald-500" />
            <ColorSwatch label="Risk/Alert" hex="#F59E0B" bg="bg-amber-500" />
            <ColorSwatch label="Error" hex="#EF4444" bg="bg-red-500" />
          </div>
        </section>

        {/* Typography */}
        <section className="space-y-10">
          <SectionHeader title="03. Typography" />
          <div className="bg-white p-12 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-12">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Headings (Inter Black)</p>
              <h1 className="text-7xl font-black tracking-tighter mb-4">The Future of Audit.</h1>
              <h2 className="text-5xl font-black tracking-tight mb-4">Financial Dashboard</h2>
              <h3 className="text-3xl font-black tracking-tight">Organization Control</h3>
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Body & Labels (Inter Medium/Bold)</p>
              <p className="text-xl font-medium text-slate-600 max-w-2xl leading-relaxed mb-6">
                FinSight Advisor leverages real-time forensic auditing to ensure full fiscal transparency for the Bangladesh market.
              </p>
              <div className="flex gap-4">
                <span className="text-sm font-bold text-slate-800 uppercase tracking-wider">Button Label</span>
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Metadata Label</span>
              </div>
            </div>
          </div>
        </section>

        {/* UI Components */}
        <section className="space-y-10">
          <SectionHeader title="04. Components" />
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Buttons */}
            <div className="space-y-6 bg-white p-10 rounded-[2.5rem] border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Button Elements</p>
              <div className="flex flex-wrap gap-4">
                <button className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-blue-500/20">
                  Primary Button <ArrowRight size={18} />
                </button>
                <button className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-bold">
                  Secondary Action
                </button>
                <button className="px-8 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold">
                  Ghost Button
                </button>
              </div>
            </div>

            {/* Status Badges */}
            <div className="space-y-6 bg-white p-10 rounded-[2.5rem] border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Status & Labels</p>
              <div className="flex flex-wrap gap-3">
                <span className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tight border border-emerald-200 flex items-center gap-2">
                  <CheckCircle2 size={14} /> Approved
                </span>
                <span className="bg-amber-100 text-amber-700 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tight border border-amber-200 flex items-center gap-2">
                  <AlertCircle size={14} /> Risk Anomaly
                </span>
                <span className="bg-red-100 text-red-700 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tight border border-red-200">
                  Unnecessary
                </span>
                <span className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-tight border border-blue-100">
                  Employee Tier
                </span>
              </div>
            </div>

            {/* Inputs */}
            <div className="space-y-6 bg-white p-10 rounded-[2.5rem] border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Input Controls</p>
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input type="text" placeholder="Standard Search..." className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-semibold" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="h-14 bg-white border border-blue-500 ring-4 ring-blue-500/10 rounded-2xl px-4 flex items-center text-slate-900 font-bold">
                    Focused State
                  </div>
                  <div className="h-14 bg-slate-100 border border-slate-200 rounded-2xl px-4 flex items-center text-slate-400 italic">
                    Disabled Field
                  </div>
                </div>
              </div>
            </div>

            {/* Metric Cards */}
            <div className="space-y-6 bg-white p-10 rounded-[2.5rem] border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Information Cards</p>
              <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 flex justify-between items-end">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Monthly Spend</p>
                  <p className="text-3xl font-black text-slate-900 leading-none">TK 242,500</p>
                </div>
                <span className="bg-emerald-50 text-emerald-600 text-[10px] font-black px-2 py-1 rounded-lg">+12.4%</span>
              </div>
            </div>
          </div>
        </section>

        {/* Icon Set */}
        <section className="space-y-10">
          <SectionHeader title="05. Iconography" />
          <div className="bg-white p-12 rounded-[2.5rem] border border-slate-100 shadow-sm">
             <div className="grid grid-cols-4 md:grid-cols-8 lg:grid-cols-12 gap-8 text-slate-400">
                <IconBox icon={LayoutDashboard} label="Dashboard" />
                <IconBox icon={ShieldCheck} label="Forensic" />
                <IconBox icon={PieChart} label="Analytics" />
                <IconBox icon={Users} label="Personnel" />
                <IconBox icon={Zap} label="Forecast" />
                <IconBox icon={Settings} label="Control" />
                <IconBox icon={ShieldAlert} label="Risk" />
                <IconBox icon={Maximize} label="Expand" />
                <IconBox icon={LogOut} label="Exit" />
                <IconBox icon={ArrowRight} label="Next" />
                <IconBox icon={ChevronRight} label="Disclosure" />
                <IconBox icon={Search} label="Lookup" />
             </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center py-20 border-t border-slate-200">
           <p className="text-slate-400 font-black text-xs uppercase tracking-[0.4em]">FinSight &bull; Design Guidelines 2025</p>
        </footer>
      </div>
    </div>
  );
};

const SectionHeader = ({ title }: { title: string }) => (
  <div className="flex items-center gap-6">
    <h2 className="text-sm font-black text-blue-600 uppercase tracking-[0.4em] whitespace-nowrap">{title}</h2>
    <div className="h-[1px] w-full bg-slate-200"></div>
  </div>
);

const ColorSwatch = ({ label, hex, bg }: { label: string, hex: string, bg: string }) => (
  <div className="space-y-3">
    <div className={`aspect-square w-full rounded-3xl shadow-lg ${bg} border border-slate-100`}></div>
    <div>
      <p className="text-sm font-black text-slate-900 leading-tight">{label}</p>
      <p className="text-xs font-mono font-bold text-slate-400 mt-0.5">{hex}</p>
    </div>
  </div>
);

const IconBox = ({ icon: Icon, label }: any) => (
  <div className="flex flex-col items-center gap-3 group transition-all">
     <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
       <Icon size={24} />
     </div>
     <span className="text-[8px] font-black uppercase tracking-tighter opacity-50">{label}</span>
  </div>
);

export default DesignSystem;
