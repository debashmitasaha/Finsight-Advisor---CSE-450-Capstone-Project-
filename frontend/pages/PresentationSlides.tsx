
import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  X, 
  Play, 
  Users, 
  CheckCircle2, 
  ShieldAlert, 
  ArrowRight, 
  Building2, 
  Bell, 
  MessageSquareText, 
  MousePointer2,
  Volume2,
  VolumeX,
  Sparkles,
  Lock,
  Table,
  Zap,
  Target,
  BarChart3,
  TrendingUp,
  Cpu,
  History,
  ShieldCheck,
  Award
} from 'lucide-react';
import Logo from '../components/Logo';
import { GoogleGenAI, Modality } from "@google/genai";

interface PresentationSlidesProps {
  onClose: () => void;
  onStartApp: () => void;
}

// Helper functions for Audio handling as per Gemini guidelines
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const PresentationSlides: React.FC<PresentationSlidesProps> = ({ onClose, onStartApp }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showNotes, setShowNotes] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // --- UI MOCKUP COMPONENTS ---
  const MockSplash = () => (
    <div className="bg-slate-950 w-full h-full flex flex-col items-center justify-center rounded-[2rem] border border-white/10 animate-pulse">
      <div className="bg-slate-900 p-6 rounded-[2rem] border border-white/5 shadow-2xl">
        <Logo size={80} variant="white" />
      </div>
      <h4 className="mt-8 text-xl font-black tracking-[0.2em] text-white">FINSIGHT ADVISOR</h4>
      <div className="flex items-center gap-2 mt-4 text-blue-400 font-bold text-[10px] tracking-[0.4em] uppercase">
        <Sparkles size={12} /> Establish Instance
      </div>
    </div>
  );

  const slides = [
    {
      title: "1. Brand Identity",
      subtitle: "The Handshake Protocol",
      content: "Establishing a secure, isolated financial environment for the enterprise.",
      notes: "Welcome to the future of financial oversight. FinSight Advisor begins with an identity. This splash screen represents our Handshake Protocol, where the platform establishes a secure, encrypted instance for the organization. We don't just load an app; we establish a sanctuary for your most sensitive financial data.",
      features: ["Identity establishing", "Secure Instance Loading", "Encrypted Session Start"],
      color: "from-slate-900 to-blue-950",
      preview: <MockSplash />
    },
    {
      title: "2. Hierarchy of Intelligence",
      subtitle: "Organizational Logic",
      content: "A three-tiered architecture designed for complex departmental structures.",
      notes: "The FinSight ecosystem is built on a fundamental vision: that every modern enterprise operates through distinct departments. Within these units, specialized employees perform the manual accounting tasks that form the company's ledger. Our platform provides the high-level oversight layer—a 'God-view' for the Admin—to monitor every task, every employee, and every business unit through a single, intelligent pane of glass.",
      features: ["Multi-Department Scopes", "Employee-Level Granularity", "Admin Monitoring Hub"],
      color: "from-blue-950 to-indigo-950",
      preview: <div className="p-8 flex flex-col items-center justify-center gap-4 h-full"><div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-2xl border border-white/20"><Users size={32} /></div><div className="flex gap-3"><div className="w-10 h-10 bg-white/10 rounded-lg border border-white/10"></div><div className="w-10 h-10 bg-white/10 rounded-lg border border-white/10"></div><div className="w-10 h-10 bg-white/10 rounded-lg border border-white/10"></div></div><ArrowRight size={20} className="text-blue-400 animate-pulse" /><div className="w-20 h-20 bg-emerald-600 rounded-3xl flex items-center justify-center shadow-2xl border border-white/20"><Building2 size={40} /></div></div>
    },
    {
      title: "3. Predictive Provisioning",
      subtitle: "The End of the Post-Mortem",
      content: "AI-driven forecasting with 94% confidence in fiscal alignment.",
      notes: "Ladies and Gentlemen, let’s talk about the transition from Reactive Accounting to Predictive Intelligence. Most organizations treat reports as a post-mortem—a look at what has already been lost. FinSight's Predictive Provisioning engine calculates the future. By analyzing the manual entries performed by employees in real-time, our AI identifies patterns of drift before they become deficits. This is proactive capital protection.",
      features: ["94% Confidence Rating", "Historical Pattern Mapping", "Proactive Capital Protection"],
      color: "from-indigo-950 to-slate-900",
      preview: <div className="p-10 flex flex-col items-center justify-center h-full space-y-6 text-white"><div className="relative w-32 h-32 rounded-full border-8 border-blue-500/20 flex items-center justify-center"><div className="absolute inset-0 border-t-8 border-blue-500 rounded-full animate-spin"></div><span className="text-3xl font-black">94%</span></div><div className="text-center"><p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Provisioning Confidence</p><p className="text-xs text-white/60 mt-2">Optimal Capital Flow</p></div></div>
    },
    {
      title: "4. Executive Scorecards",
      subtitle: "Strategic Sovereignty",
      content: "Departmental efficiency ratings and organization-wide ROI metrics.",
      notes: "When you look at our Executive Reports, you aren't just seeing numbers; you are seeing an operational scorecard. We rank every business unit on reconciliation velocity, budget precision, and policy compliance. For the Admin, this is the power to re-allocate budget from a surplus department to a high-growth unit instantly, based on objective efficiency ratings rather than gut feeling.",
      features: ["Unit Ranking Index (9.2/10)", "Real-time Delta Sync", "Actionable Savings Audit"],
      color: "from-slate-900 to-indigo-900",
      preview: <div className="p-8 space-y-4 h-full flex flex-col justify-center text-white"><div className="h-10 w-full bg-emerald-500/20 border border-emerald-500/40 rounded-xl flex items-center px-4 justify-between"><div className="flex items-center gap-2"><Award size={14} className="text-emerald-500"/><span className="text-[10px] font-black">Unit Ranking: 9.2</span></div><div className="h-2 w-20 bg-emerald-500/30 rounded"></div></div><div className="h-10 w-full bg-blue-500/20 border border-blue-500/40 rounded-xl flex items-center px-4 justify-between"><div className="flex items-center gap-2"><TrendingUp size={14} className="text-blue-500"/><span className="text-[10px] font-black">Efficiency +14%</span></div><div className="h-2 w-12 bg-blue-500/30 rounded"></div></div></div>
    },
    {
      title: "5. The Forensic Lab",
      subtitle: "Immutable Accountability",
      content: "Closing the loop with real-time anomaly resolution and audit trails.",
      notes: "Transparency is non-negotiable. Our Forensic Lab allows employees to reconcile anomalies instantly. Once a task is resolved, it is moved to a Permanent Ledger, creating an immutable audit trail. This is the single source of truth that satisfies both internal admins and external regulators, ensuring that every cent is accounted for and optimized.",
      features: ["RiskML Anomaly Detection", "Immutable Ledger Trail", "Personnel Accountability"],
      color: "from-indigo-900 to-blue-900",
      preview: <div className="p-8 h-full text-white"><div className="flex items-center gap-2 mb-6"><ShieldCheck size={16} className="text-emerald-500" /><span className="text-[10px] font-black uppercase tracking-widest">Forensic Lab: RiskML</span></div><div className="space-y-3"><div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex justify-between items-center"><div className="h-2 w-1/3 bg-white/20 rounded"></div><CheckCircle2 size={12} className="text-emerald-500" /></div><div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex justify-between items-center opacity-40"><div className="h-2 w-1/2 bg-white/20 rounded"></div></div></div></div>
    }
  ];

  const handleSpeech = async (text: string) => {
    if (isSpeaking) {
      if (currentSourceRef.current) {
        currentSourceRef.current.stop();
        currentSourceRef.current = null;
      }
      setIsSpeaking(false);
      return;
    }

    try {
      setIsSpeaking(true);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Read the following keynote slide script with a professional, authoritative, and visionary speaker tone: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        
        const ctx = audioContextRef.current;
        const audioBuffer = await decodeAudioData(
          decodeBase64(base64Audio),
          ctx,
          24000,
          1,
        );

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          setIsSpeaking(false);
          currentSourceRef.current = null;
        };
        currentSourceRef.current = source;
        source.start();
      } else {
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error("TTS Error:", error);
      setIsSpeaking(false);
    }
  };

  const next = () => {
    if (currentSourceRef.current) currentSourceRef.current.stop();
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };
  
  const prev = () => {
    if (currentSourceRef.current) currentSourceRef.current.stop();
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (currentSourceRef.current) currentSourceRef.current.stop();
    };
  }, []);

  const slide = slides[currentSlide];

  return (
    <div className={`fixed inset-0 z-[1000] bg-gradient-to-br ${slide.color} text-white flex flex-col transition-all duration-700`}>
      {/* Header */}
      <div className="p-8 flex justify-between items-center bg-black/10 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          <Logo size={28} variant="white" />
          <span className="text-lg font-black tracking-tighter uppercase">Platform Presentation Guide</span>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setShowNotes(!showNotes)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-xs transition-all border ${showNotes ? 'bg-blue-600 border-blue-500 text-white shadow-lg' : 'bg-white/5 border-white/10 text-white/60 hover:text-white'}`}
          >
            <MessageSquareText size={18} /> {showNotes ? 'Hide Speaker Notes' : 'Show Speaker Notes'}
          </button>
          <button onClick={onClose} className="p-3 hover:bg-white/10 rounded-2xl transition-all"><X size={24} /></button>
        </div>
      </div>

      {/* Slide Body */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-20 overflow-hidden relative">
        <div className={`max-w-7xl w-full grid gap-16 lg:gap-32 items-center transition-all duration-500 ${showNotes ? 'lg:grid-cols-[1fr_1fr_1.5fr]' : 'lg:grid-cols-2'}`}>
          
          {/* Main Info */}
          <div className="space-y-10 animate-in fade-in slide-in-from-left-8 duration-700">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-full text-white/80 text-[10px] font-black uppercase tracking-[0.3em]">
              Presentation Stage {currentSlide + 1}
            </div>
            
            <div className="space-y-4">
              <h2 className="text-sm font-black text-blue-300 uppercase tracking-[0.3em] opacity-80">{slide.subtitle}</h2>
              <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-[1] text-white">
                {slide.title}
              </h1>
            </div>

            <p className="text-lg md:text-xl text-white/70 font-medium leading-relaxed max-w-xl">
              {slide.content}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              {slide.features.map((f, i) => (
                <div key={i} className="flex items-center gap-3 bg-white/5 border border-white/10 p-4 rounded-2xl group hover:border-blue-400 transition-all">
                  <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                  <span className="font-bold text-[10px] tracking-tight uppercase">{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Preview Component */}
          <div className="flex flex-col items-center justify-center relative">
            <div className={`absolute inset-0 bg-blue-500/10 blur-[150px] rounded-full scale-150 transition-all duration-1000 ${isSpeaking ? 'bg-blue-500/20' : ''}`}></div>
            <div className={`relative z-10 w-full aspect-square bg-slate-900/50 rounded-[3rem] p-4 border transition-all duration-500 backdrop-blur-md shadow-2xl overflow-hidden ${isSpeaking ? 'border-blue-500/50 shadow-blue-500/20 scale-[1.02]' : 'border-white/10'}`}>
               {slide.preview}
            </div>
          </div>

          {/* Speaker Notes (Conditional) */}
          {showNotes && (
            <div className="h-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-[3rem] p-8 space-y-6 animate-in slide-in-from-right-10 fade-in duration-500 overflow-y-auto max-h-[600px] custom-scrollbar">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                 <div className="flex items-center gap-3">
                   <MousePointer2 size={18} className="text-blue-400" />
                   <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Speaker Script</h4>
                 </div>
                 <button 
                  onClick={() => handleSpeech(slide.notes)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isSpeaking ? 'bg-blue-600 text-white animate-pulse' : 'bg-white/10 text-white hover:bg-white/20'}`}
                 >
                   {isSpeaking ? <><VolumeX size={14} /> Stop AI Voice</> : <><Volume2 size={14} /> Listen to Script</>}
                 </button>
              </div>
              <p className="text-lg md:text-xl font-medium leading-relaxed text-blue-50 italic">
                "{slide.notes}"
              </p>
              <div className="pt-6 space-y-4">
                <div className="bg-blue-600/10 p-5 rounded-2xl border border-blue-500/20 flex gap-4">
                   <div className="bg-blue-600 p-2 rounded-lg h-fit">
                    <Sparkles size={16} className="text-white" />
                   </div>
                   <div>
                     <p className="text-[9px] font-black uppercase text-blue-300 tracking-widest mb-2">Executive Insight</p>
                     <p className="text-xs text-blue-50/70 font-bold leading-relaxed">
                       {currentSlide === 1 ? "Emphasize the hierarchy: Every department has employees performing manual tasks, while the Admin maintains ultimate strategic oversight." : "Focus on how this feature moves the organization from reactive budgeting to proactive, data-driven capital protection."}
                     </p>
                   </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="p-8 md:p-12 flex justify-between items-center bg-black/20 backdrop-blur-lg border-t border-white/5">
        <div className="flex gap-4">
          <button onClick={prev} className="p-5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all active:scale-90"><ChevronLeft size={32} /></button>
          <button onClick={next} className="p-5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all active:scale-90"><ChevronRight size={32} /></button>
        </div>

        {currentSlide === slides.length - 1 ? (
          <button 
            onClick={onStartApp}
            className="px-12 py-5 bg-blue-600 text-white hover:bg-blue-700 rounded-[2.5rem] font-black text-xl flex items-center gap-3 shadow-2xl shadow-blue-500/25 active:scale-95 transition-all"
          >
            <Play size={24} className="fill-white" /> Open Live Demo
          </button>
        ) : (
          <div className="flex items-center gap-6 text-white/30 font-bold uppercase text-[10px] tracking-widest">
            <div className="flex gap-1">
              {slides.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === currentSlide ? 'w-8 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'w-2 bg-white/20'}`}></div>
              ))}
            </div>
            <div className="flex gap-2 cursor-pointer hover:text-white transition-colors" onClick={next}>
               <span>Next Slide</span>
               <ArrowRight size={14} />
            </div>
          </div>
        )}
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
};

export default PresentationSlides;
