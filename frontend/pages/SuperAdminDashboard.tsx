
import React, { useState } from 'react';
import Layout from '../components/Layout';
import { UserAccount, Company, UserRole } from '../types';
import { MOCK_COMPANIES, MOCK_ACCOUNTS } from '../constants';
import { Building2, Users, Activity, ExternalLink, Plus, MoreHorizontal, UserX, UserCheck, X, Clock, Settings, Trash2, ChevronLeft } from 'lucide-react';

interface SuperAdminDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/dashboard');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [accounts, setAccounts] = useState<UserAccount[]>(MOCK_ACCOUNTS);

  const handleCompanyClick = (company: Company) => {
    setSelectedCompany(company);
    setActivePath('/companies/details');
  };

  const backToList = () => {
    setSelectedCompany(null);
    setActivePath('/companies');
  };

  const handleNavigate = (path: string) => {
    setActivePath(path);
    if (path !== '/companies/details') setSelectedCompany(null);
  };

  const handleToggleStatus = (accountId: string) => {
    setAccounts(prev => prev.map(acc => 
      acc.account_id === accountId ? { ...acc, is_active: !acc.is_active } : acc
    ));
  };

  const handleDeleteUser = (accountId: string) => {
    if (confirm("Are you sure you want to permanently remove this user?")) {
      setAccounts(prev => prev.filter(acc => acc.account_id !== accountId));
    }
  };

  const handleAddUser = (newUser: UserAccount) => {
    setAccounts(prev => [...prev, newUser]);
  };

  const renderContent = () => {
    if (activePath === '/dashboard') {
      return (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Platform Insights</h1>
            <p className="text-slate-500 font-medium mt-1">High-level system health and metrics</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard icon={Building2} label="Total Companies" value={MOCK_COMPANIES.length.toString()} color="blue" />
            <StatCard icon={Users} label="Active Accounts" value={accounts.filter(a => a.is_active).length.toString()} color="emerald" />
            <StatCard icon={Activity} label="System Uptime" value="99.99%" color="indigo" />
          </div>
          <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
             <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Activity size={40} />
             </div>
             <h3 className="text-2xl font-bold text-slate-900">System Monitoring Active</h3>
             <p className="text-slate-500 mt-2 max-w-md mx-auto">All infrastructure components are performing within normal parameters.</p>
          </div>
        </div>
      );
    }

    if (activePath === '/companies') {
      return (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Company Management</h1>
            <p className="text-slate-500 font-medium mt-1">Manage corporate entities and their subscription status</p>
          </div>
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">Company Catalog</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">#</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Company Name</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">User Count</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Purchase Date</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {MOCK_COMPANIES.map((company, idx) => (
                    <tr 
                      key={company.company_id} 
                      className="hover:bg-slate-50/50 transition-colors group cursor-pointer"
                      onClick={() => handleCompanyClick(company)}
                    >
                      <td className="px-6 py-5 text-sm font-semibold text-slate-400">{idx + 1}</td>
                      <td className="px-6 py-5">
                        <span className="text-sm font-bold text-slate-900 hover:text-blue-600 transition-colors flex items-center gap-2">
                          {company.company_name}
                          <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                      </td>
                      <td className="px-6 py-5 text-sm font-medium text-slate-600">
                        {accounts.filter(a => a.company_id === company.company_id).length}
                      </td>
                      <td className="px-6 py-5 text-sm text-slate-500">{new Date(company.purchase_date).toLocaleDateString()}</td>
                      <td className="px-6 py-5">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${company.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {company.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button className="text-slate-400 hover:text-slate-600">
                          <MoreHorizontal size={20} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (activePath === '/companies/details' && selectedCompany) {
      return (
        <CompanyDetailView 
          company={selectedCompany} 
          accounts={accounts.filter(acc => acc.company_id === selectedCompany.company_id)}
          onBack={backToList} 
          onAddUser={() => setShowAddUserModal(true)}
          onToggleStatus={handleToggleStatus}
          onDeleteUser={handleDeleteUser}
        />
      );
    }

    if (activePath === '/settings') {
      return (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">System Settings</h1>
            <p className="text-slate-500 font-medium mt-1">Global platform configuration and maintenance</p>
          </div>
          <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 shadow-sm text-center flex flex-col items-center">
             <Settings className="text-blue-500 mb-4" size={48} />
             <p className="text-slate-900 font-bold text-xl">Platform Core v2.4</p>
             <p className="text-slate-500 text-sm mt-2">All global parameters are optimized for enterprise stability.</p>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <Layout 
      user={user} 
      onLogout={onLogout} 
      activePath={activePath === '/companies/details' ? '/companies' : activePath}
      onNavigate={handleNavigate}
    >
      {renderContent()}

      {showAddUserModal && selectedCompany && (
        <CreateUserModal 
          companyId={selectedCompany.company_id}
          companyName={selectedCompany.company_name} 
          onClose={() => setShowAddUserModal(false)} 
          onSubmit={handleAddUser}
        />
      )}
    </Layout>
  );
};

const StatCard = ({ icon: Icon, label, value, color }: any) => {
  const colors: any = {
    blue: 'bg-blue-50 text-blue-600 ring-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  };
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-5">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ring-4 ${colors[color]}`}>
        <Icon size={28} />
      </div>
      <div>
        <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="text-3xl font-extrabold text-slate-900 mt-0.5">{value}</p>
      </div>
    </div>
  );
};

const CompanyDetailView = ({ company, accounts, onBack, onAddUser, onToggleStatus, onDeleteUser }: any) => {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-xl transition-all">
          <ChevronLeft size={24} />
        </button>
        <div className="h-8 w-[1px] bg-slate-200 mx-2"></div>
        <nav className="flex text-sm font-medium text-slate-500" aria-label="Breadcrumb">
          <ol className="flex items-center space-x-2">
            <li><button onClick={onBack} className="hover:text-slate-900">Companies</button></li>
            <li><span className="mx-2">/</span></li>
            <li className="text-slate-900 font-bold">{company.company_name}</li>
          </ol>
        </nav>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">{company.company_name}</h1>
          <div className="flex items-center gap-4 mt-4 text-sm font-medium">
            <div className="flex items-center gap-2 text-slate-500">
              <Building2 size={16} />
              <span>ID: {company.company_id}</span>
            </div>
            <div className="w-1 h-1 bg-slate-300 rounded-full"></div>
            <div className="flex items-center gap-2 text-slate-500">
              <span>Subscription started: {new Date(company.purchase_date).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
        <button 
          onClick={onAddUser}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3.5 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-blue-500/25 active:scale-95"
        >
          <Plus size={20} />
          Create New User
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800">Active Accounts ({accounts.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Account ID</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Full Name</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Last Active</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.length > 0 ? accounts.map((acc: UserAccount) => (
                <tr key={acc.account_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-5 text-sm font-mono font-medium text-slate-500">{acc.account_id}</td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center font-bold text-slate-600">
                        {acc.name.charAt(0)}
                      </div>
                      <span className="text-sm font-bold text-slate-900">{acc.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${acc.account_type === UserRole.ADMIN ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {acc.account_type}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-sm text-slate-500 font-medium">
                    {acc.last_active ? new Date(acc.last_active).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-6 py-5">
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight ${acc.is_active ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                      {acc.is_active ? 'Live' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => onToggleStatus(acc.account_id)}
                        title={acc.is_active ? "Deactivate User" : "Activate User"}
                        className={`p-2 rounded-xl transition-all ${acc.is_active ? 'text-amber-400 hover:text-amber-600 hover:bg-amber-50' : 'text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        {acc.is_active ? <UserX size={18} /> : <UserCheck size={18} />}
                      </button>
                      <button 
                        onClick={() => onDeleteUser(acc.account_id)}
                        title="Permanently Remove"
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center text-slate-400 font-medium italic">
                    No accounts found for this company.
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

const CreateUserModal = ({ companyId, companyName, onClose, onSubmit }: any) => {
  const [empName, setEmpName] = useState('');
  const [accNo, setAccNo] = useState('');
  const [password, setPassword] = useState('');
  const [type, setType] = useState(UserRole.EMPLOYEE);

  const generatePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let pass = "";
    for (let i = 0; i < 12; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    setPassword(pass);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newUser: UserAccount = {
      account_id: `ACC-${Math.floor(1000 + Math.random() * 9000)}`,
      account_no: accNo,
      name: empName,
      account_type: type,
      company_id: companyId,
      is_active: true,
      purchase_date: new Date().toISOString().split('T')[0]
    };
    onSubmit(newUser);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-8 animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Create User Account</h2>
            <p className="text-sm font-medium text-slate-500 mt-1">For {companyName}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all">
            <X size={20} />
          </button>
        </div>

        <form className="space-y-5" onSubmit={handleFormSubmit}>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Employee Name</label>
            <input 
              type="text" 
              placeholder="Full name"
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white transition-all font-medium"
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Account Number</label>
            <input 
              type="text" 
              placeholder="e.g. EMP-2025-001"
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white transition-all font-medium"
              value={accNo}
              onChange={(e) => setAccNo(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Account Type</label>
            <select 
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white transition-all font-medium"
              value={type}
              onChange={(e) => setType(e.target.value as UserRole)}
            >
              <option value={UserRole.EMPLOYEE}>Employee</option>
              <option value={UserRole.ADMIN}>Company Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Initial Password</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Secure password"
                className="flex-1 px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white transition-all font-medium"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button 
                type="button"
                onClick={generatePassword}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 rounded-2xl font-bold transition-all"
              >
                Generate
              </button>
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-4 rounded-2xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-100 transition-all active:scale-95"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="flex-2 py-4 px-10 rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/25 active:scale-95"
            >
              Create Account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SuperAdminDashboard;
