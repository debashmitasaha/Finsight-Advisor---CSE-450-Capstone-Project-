import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, Users, Wallet } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { AdminOverview, Company, Department, UserAccount } from '../types';

interface SuperAdminDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const cardStyle = 'bg-white p-6 rounded-3xl border border-slate-200 shadow-sm';

const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/dashboard');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [departmentBudget, setDepartmentBudget] = useState('0');
  const [departmentCompanyId, setDepartmentCompanyId] = useState('');
  const [newUser, setNewUser] = useState({ username: '', email: '', password: 'password123', company_id: '', is_admin: false });

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewData, companyData, departmentData, userData] = await Promise.all([
        api.adminOverview(),
        api.companies(),
        api.departments(),
        api.users(),
      ]);
      setOverview(overviewData);
      setCompanies(companyData);
      setDepartments(departmentData);
      setUsers(userData);
      if (!departmentCompanyId && companyData[0]) {
        setDepartmentCompanyId(companyData[0].company_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const companyOptions = useMemo(() => companies.map((company) => ({ value: company.company_id, label: company.company_name })), [companies]);

  const createCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    await api.createCompany(companyName);
    setCompanyName('');
    await loadData();
  };

  const createDepartment = async (event: React.FormEvent) => {
    event.preventDefault();
    await api.createDepartment({
      department_name: departmentName,
      annual_budget: Number(departmentBudget),
      company_id: departmentCompanyId || null,
    });
    setDepartmentName('');
    setDepartmentBudget('0');
    await loadData();
  };

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    await api.createUser({
      username: newUser.username,
      email: newUser.email,
      password: newUser.password,
      company_id: newUser.company_id || null,
      is_admin: newUser.is_admin,
    });
    setNewUser({ username: '', email: '', password: 'password123', company_id: '', is_admin: false });
    await loadData();
  };

  const renderDashboard = () => (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Platform Control Center</h1>
        <p className="text-slate-500 mt-2">Real-time company, department, and user management across the FinSight workspace.</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard icon={Building2} label="Companies" value={overview?.companies ?? 0} />
        <StatCard icon={Wallet} label="Departments" value={overview?.departments ?? 0} />
        <StatCard icon={Users} label="Users" value={overview?.users ?? 0} />
        <StatCard icon={Plus} label="Uploads" value={overview?.uploads ?? 0} />
      </div>
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Department Activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-slate-500">
                <th className="py-3">Department</th>
                <th className="py-3">Budget</th>
                <th className="py-3">Transactions</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.department_summaries || []).map((department) => (
                <tr key={department.department_id} className="border-t border-slate-100 text-sm text-slate-700">
                  <td className="py-3 font-semibold">{department.department_name}</td>
                  <td className="py-3">TK {Number(department.annual_budget || 0).toLocaleString()}</td>
                  <td className="py-3">{department.transaction_count || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderCompanies = () => (
    <div className="grid grid-cols-1 xl:grid-cols-[1.2fr,0.8fr] gap-8">
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Companies</h2>
        <div className="space-y-3">
          {companies.map((company) => (
            <div key={company.company_id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-900">{company.company_name}</p>
                <p className="text-sm text-slate-500">{company.department_count || 0} departments • {company.user_count || 0} users</p>
              </div>
              <span className="text-xs font-bold text-slate-400">{company.company_id}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-6">
        <form className={cardStyle} onSubmit={createCompany}>
          <h2 className="text-lg font-bold text-slate-900 mb-4">Create Company</h2>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Company name" required />
          <button className="mt-4 w-full rounded-2xl bg-blue-600 text-white py-3 font-bold">Create Company</button>
        </form>
        <form className={cardStyle} onSubmit={createDepartment}>
          <h2 className="text-lg font-bold text-slate-900 mb-4">Create Department</h2>
          <select value={departmentCompanyId} onChange={(e) => setDepartmentCompanyId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 mb-3">
            {companyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 mb-3" placeholder="Department name" required />
          <input value={departmentBudget} onChange={(e) => setDepartmentBudget(e.target.value)} type="number" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Annual budget" required />
          <button className="mt-4 w-full rounded-2xl bg-slate-900 text-white py-3 font-bold">Create Department</button>
        </form>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr,1fr] gap-8">
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Users</h2>
        <div className="space-y-3 max-h-[480px] overflow-auto">
          {users.map((account) => (
            <div key={account.user_id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <p className="font-bold text-slate-900">{account.name}</p>
              <p className="text-sm text-slate-500">{account.email}</p>
              <p className="text-xs text-slate-400 mt-1">{account.account_type}</p>
            </div>
          ))}
        </div>
      </div>
      <form className={cardStyle} onSubmit={createUser}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Create User</h2>
        <div className="space-y-3">
          <input value={newUser.username} onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Username" required />
          <input value={newUser.email} onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Email" required />
          <input value={newUser.password} onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Password" required />
          <select value={newUser.company_id} onChange={(e) => setNewUser((prev) => ({ ...prev, company_id: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <option value="">No company / super admin</option>
            {companyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <input type="checkbox" checked={newUser.is_admin} onChange={(e) => setNewUser((prev) => ({ ...prev, is_admin: e.target.checked }))} />
            Grant admin access
          </label>
        </div>
        <button className="mt-4 w-full rounded-2xl bg-blue-600 text-white py-3 font-bold">Create User</button>
      </form>
    </div>
  );

  return (
    <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={setActivePath}>
      {loading ? <p className="text-slate-500">Loading dashboard...</p> : activePath === '/dashboard' ? renderDashboard() : activePath === '/companies' ? renderCompanies() : renderSettings()}
    </Layout>
  );
};

const StatCard = ({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) => (
  <div className={cardStyle}>
    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
      <Icon size={24} />
    </div>
    <p className="text-sm uppercase tracking-wider text-slate-500 font-bold">{label}</p>
    <p className="text-3xl font-extrabold text-slate-900 mt-1">{value}</p>
  </div>
);

export default SuperAdminDashboard;
