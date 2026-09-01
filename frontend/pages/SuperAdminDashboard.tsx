import React, { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronLeft, Plus, Trash2, UserCheck, Users, UserX, Wallet, X } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { AdminOverview, Company, Department, UserAccount, UserRole } from '../types';

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
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', email: '', password: 'password123', company_id: '', is_admin: false });

  const selectedCompany = useMemo(
    () => companies.find((company) => company.company_id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  );

  const companyAccounts = useMemo(
    () => (selectedCompany ? users.filter((account) => account.company_id === selectedCompany.company_id) : []),
    [selectedCompany, users],
  );

  const companyOptions = useMemo(() => companies.map((company) => ({ value: company.company_id, label: company.company_name })), [companies]);

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

  const createCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    await createCompanyByName(companyName);
  };

  const createCompanyByName = async (name: string) => {
    try {
      const created = await api.createCompany(name.trim());
      setCompanies((current) => [...current, created]);
      setOverview((current) => current ? { ...current, companies: current.companies + 1 } : current);
      setCompanyName('');
      setShowAddCompanyModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create company');
    }
  };

  const createDepartment = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.createDepartment({
        department_name: departmentName,
        annual_budget: Number(departmentBudget),
        company_id: departmentCompanyId || null,
      });
      setDepartmentName('');
      setDepartmentBudget('0');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create department');
    }
  };

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    await createUserFromPayload(newUser);
    setNewUser({ username: '', email: '', password: 'password123', company_id: '', is_admin: false });
  };

  const createUserFromPayload = async (payload: { username: string; email: string; password: string; company_id?: string | null; is_admin: boolean }) => {
    try {
      const created = await api.createUser(payload);
      setUsers((current) => [...current, created]);
      setCompanies((current) =>
        current.map((company) =>
          company.company_id === payload.company_id
            ? { ...company, user_count: (company.user_count || 0) + 1 }
            : company,
        ),
      );
      setOverview((current) => current ? { ...current, users: current.users + 1 } : current);
      setShowAddUserModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create user');
    }
  };

  const handleToggleStatus = async (account: UserAccount) => {
    try {
      const updated = await api.updateUserStatus(account.user_id, !account.is_active);
      setUsers((current) => current.map((entry) => entry.user_id === updated.user_id ? updated : entry));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update user status');
    }
  };

  const handleDeleteUser = async (account: UserAccount) => {
    if (!window.confirm(`Are you sure you want to permanently remove ${account.email}?`)) {
      return;
    }
    try {
      await api.deleteUser(account.user_id);
      setUsers((current) => current.filter((entry) => entry.user_id !== account.user_id));
      setCompanies((current) =>
        current.map((company) =>
          company.company_id === account.company_id
            ? { ...company, user_count: Math.max(0, (company.user_count || 1) - 1) }
            : company,
        ),
      );
      setOverview((current) => current ? { ...current, users: Math.max(0, current.users - 1) } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete user');
    }
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
                <th className="py-3">Used This Year</th>
                <th className="py-3">Utilization</th>
                <th className="py-3">Transactions</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.department_summaries || []).map((department) => (
                <tr key={department.department_id} className="border-t border-slate-100 text-sm text-slate-700">
                  <td className="py-3 font-semibold">{department.department_name}</td>
                  <td className="py-3">TK {Number(department.annual_budget || 0).toLocaleString()}</td>
                  <td className="py-3">TK {Number(department.used_budget_current_year || 0).toLocaleString()}</td>
                  <td className="py-3">{Number(department.annual_budget_utilization_pct || 0).toFixed(1)}%</td>
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
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-xl font-bold text-slate-900">Companies</h2>
          <button type="button" onClick={() => setShowAddCompanyModal(true)} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
            <Plus size={16} />
            Add
          </button>
        </div>
        <div className="space-y-3">
          {companies.map((company) => (
            <button
              key={company.company_id}
              type="button"
              onClick={() => handleCompanyClick(company)}
              className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-left transition hover:border-blue-200 hover:bg-blue-50/40"
            >
              <div>
                <p className="font-bold text-slate-900">{company.company_name}</p>
                <p className="text-sm text-slate-500">{company.department_count || 0} departments | {company.user_count || 0} users</p>
              </div>
              <span className="text-xs font-bold text-slate-400">{company.is_active === false ? 'Disabled' : 'Live'}</span>
            </button>
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

  const renderCompanyDetails = () => {
    if (!selectedCompany) return renderCompanies();

    return (
      <CompanyDetailView
        company={selectedCompany}
        accounts={companyAccounts}
        currentUserId={user.user_id}
        onBack={() => {
          setSelectedCompanyId(null);
          setActivePath('/companies');
        }}
        onAddUser={() => setShowAddUserModal(true)}
        onToggleStatus={handleToggleStatus}
        onDeleteUser={handleDeleteUser}
      />
    );
  };

  const renderSettings = () => (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr,1fr] gap-8">
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Users</h2>
        <div className="space-y-3 max-h-[480px] overflow-auto">
          {users.map((account) => (
            <div key={account.user_id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900">{account.name}</p>
                  <p className="text-sm text-slate-500">{account.email}</p>
                  <p className="text-xs text-slate-400 mt-1">{account.account_type} | {account.is_active ? 'Live' : 'Disabled'}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleToggleStatus(account)} disabled={account.user_id === user.user_id} className="rounded-xl bg-white p-2 text-slate-500 shadow-sm disabled:opacity-40">
                    {account.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                  </button>
                  <button type="button" onClick={() => handleDeleteUser(account)} disabled={account.user_id === user.user_id} className="rounded-xl bg-white p-2 text-red-500 shadow-sm disabled:opacity-40">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
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

  const content = loading
    ? <p className="text-slate-500">Loading dashboard...</p>
    : activePath === '/dashboard'
      ? renderDashboard()
      : activePath === '/companies'
        ? renderCompanies()
        : activePath === '/companies/details'
          ? renderCompanyDetails()
          : renderSettings();

  return (
    <Layout user={user} onLogout={onLogout} activePath={activePath === '/companies/details' ? '/companies' : activePath} onNavigate={handleNavigate}>
      {!loading && error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {content}
      {showAddUserModal && selectedCompany && (
        <CreateUserModal
          company={selectedCompany}
          onClose={() => setShowAddUserModal(false)}
          onSubmit={(payload) => createUserFromPayload(payload)}
        />
      )}
      {showAddCompanyModal && (
        <CreateCompanyModal
          onClose={() => setShowAddCompanyModal(false)}
          onSubmit={createCompanyByName}
        />
      )}
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
  <div className="space-y-8">
    <div className="flex items-center gap-3">
      <button onClick={onBack} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
        <ChevronLeft size={24} />
      </button>
      <div>
        <p className="text-sm font-bold text-slate-500">Companies / {company.company_name}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{company.company_name}</h1>
      </div>
    </div>

    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div className="space-y-2 text-sm font-medium text-slate-500">
        <p>ID: {company.company_id}</p>
        <p>Subscription started: {formatDate(company.purchase_date)}</p>
        <p>Status: {company.is_active === false ? 'Disabled' : 'Live'}</p>
      </div>
      <button onClick={onAddUser} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white">
        <Plus size={18} />
        Create New User
      </button>
    </div>

    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/70 p-5">
        <h2 className="text-xl font-bold text-slate-900">Accounts ({accounts.length})</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-slate-500">
              <th className="px-5 py-4">Email</th>
              <th className="px-5 py-4">Name</th>
              <th className="px-5 py-4">Role</th>
              <th className="px-5 py-4">Last Active</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.map((account) => (
              <tr key={account.user_id}>
                <td className="px-5 py-4 text-sm font-medium text-slate-600">{account.email}</td>
                <td className="px-5 py-4 text-sm font-bold text-slate-900">{account.name}</td>
                <td className="px-5 py-4 text-xs font-bold uppercase text-slate-500">{account.account_type}</td>
                <td className="px-5 py-4 text-sm text-slate-500">{formatDateTime(account.last_login)}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-lg px-2 py-1 text-xs font-bold ${account.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {account.is_active ? 'Live' : 'Disabled'}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => onToggleStatus(account)} disabled={account.user_id === currentUserId} className="rounded-xl bg-slate-50 p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40">
                      {account.is_active ? <UserX size={18} /> : <UserCheck size={18} />}
                    </button>
                    <button onClick={() => onDeleteUser(account)} disabled={account.user_id === currentUserId} className="rounded-xl bg-red-50 p-2 text-red-500 transition hover:bg-red-100 disabled:opacity-40">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!accounts.length && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm font-medium text-slate-400">No accounts found for this company.</td>
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

  const handleSubmit = async (event: React.FormEvent) => {
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Create User Account</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">For {company.company_name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <input value={username} onChange={(event) => setUsername(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Employee name" required />
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="employee@company.com" required />
          <select value={type} onChange={(event) => setType(event.target.value as UserRole)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <option value={UserRole.EMPLOYEE}>Employee</option>
            <option value={UserRole.ADMIN}>Company Admin</option>
          </select>
          <div className="flex gap-2">
            <input value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Initial password" required />
            <button type="button" onClick={() => setPassword(generatePassword())} className="rounded-2xl bg-slate-100 px-4 font-bold text-slate-700">Generate</button>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} disabled={submitting} className="flex-1 rounded-2xl bg-slate-100 py-3 font-bold text-slate-600">Cancel</button>
          <button type="submit" disabled={submitting} className="flex-1 rounded-2xl bg-blue-600 py-3 font-bold text-white disabled:opacity-60">{submitting ? 'Creating...' : 'Create Account'}</button>
        </div>
      </form>
    </div>
  );
};

const CreateCompanyModal = ({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (companyName: string) => Promise<void>;
}) => {
  const [companyName, setCompanyName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(companyName);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Create Company</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Add a new company to the platform.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>
        <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Company name" required />
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} disabled={submitting} className="flex-1 rounded-2xl bg-slate-100 py-3 font-bold text-slate-600">Cancel</button>
          <button type="submit" disabled={submitting || !companyName.trim()} className="flex-1 rounded-2xl bg-blue-600 py-3 font-bold text-white disabled:opacity-60">{submitting ? 'Creating...' : 'Create Company'}</button>
        </div>
      </form>
    </div>
  );
};

const generatePassword = () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `FinSight-${suffix}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleDateString();
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
};

export default SuperAdminDashboard;
