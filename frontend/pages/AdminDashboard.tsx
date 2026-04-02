
import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { UserAccount, UserRole, Department, Transaction } from '../types';
import { MOCK_DEPARTMENTS, MOCK_ACCOUNTS, MOCK_TRANSACTIONS, COLORS } from '../constants';
import { 
  Plus, Upload, FileText, ChevronRight, Check, Shield, Users, 
  PieChart, X, TrendingUp, ShieldAlert, Clock, Settings, 
  ArrowRight, Table, ChevronLeft, User, Edit2, Search, Zap, 
  BarChart3, Activity, Download, Filter, Target, Sparkles,
  Eye, FileCheck, ClipboardList, Info
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell } from 'recharts';

interface AdminDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

interface AuditLog {
  id: string;
  user: string;
  action: string;
  target: string;
  time: string;
  type: 'system' | 'security' | 'access' | 'reconcile';
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/dashboard');
  const [showCSVModal, setShowCSVModal] = useState(false);
  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  
  // Master States
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [departments, setDepartments] = useState<Department[]>(MOCK_DEPARTMENTS);
  const [accounts, setAccounts] = useState<UserAccount[]>(
    MOCK_ACCOUNTS.filter(a => a.company_id === user.company_id || a.account_type === UserRole.SUPER_ADMIN)
  );
  
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([
    { id: 'L1', user: 'Jane Admin', action: 'System Initialization', target: 'Acme Corp Instance', time: '2025-02-10 09:00', type: 'system' },
    { id: 'L2', user: 'System AI', action: 'Anomaly Detected', target: 'TXN-003', time: '2025-02-12 09:15', type: 'security' },
    { id: 'L3', user: 'Jane Admin', action: 'CSV Data Ingest', target: 'Marketing Unit', time: '2025-02-12 11:20', type: 'system' },
  ]);
  
  // Specific View States
  const [selectedDeptStatus, setSelectedDeptStatus] = useState<Department | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'budget' | 'forensic' | 'transactions'>('overview');
  const [selectedTxnDetails, setSelectedTxnDetails] = useState<Transaction | null>(null);

  const addLog = (action: string, target: string, type: AuditLog['type']) => {
    const newLog: AuditLog = {
      id: `L-${Date.now()}`,
      user: user.name,
      action,
      target,
      time: new Date().toLocaleString(),
      type
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };

  const handleNavigate = (path: string) => {
    // Normalization for notification paths
    let normalizedPath = path;
    if (path === '/analysis') normalizedPath = '/dept-status';
    if (path === '/departments') normalizedPath = '/dept-status';
    
    setActivePath(normalizedPath);
    // Clear sub-views when switching primary modules
    if (normalizedPath !== '/dept-status') {
      setSelectedDeptStatus(null);
    }
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
    addLog('Classification Update', txnId, 'reconcile');
  };

  const handleDeployCSV = (newDeptData: { name: string, budget: number, isNew: boolean, deptId?: string }) => {
    if (newDeptData.isNew) {
      const newId = `DEPT-00${departments.length + 1}`;
      const newDept: Department = {
        department_id: newId,
        company_id: user.company_id || 'COMP-001',
        department_name: newDeptData.name,
        employee_account_ids: [],
        annual_budget: newDeptData.budget,
        is_active: true,
        created_at: new Date().toISOString().split('T')[0],
        transaction_count: 1
      };
      
      const newTxn: Transaction = {
        transaction_id: `TXN-NEW-${Math.random().toString(36).substr(2, 4)}`,
        department_id: newId,
        transaction_date: new Date().toISOString().split('T')[0],
        amount: newDeptData.budget / 100,
        description: 'Unit Setup Provisioning',
        employee_name: user.name,
        category: 'NECESSARY',
        status: 'RESOLVED'
      };

      setDepartments(prev => [...prev, newDept]);
      setTransactions(prev => [...prev, newTxn]);
      addLog('Business Unit Initialization', newDeptData.name, 'system');
    } else {
      setDepartments(prev => prev.map(d => 
        d.department_id === newDeptData.deptId 
        ? { ...d, transaction_count: (d.transaction_count || 0) + 1 } 
        : d
      ));
      addLog('CSV Dataset Appended', newDeptData.name, 'system');
    }
    setShowCSVModal(false);
  };

  const handleOnboardEmployee = (newEmp: UserAccount) => {
    setAccounts(prev => [...prev, { ...newEmp, company_id: user.company_id || 'COMP-001' }]);
    addLog('Personnel Onboarded', newEmp.name, 'access');
    setShowOnboardModal(false);
  };

  const handleUpdateEmployeePermissions = (accountId: string, newPermissions: any) => {
    const assignedDeptIds = Object.keys(newPermissions);
    
    // Core Fix: Synchronize both departments and accounts by ensuring department member lists are updated
    setDepartments(prev => prev.map(d => {
      const isAssigned = assignedDeptIds.includes(d.department_id);
      const isCurrentlyInList = d.employee_account_ids.includes(accountId);

      if (isAssigned && !isCurrentlyInList) {
        // Grant access
        return { ...d, employee_account_ids: [...d.employee_account_ids, accountId] };
      } else if (!isAssigned && isCurrentlyInList) {
        // Revoke access
        return { ...d, employee_account_ids: d.employee_account_ids.filter(id => id !== accountId) };
      }
      return d;
    }));

    addLog('Authorization Scopes Modified', accounts.find(a => a.account_id === accountId)?.name || accountId, 'access');
  };

  const renderContent = () => {
    if (activePath === '/dashboard') {
       return (
         <div className="space-y-8 animate-in fade-in duration-500">
           <div className="flex justify-between items-end">
              <div>
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Organization Control</h1>
                <p className="text-slate-500 font-medium mt-1">Global oversight for {accounts.length} personnel.</p>
              </div>
              <div className="flex gap-3">
                 <button onClick={() => handleNavigate('/dept-status')} className="bg-white border border-slate-200 p-3 rounded-2xl hover:bg-slate-50 transition-all shadow-sm">
                   <TrendingUp size={20} className="text-blue-500" />
                 </button>
                 <button className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                   <ShieldAlert size={18} /> Run Compliance Audit
                 </button>
              </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <MetricCard label="Personnel" value={accounts.length.toString()} delta="+1" />
              <MetricCard label="Business Units" value={departments.length.toString()} delta="" />
              <MetricCard label="Audit Flags" value={transactions.filter(t => t.flagged).length.toString()} delta="-3" color="amber" />
              <MetricCard label="Est. Savings" value="TK 8,420" delta="+12%" color="emerald" />
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                 <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                    <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                       <PieChart size={24} className="text-indigo-500" />
                       Departmental Budget Health
                    </h3>
                    <div className="space-y-6">
                       {departments.slice(0, 5).map(dept => {
                         const deptTxns = transactions.filter(t => t.department_id === dept.department_id);
                         const spent = deptTxns.reduce((sum, t) => sum + (t.amount || 0), 0);
                         const util = Math.min(100, Math.round((spent / (dept.annual_budget / 12)) * 100));
                         return (
                          <div key={dept.department_id} className="space-y-2">
                              <div className="flex justify-between items-end">
                                <span className="font-bold text-slate-700">{dept.department_name}</span>
                                <span className="text-xs font-black text-slate-400 uppercase">{util}% Utilized</span>
                              </div>
                              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 rounded-full transition-all duration-700" style={{ width: `${util}%` }}></div>
                              </div>
                          </div>
                         )
                       })}
                    </div>
                 </div>
              </div>

              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                 <h3 className="text-lg font-bold text-slate-900 mb-6">Recent Activity</h3>
                 <div className="space-y-6">
                    {auditLogs.slice(0, 4).map(log => (
                      <ActivityLogItem key={log.id} user={log.user} action={log.action} time={log.time} />
                    ))}
                 </div>
                 <button 
                  onClick={() => handleNavigate('/audit-logs')}
                  className="w-full mt-8 py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 font-bold text-sm hover:border-blue-400 hover:text-blue-500 transition-all"
                 >
                    View Full Audit Trail
                 </button>
              </div>
           </div>
         </div>
       );
    }

    if (activePath === '/employees') {
      return (
        <EmployeeSection 
          accounts={accounts} 
          onOnboard={() => setShowOnboardModal(true)} 
          departments={departments} 
          onUpdatePermissions={handleUpdateEmployeePermissions} 
        />
      );
    }

    if (activePath === '/dept-control') {
      return (
        <DepartmentManagementSection 
          departments={departments}
          onAddCSV={(dept: Department) => { setSelectedDept(dept); setShowCSVModal(true); }}
          onCreateDept={() => { setSelectedDept(null); setShowCSVModal(true); }}
        />
      );
    }

    if (activePath === '/dept-status') {
      if (selectedDeptStatus) {
        return (
          <DepartmentDetailView 
            dept={selectedDeptStatus} 
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            transactions={transactions}
            onUpdateCategory={handleUpdateCategory}
            onBack={() => setSelectedDeptStatus(null)}
            onOpenDetails={setSelectedTxnDetails}
          />
        );
      }
      return (
        <div className="space-y-10 animate-in fade-in duration-500">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Fiscal Health Center</h1>
            <p className="text-slate-500 font-medium mt-1">Analytical status of each business unit.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {departments.map(dept => {
              const deptTxns = transactions.filter(t => t.department_id === dept.department_id);
              const utilization = Math.min(100, Math.round((deptTxns.reduce((sum, t) => sum + (t.amount || 0), 0) / (dept.annual_budget / 12)) * 100));
              return (
                <div 
                  key={dept.department_id}
                  className="bg-white p-8 rounded-[2.5rem] border border-slate-200 hover:border-blue-500 transition-all group cursor-pointer shadow-sm"
                  onClick={() => setSelectedDeptStatus(dept)}
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
                      <PieChart size={28} />
                    </div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{dept.department_id}</span>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">{dept.department_name}</h3>
                  <div className="space-y-4 mt-8">
                    <div className="w-full h-2 bg-slate-100 rounded-full">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${utilization}%` }}></div>
                    </div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{utilization}% Budget Utilized</p>
                  </div>
                  <button className="w-full mt-10 py-4 bg-slate-50 text-slate-900 font-bold rounded-2xl flex items-center justify-center gap-2 group-hover:bg-blue-600 group-hover:text-white transition-all">
                    Enter Unit Analysis <ArrowRight size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (activePath === '/history') {
      return <HistorySection transactions={transactions} onOpenDetails={setSelectedTxnDetails} />;
    }

    if (activePath === '/reports') {
      return <ReportsSection departments={departments} transactions={transactions} />;
    }

    if (activePath === '/audit-logs') {
      return <AuditLogsSection logs={auditLogs} />;
    }

    return (
      <div className="p-20 text-center text-slate-400 font-bold bg-white rounded-3xl border border-slate-100">
        Module Under Construction: {activePath}
      </div>
    );
  };

  return (
    <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={handleNavigate}>
      <div className="space-y-8">
        {renderContent()}
      </div>

      {showCSVModal && (
        <CSVUploadModal 
          department={selectedDept} 
          onClose={() => setShowCSVModal(false)} 
          onDeploy={handleDeployCSV}
        />
      )}

      {showOnboardModal && (
        <OnboardEmployeeModal 
          onClose={() => setShowOnboardModal(false)}
          onOnboard={handleOnboardEmployee}
        />
      )}

      {selectedTxnDetails && (
        <TransactionDetailsModal 
          transaction={selectedTxnDetails} 
          onUpdateCategory={handleUpdateCategory}
          onClose={() => setSelectedTxnDetails(null)} 
        />
      )}
    </Layout>
  );
};

// --- Sub-Sections ---

const AuditLogsSection = ({ logs }: { logs: AuditLog[] }) => (
  <div className="space-y-8 animate-in fade-in duration-500">
    <div className="flex justify-between items-end">
       <div>
         <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">System Audit Trail</h1>
         <p className="text-slate-500 font-medium mt-1">Immutable record of all administrative and financial actions.</p>
       </div>
       <button className="bg-white border border-slate-200 px-6 py-3 rounded-2xl text-slate-600 font-bold flex items-center gap-2 shadow-sm hover:bg-slate-50 transition-all">
         <Download size={18} /> Export Log JSON
       </button>
    </div>

    <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
         <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
               <tr>
                 <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date & Time</th>
                 <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Operator</th>
                 <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Operation</th>
                 <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Entity</th>
                 <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Security Tier</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
               {logs.map((log) => (
                 <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-5 text-sm font-medium text-slate-500">{log.time}</td>
                    <td className="px-6 py-5">
                       <div className="flex items-center gap-2">
                         <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-bold">{log.user[0]}</div>
                         <span className="text-sm font-bold text-slate-900">{log.user}</span>
                       </div>
                    </td>
                    <td className="px-6 py-5 text-sm font-bold text-slate-700">{log.action}</td>
                    <td className="px-6 py-5 text-sm font-medium text-slate-400">{log.target}</td>
                    <td className="px-6 py-5">
                       <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase border tracking-tight ${
                         log.type === 'security' ? 'bg-red-50 text-red-600 border-red-100' :
                         log.type === 'access' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                         'bg-blue-50 text-blue-600 border-blue-100'
                       }`}>
                         {log.type}
                       </span>
                    </td>
                 </tr>
               ))}
            </tbody>
         </table>
      </div>
    </div>
  </div>
);

const HistorySection = ({ transactions, onOpenDetails }: any) => {
  const [searchTerm, setSearchTerm] = useState('');
  const historyItems = transactions.filter((t: any) => 
    t.status === 'RESOLVED' && 
    (t.description?.toLowerCase().includes(searchTerm.toLowerCase()) || t.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
       <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Organization Ledger</h1>
            <p className="text-slate-500 font-medium mt-1">Immutable archive of approved financial transactions.</p>
          </div>
          <div className="flex gap-4">
             <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Filter records..." 
                  className="pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
             </div>
             <button className="bg-slate-900 text-white p-3 rounded-2xl shadow-lg"><Download size={20} /></button>
          </div>
       </div>

       <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left">
             <thead className="bg-slate-50 border-b border-slate-100">
               <tr>
                 <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                 <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</th>
                 <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Impact</th>
                 <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Classification</th>
                 <th className="px-6 py-4"></th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-50">
                {historyItems.map((t: any) => (
                  <tr key={t.transaction_id} className="hover:bg-slate-50/50 group transition-colors">
                     <td className="px-6 py-5 text-sm font-medium text-slate-500">{t.transaction_date}</td>
                     <td className="px-6 py-5">
                       <p className="text-sm font-bold text-slate-900">{t.description}</p>
                       <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tight">Approved For: {t.employee_name}</p>
                     </td>
                     <td className="px-6 py-5 text-sm font-black text-slate-900 text-right">TK {t.amount?.toLocaleString()}</td>
                     <td className="px-6 py-5">
                       <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase border tracking-tight ${COLORS[t.category as keyof typeof COLORS]}`}>
                         {t.category}
                       </span>
                     </td>
                     <td className="px-6 py-5 text-right">
                        <button onClick={() => onOpenDetails(t)} className="text-slate-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Edit2 size={16} />
                        </button>
                     </td>
                  </tr>
                ))}
                {historyItems.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center text-slate-400 italic font-medium">No results found matching your search.</td>
                  </tr>
                )}
             </tbody>
          </table>
       </div>
    </div>
  )
}

const ReportsSection = ({ departments, transactions }: any) => {
  const chartData = (departments || []).map((d: any) => {
    const spent = (transactions || []).filter((t: any) => t.department_id === d.department_id).reduce((s: any, t: any) => s + (t.amount || 0), 0);
    return {
      name: d.department_name,
      budget: d.annual_budget / 12,
      spent: spent
    }
  });

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
       <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Executive Intelligence</h1>
            <p className="text-slate-500 font-medium mt-1">Holistic organizational performance and spending efficiency metrics.</p>
          </div>
          <button className="bg-white border border-slate-200 px-6 py-3 rounded-2xl text-slate-600 font-bold hover:bg-slate-50 flex items-center gap-2 shadow-sm transition-colors">
            <FileText size={18} /> Detailed PDF
          </button>
       </div>

       <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
             <h3 className="text-lg font-bold text-slate-900 mb-8 flex items-center gap-2">
               <BarChart3 className="text-blue-500" size={20} />
               Budget Utilization by Business Unit
             </h3>
             <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
                      <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                      <Bar dataKey="budget" fill="#f1f5f9" radius={[4, 4, 0, 0]} name="Allocated" />
                      <Bar dataKey="spent" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Actual Spend" />
                   </BarChart>
                </ResponsiveContainer>
             </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white flex flex-col justify-between overflow-hidden relative shadow-xl">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Zap size={100} /></div>
                <div>
                   <h4 className="text-blue-400 font-black text-[10px] uppercase tracking-widest mb-4">Reconciliation Index</h4>
                   <p className="text-4xl font-black">82%</p>
                   <p className="text-slate-400 text-xs mt-2 leading-relaxed font-medium">Platform-wide anomaly resolution efficiency has improved by 14% since January.</p>
                </div>
                <div className="mt-8 h-1 w-full bg-white/10 rounded-full overflow-hidden">
                   <div className="h-full bg-blue-500 w-[82%]"></div>
                </div>
             </div>

             <div className="bg-emerald-600 p-8 rounded-[2.5rem] text-white flex flex-col justify-between shadow-xl shadow-emerald-600/20">
                <div>
                   <h4 className="text-emerald-200 font-black text-[10px] uppercase tracking-widest mb-4">AI Savings Potential</h4>
                   <p className="text-4xl font-black">TK 14,2K</p>
                   <p className="text-emerald-100/70 text-xs mt-2 leading-relaxed font-medium">Potential quarterly savings detected across redundant departmental subscriptions.</p>
                </div>
                <button className="mt-8 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold uppercase tracking-widest transition-all">Audit Savings</button>
             </div>
          </div>
       </div>

       {/* Scorecards */}
       <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Target size={20} className="text-indigo-500" /> Operational Efficiency Rankings</h3>
            <div className="group relative">
               <div className="bg-slate-50 p-2 rounded-lg cursor-help border border-slate-100"><Info size={18} className="text-slate-400" /></div>
               <div className="absolute bottom-full mb-3 right-0 w-64 p-5 bg-slate-900 text-white text-[10px] rounded-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 shadow-2xl border border-white/10">
                  <strong className="text-blue-400 block mb-1">Scoring Criteria:</strong>
                  Calculated using Reconciliation Velocity (40%), Budget Accuracy (30%), and Organizational Compliance Ratio (30%). 
               </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
             {departments.map((d: any) => (
               <div key={d.department_id} className="p-6 bg-slate-50 border border-slate-100 rounded-3xl group hover:border-blue-300 transition-all hover:shadow-lg">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 truncate">{d.department_name}</p>
                  <div className="flex items-end justify-between">
                     <div>
                        <p className="text-2xl font-black text-slate-900">9.2</p>
                        <p className="text-[9px] font-bold text-slate-400 mt-1 uppercase tracking-tight">Precision Rating</p>
                     </div>
                     <TrendingUp size={24} className="text-emerald-500 mb-1" />
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-200/50 space-y-2">
                     <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Resolve Speed</span>
                        <span className="text-[10px] font-black uppercase text-emerald-600">Optimal</span>
                     </div>
                     <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Compliance</span>
                        <span className="text-[10px] font-black uppercase text-blue-600">98%</span>
                     </div>
                  </div>
               </div>
             ))}
             {departments.length === 0 && <p className="col-span-full text-center py-20 text-slate-400 font-bold italic">Initialize units to generate rankings.</p>}
          </div>
       </div>
    </div>
  )
}

const EmployeeSection = ({ accounts, onOnboard, departments, onUpdatePermissions }: { accounts: UserAccount[], onOnboard: () => void, departments: Department[], onUpdatePermissions: any }) => {
  const [selectedEmployee, setSelectedEmployee] = useState<UserAccount | null>(null);

  if (selectedEmployee) {
    return (
      <EmployeeProfile 
        employee={selectedEmployee} 
        departments={departments} 
        onBack={() => setSelectedEmployee(null)} 
        onUpdatePermissions={(perms: any) => onUpdatePermissions(selectedEmployee.account_id, perms)}
      />
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Personnel Directory</h1>
          <p className="text-slate-500 font-medium mt-1">Manage departmental roles and system visibility.</p>
        </div>
        <button 
          onClick={onOnboard}
          className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all hover:-translate-y-1 active:scale-95"
        >
          <Plus size={20} /> Onboard Personnel
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {accounts.map(emp => (
          <div 
            key={emp.account_id}
            className="bg-white p-6 rounded-3xl border border-slate-200 hover:border-blue-400 transition-all group cursor-pointer shadow-sm hover:shadow-lg"
            onClick={() => setSelectedEmployee(emp)}
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-14 h-14 bg-slate-50 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500 rounded-2xl flex items-center justify-center font-bold text-xl transition-all shadow-inner">
                {emp.name.charAt(0)}
              </div>
              <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight ${emp.is_active ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                {emp.is_active ? 'Active' : 'Locked'}
              </span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 leading-tight mb-1">{emp.name}</h3>
            <p className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">{emp.account_no}</p>
            <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-500">
                <Clock size={16} />
                <span className="text-[10px] font-bold uppercase tracking-tighter">System Access</span>
              </div>
              <button className="text-blue-600 font-bold text-sm flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                Configure Scopes <ChevronRight size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const EmployeeProfile = ({ employee, departments, onBack, onUpdatePermissions }: { employee: UserAccount, departments: Department[], onBack: () => void, onUpdatePermissions: any }) => {
  const initialPerms = departments.filter(d => d.employee_account_ids.includes(employee.account_id)).reduce((acc, curr) => ({
    ...acc,
    [curr.department_id]: ['transactions:view']
  }), {});
  
  const [permissions, setPermissions] = useState<any>(initialPerms);
  const [showAddAccess, setShowAddAccess] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploySuccess, setDeploySuccess] = useState(false);

  const togglePermission = (deptId: string, perm: string) => {
    const current = permissions[deptId] || [];
    if (current.includes(perm)) {
      setPermissions({ ...permissions, [deptId]: current.filter((p: string) => p !== perm) });
    } else {
      setPermissions({ ...permissions, [deptId]: [...current, perm] });
    }
  };

  const handleAddUnitAccess = (deptId: string) => {
    // Explicitly update local permissions state
    setPermissions(prev => ({
      ...prev,
      [deptId]: ['transactions:view']
    }));
    setShowAddAccess(false);
  };

  const deployChanges = () => {
    setIsDeploying(true);
    // Push the compiled permissions map to parent for persistence
    onUpdatePermissions(permissions);
    
    setTimeout(() => {
      setIsDeploying(false);
      setDeploySuccess(true);
      setTimeout(() => setDeploySuccess(false), 1500);
    }, 1200);
  };

  const availablePermissions = [
    { id: 'transactions:view', label: 'View Ledger' },
    { id: 'transactions:edit', label: 'Modify Class' },
    { id: 'cases:view', label: 'Forensic Access' },
    { id: 'budgets:view', label: 'View Analytics' }
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-8 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center font-bold text-3xl shadow-inner border border-blue-200">
              {employee.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-3xl font-extrabold text-slate-900 leading-tight">{employee.name}</h2>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">{employee.account_no}</span>
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                <span className="text-xs font-bold text-emerald-600 uppercase">Authorized Corporate User</span>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={onBack} className="px-6 py-3 rounded-2xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 transition-all active:scale-95">
              Discard Changes
            </button>
            <button 
              onClick={deployChanges}
              disabled={isDeploying}
              className={`px-8 py-3 rounded-2xl font-bold text-white shadow-lg transition-all active:scale-95 flex items-center gap-2 ${deploySuccess ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'}`}
            >
              {isDeploying ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Deploying...
                </>
              ) : deploySuccess ? (
                <>
                  <Check size={18} />
                  Scopes Deployed
                </>
              ) : (
                'Deploy Scope Updates'
              )}
            </button>
          </div>
        </div>

        <div className="p-8 space-y-10">
          <div>
            <div className="flex items-center gap-2 mb-6 border-b border-slate-50 pb-4">
              <Shield className="text-blue-500" size={24} />
              <h3 className="text-xl font-bold text-slate-800 tracking-tight">Active Scopes & Authorization</h3>
            </div>
            <div className="space-y-8">
              {Object.keys(permissions).map(deptId => {
                const dept = departments.find(d => d.department_id === deptId);
                if (!dept) return null;
                return (
                  <div key={deptId} className="bg-slate-50/50 border border-slate-200 rounded-3xl p-6 lg:p-8 animate-in slide-in-from-top-2 duration-300 shadow-sm">
                    <div className="flex justify-between items-center mb-6">
                      <div className="flex items-center gap-3">
                         <div className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-blue-500 shadow-sm">
                            <Table size={18} />
                         </div>
                         <h4 className="text-lg font-bold text-slate-800">{dept.department_name}</h4>
                      </div>
                      <button 
                        onClick={() => {
                           const updated = { ...permissions };
                           delete updated[deptId];
                           setPermissions(updated);
                        }}
                        className="text-red-500 hover:text-red-600 text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-white border border-red-100 rounded-xl transition-all shadow-sm active:scale-95"
                      >
                        Revoke Access
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {availablePermissions.map(perm => {
                        const isActive = permissions[deptId]?.includes(perm.id);
                        return (
                          <div 
                            key={perm.id}
                            className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer ${isActive ? 'bg-white border-blue-400 shadow-md ring-1 ring-blue-400' : 'bg-white/40 border-slate-200 opacity-60 hover:opacity-100 hover:bg-white'}`}
                            onClick={() => togglePermission(deptId, perm.id)}
                          >
                            <span className={`text-[11px] font-bold uppercase tracking-tight ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>{perm.label}</span>
                            <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${isActive ? 'bg-blue-500' : 'bg-slate-300'}`}>
                              <div className={`w-3 h-3 bg-white rounded-full transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0'}`}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              
              <div className="pt-6 flex justify-center relative">
                 <button 
                   onClick={() => setShowAddAccess(!showAddAccess)}
                   className="flex items-center gap-3 text-blue-600 font-bold hover:bg-blue-50 px-8 py-4 rounded-2xl transition-all border border-blue-100 shadow-sm bg-white"
                 >
                    <Plus size={20} />
                    Grant New Unit Access
                 </button>

                 {showAddAccess && (
                   <div className="absolute bottom-full mb-4 w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 p-3 overflow-hidden animate-in fade-in zoom-in-95 origin-bottom">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest p-2 border-b border-slate-50 mb-2">Available Organizations</p>
                      <div className="max-h-56 overflow-y-auto space-y-1 custom-scrollbar">
                        {departments.filter(d => !permissions[d.department_id]).map(d => (
                          <button 
                            key={d.department_id}
                            onClick={() => handleAddUnitAccess(d.department_id)}
                            className="w-full text-left p-3 hover:bg-blue-600 hover:text-white text-sm font-bold text-slate-700 transition-all rounded-xl flex justify-between items-center group"
                          >
                            <span>{d.department_name}</span>
                            <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        ))}
                        {departments.filter(d => !permissions[d.department_id]).length === 0 && (
                          <p className="p-8 text-xs italic text-slate-400 text-center font-medium">No further business units <br/> left to authorize.</p>
                        )}
                      </div>
                   </div>
                 )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const DepartmentManagementSection = ({ departments, onAddCSV, onCreateDept }: any) => {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Department Control Center</h1>
        <p className="text-slate-500 font-medium mt-1">Initialize organizational units and define fiscal boundaries.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {departments.map((dept: any) => (
          <div key={dept.department_id} className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all group hover:border-blue-300">
            <div className="flex justify-between items-start mb-6">
              <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-3xl flex items-center justify-center font-bold text-2xl group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 shadow-inner">
                <Settings size={32} />
              </div>
              <div className="text-right">
                <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">Monthly Budget</span>
                <p className="text-2xl font-black text-slate-900 leading-none mt-1">TK {(dept.annual_budget / 12).toLocaleString()}</p>
              </div>
            </div>
            <h3 className="text-2xl font-bold text-slate-900 mb-2">{dept.department_name}</h3>
            <div className="flex items-center gap-6 mt-8">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Master Records</span>
                <span className="text-sm font-bold text-slate-800">{dept.transaction_count || 0} Ledger Entries</span>
              </div>
            </div>
            <div className="mt-8 flex gap-3">
              <button 
                onClick={() => onAddCSV(dept)}
                className="flex-1 py-4 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
              >
                <Upload size={18} />
                Ingest CSV
              </button>
              <button className="p-4 bg-slate-50 text-slate-400 hover:bg-slate-100 rounded-2xl transition-all shadow-sm">
                <Settings size={20} />
              </button>
            </div>
          </div>
        ))}
        <button 
          onClick={onCreateDept}
          className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2.5rem] p-10 flex flex-col items-center justify-center gap-4 text-slate-400 hover:border-blue-400 hover:bg-white hover:text-blue-500 transition-all group active:scale-[0.98]"
        >
          <div className="w-16 h-16 bg-white border border-slate-100 rounded-3xl flex items-center justify-center shadow-sm group-hover:shadow-lg group-hover:scale-110 transition-all">
            <Plus size={32} />
          </div>
          <span className="text-xl font-bold block mb-1">New Business Unit</span>
        </button>
      </div>
    </div>
  );
};

// --- Modals ---

const CSVUploadModal = ({ department, onClose, onDeploy }: any) => {
  const [file, setFile] = useState<File | null>(null);
  const [deptName, setDeptName] = useState(department?.department_name || '');
  const [budget, setBudget] = useState(department?.annual_budget || 500000);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">{department ? `Append Records` : 'Init Business Unit'}</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all"><X size={20} /></button>
        </div>
        <div className="p-8 space-y-8">
          {!department && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Unit Identifier</label>
                <input type="text" value={deptName} onChange={(e) => setDeptName(e.target.value)} className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="e.g. Dhaka Ops" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Annual Provision (TK)</label>
                <input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="500000" />
              </div>
            </div>
          )}
          <input type="file" id="csv-upload" className="hidden" accept=".csv" onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
          <label htmlFor="csv-upload" className={`border-4 border-dashed rounded-[2rem] p-16 bg-slate-50 flex flex-col items-center justify-center cursor-pointer group transition-all ${file ? 'border-blue-500 bg-blue-50/20' : 'border-slate-100 hover:border-blue-400 hover:bg-white'}`}>
            <div className={`p-6 rounded-3xl mb-4 transition-all ${file ? 'bg-blue-600 text-white' : 'bg-white text-blue-500 shadow-sm'}`}>
               <Upload size={32} />
            </div>
            <span className="text-xl font-bold text-slate-800">{file ? file.name : 'Drop CSV here or Browse'}</span>
            <p className="text-xs text-slate-400 mt-2 font-medium">Supported Columns: Date, Vendor, Amount, Unit ID</p>
          </label>
          <div className="flex gap-4">
             <button onClick={onClose} className="flex-1 py-4 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-all active:scale-95">Discard</button>
             <button 
                disabled={!file || (!department && !deptName)} 
                onClick={() => onDeploy({ name: deptName, budget: Number(budget), isNew: !department, deptId: department?.department_id })}
                className="flex-2 px-10 py-4 font-bold text-white bg-blue-600 disabled:opacity-50 hover:bg-blue-700 rounded-2xl transition-all shadow-xl shadow-blue-500/20 active:scale-95"
             >
               Deploy Financial Data
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const OnboardEmployeeModal = ({ onClose, onOnboard }: { onClose: () => void, onOnboard: (emp: UserAccount) => void }) => {
  const [name, setName] = useState('');
  const [accNo, setAccNo] = useState('');
  const [type, setType] = useState<UserRole>(UserRole.EMPLOYEE);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    const newEmp: UserAccount = {
      account_id: `ACC-${Math.floor(Math.random() * 9000) + 1000}`,
      account_no: accNo || `EMP-2025-${Math.floor(Math.random() * 900) + 100}`,
      name: name,
      account_type: type,
      company_id: null, 
      is_active: true,
      purchase_date: new Date().toISOString().split('T')[0]
    };
    onOnboard(newEmp);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-10 animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-8">
           <h2 className="text-2xl font-black text-slate-900 tracking-tight">Onboard New Personnel</h2>
           <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Personnel Name</label>
            <input type="text" required value={name} onChange={e => setName(e.target.value)} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm" placeholder="Full name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Account ID</label>
                <input type="text" value={accNo} onChange={e => setAccNo(e.target.value)} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm" placeholder="Optional" />
             </div>
             <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Access Level</label>
                <select value={type} onChange={e => setType(e.target.value as any)} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm">
                  <option value={UserRole.EMPLOYEE}>Employee</option>
                  <option value={UserRole.ADMIN}>Admin</option>
                </select>
             </div>
          </div>
          <button type="submit" className="w-full py-5 bg-blue-600 text-white font-black rounded-2xl shadow-2xl shadow-blue-500/20 active:scale-[0.98] transition-all hover:bg-blue-700">Provision Authorized Instance</button>
        </form>
      </div>
    </div>
  );
};

const DepartmentDetailView = ({ dept, activeTab, setActiveTab, transactions, onUpdateCategory, onBack, onOpenDetails }: any) => {
  const tabs = [
    { id: 'overview', label: 'Overview', icon: TrendingUp },
    { id: 'transactions', label: 'Unit Ledger', icon: Table },
    { id: 'forensic', label: 'Audit Hub', icon: ShieldAlert },
    { id: 'budget', label: 'Predictive', icon: Zap },
  ];

  return (
    <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-4 bg-white border border-slate-200 rounded-2xl text-slate-500 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm active:scale-95">
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">{dept.department_name} Status</h1>
            <p className="text-slate-400 font-bold uppercase tracking-[0.15em] text-[10px] mt-1">Real-time Fiscal Analysis Interface</p>
          </div>
        </div>
        <nav className="flex p-2 bg-slate-200/50 backdrop-blur rounded-2xl w-full lg:w-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 lg:flex-none flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 p-8 shadow-sm min-h-[500px]">
        {activeTab === 'overview' && <OverviewTab dept={dept} transactions={transactions} />}
        {activeTab === 'budget' && <BudgetPredictionTab dept={dept} />}
        {activeTab === 'forensic' && <ForensicReportTab dept={dept} transactions={transactions} onResolve={onOpenDetails} />}
        {activeTab === 'transactions' && <TransactionsTab dept={dept} transactions={transactions} onUpdateCategory={onUpdateCategory} onOpenDetails={onOpenDetails} />}
      </div>
    </div>
  );
};

const OverviewTab = ({ dept, transactions }: any) => {
  const deptTxns = (transactions || []).filter((t: any) => t.department_id === dept.department_id);
  const totalSpend = deptTxns.reduce((acc: number, t: any) => acc + (t.amount || 0), 0);
  const chartData = [
    { name: 'Sep', spend: 42000 }, { name: 'Oct', spend: 44000 }, { name: 'Nov', spend: 46000 }, { name: 'Dec', spend: 41000 }, { name: 'Jan', spend: 48000 }, { name: 'Feb', spend: totalSpend > 0 ? totalSpend : 45000 },
  ];
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard label="Unit Ledger Items" value={deptTxns.length.toString()} delta="+4" />
        <SummaryCard label="Actual Spending" value={`TK ${totalSpend.toLocaleString()}`} delta="-2.4%" />
        <SummaryCard label="Monthly Budget" value={`TK ${(dept.annual_budget / 12).toLocaleString()}`} delta="" />
        <SummaryCard label="Data Integrity" value="99.2%" delta="+0.1%" />
      </div>
      <div className="h-[300px] bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100 shadow-inner">
         <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
               <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
               <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 700}} />
               <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
               <Tooltip contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
               <Line type="monotone" dataKey="spend" stroke="#3b82f6" strokeWidth={4} dot={{r: 6, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff'}} />
            </LineChart>
         </ResponsiveContainer>
      </div>
    </div>
  );
};

const SummaryCard = ({ label, value, delta, color = 'blue' }: any) => {
  const isPositive = delta?.startsWith('+');
  const accentClasses = color === 'red' ? 'bg-red-100 text-red-600' : (isPositive ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600');
  
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
      <p className="text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">{label}</p>
      <div className="flex items-end justify-between">
        <p className="text-2xl font-black text-slate-900 leading-none">{value}</p>
        {delta && <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${accentClasses}`}>{delta}</span>}
      </div>
    </div>
  );
};

const BudgetPredictionTab = ({ dept }: any) => (
  <div className="space-y-8 animate-in fade-in duration-700">
    <div className="flex items-center gap-6 p-10 bg-slate-900 text-white rounded-[2.5rem] shadow-2xl overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 rounded-full blur-[60px] -mr-32 -mt-32"></div>
      <div className="w-24 h-24 bg-blue-600 text-white rounded-3xl flex items-center justify-center font-black text-3xl shadow-xl border border-white/10 relative z-10">94%</div>
      <div className="relative z-10">
        <h3 className="text-3xl font-black tracking-tight">Predictive Provisioning Suite</h3>
        <p className="text-slate-400 font-medium leading-relaxed max-w-xl mt-2">AI-driven analysis indicates that current spending behaviors in {dept.department_name} align with year-end fiscal goals with extremely high confidence.</p>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="p-8 bg-slate-50 border border-slate-100 rounded-[2rem] space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Est. Year-End Carryover</p>
        <p className="text-3xl font-black text-slate-900">TK 24,500</p>
      </div>
      <div className="p-8 bg-slate-50 border border-slate-100 rounded-[2rem] space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Anomalous Risk Factor</p>
        <p className="text-3xl font-black text-emerald-600">0.02</p>
      </div>
      <div className="p-8 bg-slate-50 border border-slate-100 rounded-[2rem] space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Optimization Score</p>
        <p className="text-3xl font-black text-blue-600">9.4/10</p>
      </div>
    </div>
  </div>
);

const ForensicReportTab = ({ dept, transactions, onResolve }: any) => {
  const deptTransactions = (transactions || []).filter((t: any) => t.department_id === dept.department_id && t.flagged);
  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><ShieldAlert size={18} className="text-amber-500" /> Audit Queue</h3>
          <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-3 py-1 rounded-full uppercase border border-amber-200">{deptTransactions.length} Pending Flags</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-white">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Anomaly Signature</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deptTransactions.map((txn: any) => (
                <tr key={txn.transaction_id} className="hover:bg-amber-50/20 group transition-colors">
                  <td className="px-6 py-5 text-sm font-medium text-slate-600">{txn.transaction_date}</td>
                  <td className="px-6 py-5 text-sm font-black text-slate-900 text-right">TK {txn.amount?.toLocaleString()}</td>
                  <td className="px-6 py-5">
                    <p className="text-xs font-bold text-amber-700">{txn.flag_reason || 'Statistical mismatch detected'}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Ref: {txn.transaction_id}</p>
                  </td>
                  <td className="px-6 py-5"><span className="text-[9px] font-black bg-white border border-slate-200 px-2.5 py-1 rounded uppercase shadow-sm">{txn.status}</span></td>
                  <td className="px-6 py-5 text-right"><button onClick={() => onResolve(txn)} className="text-xs font-black text-blue-600 hover:text-blue-800 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Resolve</button></td>
                </tr>
              ))}
              {deptTransactions.length === 0 && (
                <tr>
                   <td colSpan={5} className="p-24 text-center">
                      <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-100">
                         <Check size={32} />
                      </div>
                      <p className="font-bold text-slate-900 uppercase text-[10px] tracking-widest">All Forensic Anomalies Cleared</p>
                      <p className="text-slate-400 text-xs mt-1">This unit is currently compliant with all fiscal policies.</p>
                   </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const TransactionsTab = ({ dept, transactions, onUpdateCategory, onOpenDetails }: any) => {
  const deptTransactions = (transactions || []).filter((t: any) => t.department_id === dept.department_id);
  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="overflow-x-auto rounded-[2rem] border border-slate-200 shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Date</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Description</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Impact</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Classification</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {deptTransactions.map((txn: any) => (
              <tr key={txn.transaction_id} className="group hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-5 text-sm font-medium text-slate-600">{txn.transaction_date}</td>
                <td className="px-6 py-5 text-sm font-bold text-slate-900">{txn.description}</td>
                <td className="px-6 py-5 text-sm font-black text-slate-900 text-right">TK {txn.amount?.toLocaleString()}</td>
                <td className="px-6 py-5">
                  <select 
                    value={txn.category} 
                    onChange={(e) => onUpdateCategory(txn.transaction_id, e.target.value as any)}
                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-tight border outline-none cursor-pointer transition-all shadow-sm ${COLORS[txn.category as keyof typeof COLORS]}`}
                  >
                    <option value="NECESSARY">Necessary</option>
                    <option value="OPTIONAL">Optional</option>
                    <option value="RISKY">Risky Anomaly</option>
                    <option value="UNNECESSARY">Wasteful</option>
                    <option value="UNCATEGORIZED">Uncategorized</option>
                  </select>
                </td>
                <td className="px-6 py-5 text-right"><button onClick={() => onOpenDetails(txn)} className="text-slate-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"><Edit2 size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TransactionDetailsModal = ({ transaction, onUpdateCategory, onClose }: any) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
    <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-10 animate-in zoom-in-95 duration-300 overflow-hidden">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Ledger Entry Audit</h2>
        <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all"><X size={20} /></button>
      </div>
      <div className="space-y-6">
        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 shadow-inner">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Fiscal Impact</p>
          <p className="text-2xl font-black text-slate-900">TK {transaction.amount?.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-2 font-medium">{transaction.description}</p>
        </div>
        <div className="p-5 bg-blue-50 border border-blue-100 rounded-2xl">
          <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-3 text-center">Correct Classification</p>
          <select 
            value={transaction.category} 
            onChange={(e) => onUpdateCategory(transaction.transaction_id, e.target.value as any)}
            className={`w-full px-5 py-4 rounded-2xl font-black border outline-none shadow-md transition-all active:scale-[0.98] ${COLORS[transaction.category as keyof typeof COLORS]}`}
          >
            <option value="NECESSARY">Necessary Asset</option>
            <option value="OPTIONAL">Optional Spending</option>
            <option value="RISKY">Forensic Flag</option>
            <option value="UNNECESSARY">Wasteful Spending</option>
            <option value="UNCATEGORIZED">Uncategorized</option>
          </select>
        </div>
        <button onClick={onClose} className="w-full py-5 bg-slate-900 text-white font-black rounded-2xl shadow-xl active:scale-95 transition-all hover:bg-black">Sync Ledger Entry</button>
      </div>
    </div>
  </div>
);

const ActivityLogItem = ({ user, action, time }: any) => (
  <div className="flex gap-4 group transition-all">
     <div className="w-9 h-9 rounded-2xl bg-slate-100 flex items-center justify-center text-[11px] font-black text-slate-400 shrink-0 uppercase shadow-inner group-hover:bg-blue-600 group-hover:text-white transition-colors">
       {user.split(' ').map((n: string) => n[0]).join('')}
     </div>
     <div className="flex-1">
        <p className="text-[13px] font-bold text-slate-800 leading-tight group-hover:text-blue-600 transition-colors">{action}</p>
        <div className="flex items-center gap-2 mt-1">
           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{user}</span>
           <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{time}</span>
        </div>
     </div>
  </div>
);

const MetricCard = ({ label, value, delta, color = 'blue' }: any) => {
  const accentColors: any = {
    blue: 'text-blue-600 bg-blue-50',
    amber: 'text-amber-600 bg-amber-50',
    emerald: 'text-emerald-600 bg-emerald-50'
  };
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md">
       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
       <div className="mt-3 flex items-end justify-between">
          <p className="text-3xl font-black text-slate-900 leading-none">{value}</p>
          {delta && <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${accentColors[color as keyof typeof accentColors]}`}>{delta}</span>}
       </div>
    </div>
  );
};

export default AdminDashboard;
