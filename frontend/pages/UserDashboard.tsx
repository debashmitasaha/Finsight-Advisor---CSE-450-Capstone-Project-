
import React, { useState } from 'react';
import Layout from '../components/Layout';
import { UserAccount, Department, Transaction } from '../types';
import { MOCK_DEPARTMENTS, MOCK_TRANSACTIONS, COLORS } from '../constants';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { ChevronLeft, Filter, Search, Edit2, AlertCircle, TrendingUp, ShieldAlert, Table, X, User, ArrowRight, Zap, CheckCircle2, Receipt, Wallet, History, Target, FileText, Sparkles } from 'lucide-react';

interface UserDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const UserDashboard: React.FC<UserDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/departments');
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'budget' | 'forensic' | 'transactions'>('overview');
  const [selectedTxnDetails, setSelectedTxnDetails] = useState<Transaction | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  
  // State for live transaction management
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);

  const handleNavigate = (path: string) => {
    setActivePath(path);
    if (path === '/departments') setSelectedDept(null);
  };

  const handleUpdateCategory = (txnId: string, newCategory: Transaction['category']) => {
    setTransactions(prev => prev.map(t => {
      if (t.transaction_id === txnId) {
        const shouldClearFlag = newCategory === 'NECESSARY' || newCategory === 'OPTIONAL';
        return { 
          ...t, 
          category: newCategory, 
          flagged: shouldClearFlag ? false : t.flagged,
          status: shouldClearFlag ? 'RESOLVED' : t.status
        };
      }
      return t;
    }));
  };

  const renderContent = () => {
    // 1. Department Overview (Cards)
    if (activePath === '/departments' && !selectedDept) {
      return (
        <div className="space-y-10 animate-in fade-in duration-500">
          <div className="flex justify-between items-end">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">Financial Overview</h1>
              <p className="text-slate-500 text-lg font-medium mt-3">Welcome back, {user.name}. You have access to {MOCK_DEPARTMENTS.length} business units.</p>
            </div>
            <div className="hidden lg:flex gap-4">
               <div className="bg-white border border-slate-200 px-6 py-4 rounded-3xl shadow-sm text-right">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Total Managed Budget</span>
                  <span className="text-2xl font-black text-slate-900">TK 3,000,000</span>
               </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {MOCK_DEPARTMENTS.map(dept => {
              const deptTxns = transactions.filter(t => t.department_id === dept.department_id);
              const utilization = Math.min(100, Math.round((deptTxns.reduce((sum, t) => sum + t.amount, 0) / (dept.annual_budget / 12)) * 100));
              
              return (
                <div 
                  key={dept.department_id}
                  className="bg-white p-8 rounded-[2.5rem] border border-slate-200 hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-500/10 transition-all group cursor-pointer"
                  onClick={() => setSelectedDept(dept)}
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
                      <Wallet size={28} />
                    </div>
                    <span className="bg-slate-50 text-slate-400 text-[10px] font-black px-3 py-1 rounded-full uppercase border border-slate-100">
                      {dept.department_id}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">{dept.department_name}</h3>
                  
                  <div className="space-y-4 mt-8">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400 font-bold uppercase tracking-widest">Yearly Provision</span>
                      <span className="font-bold text-slate-800">TK {dept.annual_budget.toLocaleString()}</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 rounded-full transition-all duration-1000" 
                        style={{ width: `${utilization}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between items-center text-sm font-bold">
                      <span className="text-slate-400 uppercase tracking-widest">Current Usage</span>
                      <span className="text-blue-600">{utilization}%</span>
                    </div>
                  </div>
                  <button className="w-full mt-10 py-4 bg-slate-50 text-slate-900 font-bold rounded-2xl border border-slate-100 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all active:scale-95 flex items-center justify-center gap-2">
                    Open Ledger <ArrowRight size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // 2. Specific Department View
    if (selectedDept) {
      return (
        <DepartmentDetailView 
          dept={selectedDept} 
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          transactions={transactions}
          onUpdateCategory={handleUpdateCategory}
          onBack={() => setSelectedDept(null)}
          onOpenDetails={setSelectedTxnDetails}
        />
      );
    }

    // 3. Quick Analysis / Forensic Lab View
    if (activePath === '/analysis') {
      return (
        <div className="space-y-8 animate-in fade-in duration-500">
           <div className="flex justify-between items-end">
             <div>
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Financial Health Report</h1>
                <p className="text-slate-500 font-medium mt-1">Global audit of all business unit transactions.</p>
             </div>
             <button 
                onClick={() => handleNavigate('/history')}
                className="bg-white border border-slate-200 px-6 py-3 rounded-2xl text-slate-600 font-bold hover:bg-slate-50 transition-all flex items-center gap-2"
              >
               <History size={18} /> View History
             </button>
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
             <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                   <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                     <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                       <ShieldAlert className="text-amber-500" size={24} />
                       Anomalies Requiring Resolution
                     </h3>
                     <span className="text-[10px] font-black bg-amber-50 text-amber-600 px-3 py-1 rounded-full border border-amber-100 uppercase tracking-widest">
                       {transactions.filter(t => t.flagged).length} Open Cases
                     </span>
                   </div>
                   <div className="divide-y divide-slate-50">
                      {transactions.filter(t => t.flagged).map((t) => (
                        <div key={t.transaction_id} className="p-6 hover:bg-slate-50 transition-colors flex justify-between items-center group">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{t.description}</p>
                            <p className="text-xs text-slate-500 mt-1">{t.flag_reason}</p>
                            <div className="flex gap-2 mt-2">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{t.transaction_date}</span>
                              <span className="w-1 h-1 bg-slate-200 rounded-full my-auto"></span>
                              <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">{t.employee_name}</span>
                            </div>
                          </div>
                          <div className="text-right">
                             <p className="text-sm font-black text-slate-900">TK {t.amount.toLocaleString()}</p>
                             <button 
                                onClick={() => setSelectedTxnDetails(t)}
                                className="mt-2 text-[10px] font-black text-blue-600 uppercase tracking-widest group-hover:underline"
                             >
                               Resolve Case
                             </button>
                          </div>
                        </div>
                      ))}
                      {transactions.filter(t => t.flagged).length === 0 && (
                        <div className="p-16 text-center">
                          <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-4" />
                          <p className="text-slate-500 font-bold">All cases resolved!</p>
                        </div>
                      )}
                   </div>
                </div>
             </div>

             <div className="space-y-6">
               <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm">
                  <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                    <Target className="text-blue-500" size={24} />
                    Audit Status
                  </h3>
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-slate-500">Categorized</span>
                      <span className="text-sm font-black text-slate-900">98%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full">
                      <div className="h-full bg-emerald-500 rounded-full w-[98%]"></div>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-sm font-bold text-slate-500">Resolution Rate</span>
                      <span className="text-sm font-black text-slate-900">72%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full">
                      <div className="h-full bg-blue-500 rounded-full w-[72%]"></div>
                    </div>
                  </div>
               </div>
               
               <div className="bg-slate-900 p-8 rounded-[2rem] text-white shadow-xl relative overflow-hidden">
                  <Zap className="text-blue-400 mb-4" size={32} />
                  <h3 className="text-xl font-bold">Optimization Potential</h3>
                  <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                    AI analysis suggests <span className="text-white font-bold">TK 12,400</span> could be saved this quarter by migrating SaaS subscriptions to annual billing.
                  </p>
                  <button 
                    onClick={() => setShowRecommendations(true)}
                    className="w-full mt-6 py-3 bg-white text-slate-900 font-bold rounded-xl text-sm hover:bg-blue-50 transition-all active:scale-95"
                  >
                    View Recommendations
                  </button>
               </div>
             </div>
           </div>
        </div>
      );
    }

    // 4. My History View
    if (activePath === '/history') {
      const historyItems = transactions.filter(t => t.status === 'RESOLVED');
      return (
        <div className="space-y-8 animate-in fade-in duration-500">
           <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Personal History</h1>
              <p className="text-slate-500 font-medium mt-1">Review your reconciled and approved transactions.</p>
           </div>
           
           <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
             <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
               <div className="flex gap-4">
                 <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 flex items-center gap-2">
                    <History size={14} /> Total Records: {historyItems.length}
                 </div>
               </div>
               <button className="text-[10px] font-black text-blue-600 uppercase tracking-widest px-4 py-2 border border-blue-100 bg-blue-50/50 rounded-xl hover:bg-blue-600 hover:text-white transition-all">
                 Export Ledger
               </button>
             </div>
             
             <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead className="bg-white border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Vendor</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Amount</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {historyItems.map(t => (
                      <tr key={t.transaction_id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-5 text-sm font-medium text-slate-500">{t.transaction_date}</td>
                        <td className="px-6 py-5">
                          <p className="text-sm font-bold text-slate-900">{t.description}</p>
                        </td>
                        <td className="px-6 py-5 text-sm font-black text-slate-900 text-right">TK {t.amount.toLocaleString()}</td>
                        <td className="px-6 py-5">
                          <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-tight border ${COLORS[t.category]}`}>
                            {t.category}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2 text-emerald-600 font-bold text-[10px] uppercase">
                            <CheckCircle2 size={14} /> Approved
                          </div>
                        </td>
                      </tr>
                    ))}
                    {historyItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-20 text-center text-slate-400 font-medium italic">
                          No history found. Resolve anomalies to populate this ledger.
                        </td>
                      </tr>
                    )}
                  </tbody>
               </table>
             </div>
           </div>
        </div>
      );
    }

    return null;
  };

  return (
    <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={handleNavigate}>
      {renderContent()}

      {selectedTxnDetails && (
        <TransactionDetailsModal 
          transaction={selectedTxnDetails} 
          onUpdateCategory={handleUpdateCategory}
          onClose={() => setSelectedTxnDetails(null)} 
        />
      )}

      {showRecommendations && (
        <RecommendationsModal onClose={() => setShowRecommendations(false)} />
      )}
    </Layout>
  );
};

const RecommendationsModal = ({ onClose }: { onClose: () => void }) => {
  const recs = [
    { title: 'Cloud Consolidation', impact: 'TK 4,500/mo', desc: 'Migrate legacy storage to centralized corporate bucket.', icon: Zap },
    { title: 'Annual Billing', impact: 'TK 7,900/yr', desc: 'Adobe Creative Cloud renewal due; switching to annual saves 15%.', icon: TrendingUp },
    { title: 'Subscription Audit', impact: 'TK 1,200/mo', desc: 'Detecting 3 unused licenses for ProjectX software.', icon: ShieldAlert },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl p-8 animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-8">
           <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
                 <Sparkles size={24} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">AI Optimization Strategy</h2>
           </div>
           <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all">
             <X size={20} />
           </button>
        </div>

        <div className="space-y-4">
           {recs.map((rec, i) => (
             <div key={i} className="p-6 bg-slate-50 border border-slate-100 rounded-3xl hover:border-blue-500 transition-all group">
                <div className="flex justify-between items-start mb-2">
                   <h4 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{rec.title}</h4>
                   <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full uppercase">Impact: {rec.impact}</span>
                </div>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">{rec.desc}</p>
             </div>
           ))}
        </div>

        <button 
          onClick={onClose}
          className="w-full mt-8 py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 active:scale-95"
        >
           Acknowledge & Sync Ledger
        </button>
      </div>
    </div>
  );
};

const DepartmentDetailView = ({ dept, activeTab, setActiveTab, transactions, onUpdateCategory, onBack, onOpenDetails }: any) => {
  const tabs = [
    { id: 'overview', label: 'Overview', icon: TrendingUp },
    { id: 'transactions', label: 'Full Ledger', icon: Table },
    { id: 'forensic', label: 'Audit Hub', icon: ShieldAlert },
    { id: 'budget', label: 'Projections', icon: Zap },
  ];

  return (
    <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-all shadow-sm">
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">{dept.department_name} Unit</h1>
            <p className="text-slate-400 font-bold uppercase tracking-[0.15em] text-[10px] mt-1">Fiscal Management Interface</p>
          </div>
        </div>
        
        <nav className="flex p-1.5 bg-slate-200/60 backdrop-blur rounded-[1.5rem] w-full lg:w-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 lg:flex-none flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl font-bold text-sm transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-lg shadow-blue-500/5' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 p-8 shadow-sm">
        {/* Fix: use onUpdateCategory from props instead of undefined handleUpdateCategory */}
        {activeTab === 'overview' && <OverviewTab dept={dept} transactions={transactions} onUpdateCategory={onUpdateCategory} />}
        {activeTab === 'budget' && <BudgetPredictionTab dept={dept} />}
        {activeTab === 'forensic' && <ForensicReportTab dept={dept} transactions={transactions} onResolve={onOpenDetails} />}
        {/* Fix: use onUpdateCategory from props instead of undefined handleUpdateCategory */}
        {activeTab === 'transactions' && <TransactionsTab dept={dept} transactions={transactions} onUpdateCategory={onUpdateCategory} onOpenDetails={onOpenDetails} />}
      </div>
    </div>
  );
};

const OverviewTab = ({ dept, transactions, onUpdateCategory }: any) => {
  const deptTxns = transactions.filter((t: any) => t.department_id === dept.department_id);
  const totalSpend = deptTxns.reduce((acc: number, t: any) => acc + t.amount, 0);

  const chartData = [
    { name: 'Sep', spend: 42000 },
    { name: 'Oct', spend: 44000 },
    { name: 'Nov', spend: 46000 },
    { name: 'Dec', spend: 41000 },
    { name: 'Jan', spend: 48000 },
    { name: 'Feb', spend: totalSpend > 0 ? totalSpend : 45000 },
  ];

  return (
    <div className="space-y-10 animate-in fade-in duration-700">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard label="Unit Ledger Items" value={deptTxns.length.toString()} delta="+4" />
        <SummaryCard label="Actual Spending" value={`TK ${totalSpend.toLocaleString()}`} delta="-2.4%" />
        <SummaryCard label="Monthly Budget" value={`TK ${(dept.annual_budget / 12).toLocaleString()}`} delta="" />
        <SummaryCard label="Categorization" value="99.2%" delta="+0.1%" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100">
            <h3 className="text-lg font-extrabold text-slate-800 mb-8 flex items-center gap-2">
              <TrendingUp size={20} className="text-blue-500" />
              Six Month Variance
            </h3>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 600}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 600}} />
                  <Tooltip 
                    contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 700}}
                  />
                  <Line type="monotone" dataKey="spend" stroke="#3b82f6" strokeWidth={4} dot={{r: 6, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff'}} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 overflow-hidden shadow-sm">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
               <h4 className="font-bold text-slate-800">Recent Unit Activity</h4>
               <button className="text-[10px] font-black text-blue-600 uppercase tracking-widest">See All</button>
            </div>
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                   <th className="px-6 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                   <th className="px-6 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Vendor</th>
                   <th className="px-6 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                 {deptTxns.slice(0, 4).map(t => (
                   <tr key={t.transaction_id} className="hover:bg-slate-50 transition-colors">
                     <td className="px-6 py-4 text-xs font-medium text-slate-500">{t.transaction_date}</td>
                     <td className="px-6 py-4 text-xs font-bold text-slate-800">{t.description}</td>
                     <td className="px-6 py-4 text-xs font-black text-slate-900 text-right">TK {t.amount.toLocaleString()}</td>
                   </tr>
                 ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100">
            <h3 className="text-lg font-extrabold text-slate-800 mb-8 flex items-center gap-2">
              <Receipt size={20} className="text-indigo-500" />
              Spend Allocation
            </h3>
            <div className="h-[250px] flex items-center justify-center">
              <div className="text-center">
                <div className="text-4xl font-black text-slate-900 mb-2">34%</div>
                <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest">Of Monthly Provision Spent</p>
                <div className="mt-6 flex flex-col gap-3">
                   <AllocationItem label="Operations" percent={45} color="bg-blue-500" />
                   <AllocationItem label="Personnel" percent={30} color="bg-indigo-500" />
                   <AllocationItem label="Taxes" percent={15} color="bg-emerald-500" />
                </div>
              </div>
            </div>
          </div>
          
          <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100">
             <div className="flex gap-4 items-start">
                <div className="p-2 bg-blue-600 rounded-xl text-white">
                  <Zap size={18} />
                </div>
                <div>
                   <h5 className="font-bold text-blue-900 text-sm">AI Provisioning Alert</h5>
                   <p className="text-blue-700 text-xs mt-1 leading-relaxed">
                     Hardware costs are trending 15% lower than previous quarters. Consider re-allocating TK 5,000 to software training.
                   </p>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AllocationItem = ({ label, percent, color }: any) => (
  <div className="flex items-center gap-3">
    <div className={`w-2 h-2 rounded-full ${color}`}></div>
    <span className="text-[10px] font-bold text-slate-500 flex-1 text-left">{label}</span>
    <span className="text-[10px] font-black text-slate-900">{percent}%</span>
  </div>
);

const BudgetPredictionTab = ({ dept }: any) => {
  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex items-center gap-6 p-8 bg-slate-900 text-white rounded-[2rem] shadow-xl overflow-hidden relative">
        <div className="absolute top-[-20%] right-[-10%] w-[40%] h-[150%] bg-blue-600/20 rounded-full blur-[80px]"></div>
        <div className="w-20 h-20 bg-blue-600 text-white rounded-[1.5rem] flex items-center justify-center font-black text-2xl shadow-lg relative z-10">
          94%
        </div>
        <div className="relative z-10">
          <h3 className="text-2xl font-black tracking-tight">Predictive Provisioning</h3>
          <p className="text-slate-400 font-medium leading-relaxed max-w-xl">
            AI has high confidence that current spending patterns align with year-end goals. No intervention required.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Q2 Estimated Carryover', value: 'TK 8,240', color: 'emerald' },
          { label: 'Variance Risk', value: 'Negligible', color: 'blue' },
          { label: 'Audit Compliance', value: 'Excellent', color: 'indigo' },
        ].map(item => (
          <div key={item.label} className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{item.label}</span>
            <p className="text-2xl font-black text-slate-900 mt-2">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const ForensicReportTab = ({ dept, transactions, onResolve }: any) => {
  const deptTransactions = transactions.filter((t: any) => t.department_id === dept.department_id && t.flagged);

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <SummaryCard label="Open Forensic Cases" value={deptTransactions.length.toString()} delta="" color="red" />
        <SummaryCard label="Resolved This Month" value="12" delta="" />
        <SummaryCard label="Anomalous Volume" value={`TK ${deptTransactions.reduce((acc: any, t: any) => acc + t.amount, 0).toLocaleString()}`} delta="" color="blue" />
        <SummaryCard label="Policy Adherence" value="96%" delta="+2%" />
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 bg-slate-50 flex justify-between items-center border-b border-slate-100">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber-500" />
            Audit Queue: {dept.department_name}
          </h3>
          <button className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-xl transition-all">Download Audit Trail</button>
        </div>
        <div className="overflow-x-auto">
          {deptTransactions.length > 0 ? (
            <table className="w-full text-left">
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Post Date</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Amount</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Anomaly Reason</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deptTransactions.map((txn: any) => (
                  <tr key={txn.transaction_id} className="hover:bg-amber-50/20 transition-colors group">
                    <td className="px-6 py-5 text-sm font-medium text-slate-600">{txn.transaction_date}</td>
                    <td className="px-6 py-5 text-sm font-black text-slate-900 text-right">TK {txn.amount.toLocaleString()}</td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-amber-700">{txn.flag_reason}</span>
                        <span className="text-[9px] text-slate-400 mt-0.5">Automated Flag ID: FL-{txn.transaction_id.split('-')[1]}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[9px] font-black uppercase tracking-tighter text-slate-400 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200">
                        {txn.status}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                       <button 
                          onClick={() => onResolve(txn)}
                          className="text-xs font-bold text-blue-600 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Resolve
                        </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-20 text-center">
               <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6 text-emerald-500">
                 <CheckCircle2 size={40} />
               </div>
               <h4 className="text-xl font-bold text-slate-900">Ledger Compliance Verified</h4>
               <p className="text-slate-500 text-sm mt-2 max-w-sm mx-auto font-medium">No critical anomalies detected. All transactions align with corporate governance policies.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const TransactionsTab = ({ dept, transactions, onUpdateCategory, onOpenDetails }: any) => {
  const [lastUpdatedId, setLastUpdatedId] = useState<string | null>(null);
  const deptTransactions = transactions.filter((t: any) => t.department_id === dept.department_id);

  const handleCategorySelect = (txnId: string, val: Transaction['category']) => {
    onUpdateCategory(txnId, val);
    setLastUpdatedId(txnId);
    setTimeout(() => setLastUpdatedId(null), 1500);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex gap-4 w-full md:w-auto">
          <div className="flex-1 md:w-64 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input type="text" placeholder="Search entries..." className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white transition-all font-medium text-sm" />
          </div>
          <button className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-2 font-bold text-sm shadow-sm">
            <Filter size={18} /> Filters
          </button>
        </div>
        <div className="flex items-center gap-3">
           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Entry Count: {deptTransactions.length}</span>
           <div className="h-4 w-[1px] bg-slate-200"></div>
           <button className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline">Export CSV</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-slate-200 shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Date</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Description</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Amount</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Accountability</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Classification</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {deptTransactions.map((txn: any) => (
              <tr 
                key={txn.transaction_id} 
                className={`transition-all group ${lastUpdatedId === txn.transaction_id ? 'bg-emerald-50/50' : 'hover:bg-slate-50/50'}`}
              >
                <td className="px-6 py-5 text-sm font-medium text-slate-500">{txn.transaction_date}</td>
                <td className="px-6 py-5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 truncate max-w-[200px]">{txn.description}</span>
                    {txn.flagged && <AlertCircle size={14} className="text-amber-500 shrink-0" />}
                  </div>
                </td>
                <td className="px-6 py-5 text-sm font-black text-slate-900 text-right">TK {txn.amount.toLocaleString()}</td>
                <td className="px-6 py-5">
                   <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                        {txn.employee_name.charAt(0)}
                      </div>
                      <span className="text-xs font-semibold text-slate-600">{txn.employee_name}</span>
                   </div>
                </td>
                <td className="px-6 py-5">
                  <div className="relative inline-block w-full min-w-[140px]">
                    <select 
                      value={txn.category}
                      onChange={(e) => handleCategorySelect(txn.transaction_id, e.target.value as any)}
                      className={`w-full appearance-none px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-tight border transition-all cursor-pointer outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm ${COLORS[txn.category]}`}
                    >
                      <option value="NECESSARY">Necessary</option>
                      <option value="OPTIONAL">Optional</option>
                      <option value="RISKY">Risky Anomaly</option>
                      <option value="UNNECESSARY">Unnecessary</option>
                      <option value="UNCATEGORIZED">Uncategorized</option>
                    </select>
                    {lastUpdatedId === txn.transaction_id && (
                      <CheckCircle2 size={12} className="absolute -right-5 top-1/2 -translate-y-1/2 text-emerald-500 animate-in zoom-in fade-in duration-300" />
                    )}
                  </div>
                </td>
                <td className="px-6 py-5 text-right">
                   <button 
                    onClick={() => onOpenDetails(txn)}
                    className="text-slate-400 hover:text-blue-600 p-2 rounded-xl hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                   >
                     <Edit2 size={16} />
                   </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TransactionDetailsModal = ({ transaction, onUpdateCategory, onClose }: any) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-8 animate-in zoom-in-95 duration-300 overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Ledger Entry Audit</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-4 p-5 bg-slate-50 rounded-2xl border border-slate-100">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
              <User size={24} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Entry Originator</p>
              <p className="text-lg font-bold text-slate-900">{transaction.employee_name}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Posted Date</p>
              <p className="text-sm font-bold text-slate-800">{transaction.transaction_date}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Transaction ID</p>
              <p className="text-sm font-bold text-slate-800">{transaction.transaction_id}</p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Fiscal Impact</p>
            <p className="text-xl font-black text-slate-900">TK {transaction.amount.toLocaleString()}</p>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Vendor Description</p>
            <p className="text-sm font-medium text-slate-700 leading-relaxed">{transaction.description}</p>
          </div>

          <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Manual Classification Correction</p>
            <select 
              value={transaction.category}
              onChange={(e) => onUpdateCategory(transaction.transaction_id, e.target.value as any)}
              className={`w-full mt-2 px-4 py-3 rounded-2xl font-bold border transition-all appearance-none cursor-pointer outline-none focus:ring-4 focus:ring-blue-500/10 ${COLORS[transaction.category]}`}
            >
              <option value="NECESSARY">Necessary Expenditure</option>
              <option value="OPTIONAL">Optional Spending</option>
              <option value="RISKY">Anomaly Flag</option>
              <option value="UNNECESSARY">Wasteful Spending</option>
              <option value="UNCATEGORIZED">Uncategorized</option>
            </select>
          </div>

          <div className="pt-4">
            <button 
              onClick={onClose}
              className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-slate-900/20"
            >
              Apply Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SummaryCard = ({ label, value, delta, color = 'blue' }: any) => {
  const isPositive = delta?.startsWith('+');
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-1">{label}</p>
      <div className="flex items-end justify-between">
        <p className="text-2xl font-black text-slate-900">{value}</p>
        {delta && (
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${isPositive ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
            {delta}
          </span>
        )}
      </div>
    </div>
  );
};

export default UserDashboard;
