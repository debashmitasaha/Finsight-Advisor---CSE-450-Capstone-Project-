import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { AdminOverview, Company, UserAccount, UserRole } from '../types';
import {
  Activity,
  Building2,
  ChevronLeft,
  ExternalLink,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
  UserCheck,
  Users,
  UserX,
  X,
} from 'lucide-react';

interface SuperAdminDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const getErrorMessage = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback;

const formatDate = (value?: string | null) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleDateString();
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Never';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Never' : parsed.toLocaleString();
};

const generatePassword = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let pass = '';
  for (let index = 0; index < 12; index += 1) {
    pass += chars[Math.floor(Math.random() * chars.length)];
  }
  return pass;
};

const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/dashboard');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.company_id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const companyAccounts = useMemo(
    () => (selectedCompany ? users.filter((account) => account.company_id === selectedCompany.company_id) : []),
    [selectedCompany, users],
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);

    const [overviewResult, companiesResult, usersResult] = await Promise.allSettled([
      api.adminOverview(),
      api.companies(),
      api.users(),
    ]);

    const failures: string[] = [];

    if (overviewResult.status === 'fulfilled') {
      setOverview(overviewResult.value);
    } else {
      setOverview(null);
      failures.push(`overview: ${getErrorMessage(overviewResult.reason, 'Unable to load overview')}`);
    }

    if (companiesResult.status === 'fulfilled') {
      setCompanies(companiesResult.value);
    } else {
      setCompanies([]);
      failures.push(`companies: ${getErrorMessage(companiesResult.reason, 'Unable to load companies')}`);
    }

    if (usersResult.status === 'fulfilled') {
      setUsers(usersResult.value);
    } else {
      setUsers([]);
      failures.push(`users: ${getErrorMessage(usersResult.reason, 'Unable to load users')}`);
    }

    setError(failures.length ? failures.join(' | ') : null);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleNavigate = (path: string) => {
    setActivePath(path);
    if (path !== '/companies/details') {
      setSelectedCompanyId(null);
    }
  };

  const handleCompanyClick = (company: Company) => {
    setSelectedCompanyId(company.company_id);
    setActivePath('/companies/details');
  };

  const backToList = () => {
    setSelectedCompanyId(null);
    setActivePath('/companies');
  };

  const handleToggleStatus = async (account: UserAccount) => {
    try {
      const updated = await api.updateUserStatus(account.user_id, !account.is_active);
      setUsers((prev) => prev.map((entry) => (entry.user_id === updated.user_id ? updated : entry)));
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to update user status'));
    }
  };

  const handleDeleteUser = async (account: UserAccount) => {
    if (!window.confirm(`Are you sure you want to permanently remove ${account.email}?`)) {
      return;
    }
    try {
      await api.deleteUser(account.user_id);
      setUsers((prev) => prev.filter((entry) => entry.user_id !== account.user_id));
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete user'));
    }
  };

  const handleAddUser = async (payload: { username: string; email: string; password: string; is_admin: boolean; company_id: string }) => {
    try {
      const created = await api.createUser(payload);
      setUsers((prev) => [...prev, created]);
      setShowAddUserModal(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to create user'));
    }
  };

  const renderDashboard = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Platform Insights</h1>
        <p className="text-slate-500 font-medium mt-1">High-level system health and metrics</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard icon={Building2} label="Total Companies" value={String(companies.length || overview?.companies || 0)} color="blue" />
        <StatCard icon={Users} label="Active Accounts" value={String(users.filter((account) => account.is_active).length)} color="emerald" />
        <StatCard icon={Activity} label="System Uptime" value="99.99%" color="indigo" />
      </div>
      <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
        <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <Activity size={40} />
        </div>
        <h3 className="text-2xl font-bold text-slate-900">System Monitoring Active</h3>
        <p className="text-slate-500 mt-2 max-w-md mx-auto">
          Live platform metrics are connected to your FinSight database and reflecting the current workspace state.
        </p>
      </div>
    </div>
  );

  const renderCompanies = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Company Management</h1>
        <p className="text-slate-500 font-medium mt-1">Manage corporate entities and review their active users</p>
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
                <th className="px-6 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.length > 0 ? companies.map((company, index) => (
                <tr
                  key={company.company_id}
                  className="hover:bg-slate-50/50 transition-colors group cursor-pointer"
                  onClick={() => handleCompanyClick(company)}
                >
                  <td className="px-6 py-5 text-sm font-semibold text-slate-400">{index + 1}</td>
                  <td className="px-6 py-5">
                    <span className="text-sm font-bold text-slate-900 hover:text-blue-600 transition-colors flex items-center gap-2">
                      {company.company_name}
                      <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                  </td>
                  <td className="px-6 py-5 text-sm font-medium text-slate-600">{company.user_count || 0}</td>
                  <td className="px-6 py-5 text-sm text-slate-500">{formatDate(company.purchase_date)}</td>
                  <td className="px-6 py-5">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${company.is_active === false ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {company.is_active === false ? 'Inactive' : 'Active'}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <button type="button" className="text-slate-400 hover:text-slate-600">
                      <MoreHorizontal size={20} />
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center text-slate-400 font-medium italic">
                    No companies found in the platform yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderSettings = () => (
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

  const content = loading
    ? <p className="text-slate-500">Loading dashboard...</p>
    : activePath === '/dashboard'
      ? renderDashboard()
      : activePath === '/companies'
        ? renderCompanies()
        : activePath === '/companies/details' && selectedCompany
          ? (
            <CompanyDetailView
              company={selectedCompany}
              accounts={companyAccounts}
              currentUserId={user.user_id}
              onBack={backToList}
              onAddUser={() => setShowAddUserModal(true)}
              onToggleStatus={handleToggleStatus}
              onDeleteUser={handleDeleteUser}
            />
          )
          : renderSettings();

  return (
    <Layout
      user={user}
      onLogout={onLogout}
      activePath={activePath === '/companies/details' ? '/companies' : activePath}
      onNavigate={handleNavigate}
    >
      {!loading && error && <p className="text-sm text-red-500 mb-4">{error}</p>}
      {content}
      {showAddUserModal && selectedCompany && (
        <CreateUserModal
          company={selectedCompany}
          onClose={() => setShowAddUserModal(false)}
          onSubmit={handleAddUser}
        />
      )}
    </Layout>
  );
};

const StatCard = ({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: 'blue' | 'emerald' | 'indigo' }) => {
  const colors = {
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

const CompanyDetailView = ({
  company,
  accounts,
  currentUserId,
  onBack,
  onAddUser,
  onToggleStatus,
  onDeleteUser,
}: {
  company: Company;
  accounts: UserAccount[];
  currentUserId: string;
  onBack: () => void;
  onAddUser: () => void;
  onToggleStatus: (account: UserAccount) => void;
  onDeleteUser: (account: UserAccount) => void;
}) => (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
    <div className="flex items-center gap-3">
      <button onClick={onBack} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-xl transition-all">
        <ChevronLeft size={24} />
      </button>
      <div className="h-8 w-[1px] bg-slate-200 mx-2" />
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
        <div className="flex items-center gap-4 mt-4 text-sm font-medium flex-wrap">
          <div className="flex items-center gap-2 text-slate-500">
            <Building2 size={16} />
            <span>ID: {company.company_id}</span>
          </div>
          <div className="w-1 h-1 bg-slate-300 rounded-full" />
          <div className="flex items-center gap-2 text-slate-500">
            <span>Subscription started: {formatDate(company.purchase_date)}</span>
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
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Email</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Full Name</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Last Active</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.length > 0 ? accounts.map((account) => (
              <tr key={account.user_id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-5 text-sm font-medium text-slate-500">{account.email}</td>
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center font-bold text-slate-600">
                      {account.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-bold text-slate-900">{account.name}</span>
                  </div>
                </td>
                <td className="px-6 py-5">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${account.account_type === UserRole.ADMIN ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {account.account_type}
                  </span>
                </td>
                <td className="px-6 py-5 text-sm text-slate-500 font-medium">{formatDateTime(account.last_login)}</td>
                <td className="px-6 py-5">
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight ${account.is_active ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                    {account.is_active ? 'Live' : 'Disabled'}
                  </span>
                </td>
                <td className="px-6 py-5 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => onToggleStatus(account)}
                      title={account.is_active ? 'Deactivate User' : 'Activate User'}
                      className={`p-2 rounded-xl transition-all ${account.is_active ? 'text-amber-400 hover:text-amber-600 hover:bg-amber-50' : 'text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                      disabled={account.user_id === currentUserId}
                    >
                      {account.is_active ? <UserX size={18} /> : <UserCheck size={18} />}
                    </button>
                    <button
                      onClick={() => onDeleteUser(account)}
                      title="Permanently Remove"
                      className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all disabled:opacity-40"
                      disabled={account.user_id === currentUserId}
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

const CreateUserModal = ({
  company,
  onClose,
  onSubmit,
}: {
  company: Company;
  onClose: () => void;
  onSubmit: (payload: { username: string; email: string; password: string; is_admin: boolean; company_id: string }) => Promise<void>;
}) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [type, setType] = useState<UserRole>(UserRole.EMPLOYEE);
  const [submitting, setSubmitting] = useState(false);

  const handleFormSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        username,
        email,
        password,
        is_admin: type === UserRole.ADMIN,
        company_id: company.company_id,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-8 animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Create User Account</h2>
            <p className="text-sm font-medium text-slate-500 mt-1">For {company.company_name}</p>
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
              placeholder="Full name or username"
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white transition-all font-medium"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Email</label>
            <input
              type="email"
              placeholder="employee@company.com"
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white transition-all font-medium"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Account Type</label>
            <select
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white transition-all font-medium"
              value={type}
              onChange={(event) => setType(event.target.value as UserRole)}
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
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
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
              className="flex-1 py-4 rounded-2xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all active:scale-95"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="py-4 px-10 rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/25 active:scale-95 disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SuperAdminDashboard;
