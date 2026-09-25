import React, { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronLeft, Plus, RefreshCw, Trash2, UserCheck, Users, UserX, Wallet, X } from 'lucide-react';
import Layout from '../components/Layout';
import LoadingState from '../components/LoadingState';
import { InfoDot } from '../components/ForensicKit';
import { api } from '../lib/api';
import { AdminOverview, AuditLogResponse, Company, Department, UserAccount, UserRole } from '../types';

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
  const [audit, setAudit] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [departmentCompanyId, setDepartmentCompanyId] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false);
  const [showCompanyUserModal, setShowCompanyUserModal] = useState(false);
  const [showGlobalUserModal, setShowGlobalUserModal] = useState(false);
  const [showAddDepartmentModal, setShowAddDepartmentModal] = useState(false);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.company_id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  );

  const companyAccounts = useMemo(
    () => (selectedCompany ? users.filter((account) => account.company_id === selectedCompany.company_id) : []),
    [selectedCompany, users],
  );

  const companyDepartments = useMemo(
    () => (selectedCompany ? departments.filter((department) => department.company_id === selectedCompany.company_id) : []),
    [departments, selectedCompany],
  );

  const companyNameById = useMemo(() => new Map(companies.map((company) => [company.company_id, company.company_name])), [companies]);

  const companyOptions = useMemo(() => companies.map((company) => ({ value: company.company_id, label: company.company_name })), [companies]);

  const departmentActivityGroups = useMemo(() => {
    const groups = new Map<string, { companyId: string | null; companyName: string; departments: Department[] }>();

    companies.forEach((company) => {
      groups.set(company.company_id, {
        companyId: company.company_id,
        companyName: company.company_name,
        departments: [],
      });
    });

    (overview?.department_summaries || []).forEach((department) => {
      const groupKey = department.company_id || 'unassigned';
      const companyName = department.company_name || (department.company_id ? companyNameById.get(department.company_id) : null) || 'Unassigned Company';

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          companyId: department.company_id || null,
          companyName,
          departments: [],
        });
      }

      groups.get(groupKey)?.departments.push(department);
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        departments: [...group.departments].sort((left, right) => left.department_name.localeCompare(right.department_name)),
      }))
      .sort((left, right) => left.companyName.localeCompare(right.companyName));
  }, [companies, companyNameById, overview?.department_summaries]);

  // Everything below is derived from data the page already had. The dashboard
  // counted things but never said whether any of them needed attention.
  const health = useMemo(() => {
    const departmentsByCompany = new Map<string, number>();
    departments.forEach((department) => {
      const key = department.company_id || 'none';
      departmentsByCompany.set(key, (departmentsByCompany.get(key) || 0) + 1);
    });
    const summaries = overview?.department_summaries || [];
    return {
      emptyCompanies: companies.filter((company) => !departmentsByCompany.get(company.company_id)).length,
      idleDepartments: summaries.filter((department) => !department.transaction_count).length,
      neverSignedIn: users.filter((account) => !account.last_login).length,
      disabled: users.filter((account) => !account.is_active).length,
      overBudget: summaries.filter((department) => Number(department.annual_budget_utilization_pct || 0) > 100).length,
    };
  }, [companies, departments, overview?.department_summaries, users]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewData, companyData, departmentData, userData, auditData] = await Promise.all([
        api.adminOverview(),
        api.companies(),
        api.departments(),
        api.users(),
        // The operator sees every company's activity. A failure here must not
        // take the whole dashboard down with it.
        api.auditLogs({ days: 14, limit: 12 }).catch(() => null),
      ]);
      setOverview(overviewData);
      setCompanies(companyData);
      setDepartments(departmentData);
      setUsers(userData);
      setAudit(auditData);
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

  const createCompanyByName = async (name: string) => {
    try {
      const created = await api.createCompany(name.trim());
      setCompanies((current) => [...current, created]);
      setOverview((current) => current ? { ...current, companies: current.companies + 1 } : current);
      setShowAddCompanyModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create company');
    }
  };

  const createDepartmentFromPayload = async (payload: { department_name: string; annual_budget: number; company_id?: string | null }) => {
    try {
      await api.createDepartment(payload);
      setShowAddDepartmentModal(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create department');
    }
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
      setShowCompanyUserModal(false);
      setShowGlobalUserModal(false);
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

      <div>
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.2em] text-slate-400">
          Needs attention
          <InfoDot text="Derived from what is already on this page. Zero everywhere means nothing is half-configured." />
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-5">
          <HealthCard
            label="Empty companies"
            value={health.emptyCompanies}
            tip="A company with no department cannot receive a ledger, so nobody in it can do anything yet."
          />
          <HealthCard
            label="Idle departments"
            value={health.idleDepartments}
            tip="Created but never given a ledger. Harmless, but it is usually a setup step someone forgot."
          />
          <HealthCard
            label="Never signed in"
            value={health.neverSignedIn}
            tip="Accounts that exist but have never been used. Usually the generated password never reached the person."
          />
          <HealthCard
            label="Disabled accounts"
            value={health.disabled}
            tip="They keep their history but cannot sign in."
          />
          <HealthCard
            label="Over budget"
            value={health.overBudget}
            tip="Departments that have already spent more than their annual budget this year."
          />
        </div>
      </div>

      {audit && audit.entries.length > 0 && (
        <div className={cardStyle}>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            Recent activity
            <InfoDot text="The last fourteen days across every company. Reads are not recorded, only actions that changed something." />
          </h2>
          <ul className="mt-4 divide-y divide-slate-100">
            {audit.entries.slice(0, 8).map((entry) => (
              <li key={entry.log_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                <span className="font-semibold text-slate-800">{entry.action}</span>
                <span className="text-xs text-slate-400">
                  {entry.actor_email || 'unknown'} · {entry.at ? new Date(entry.at).toLocaleString() : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={cardStyle}>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Department Activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] overflow-hidden rounded-2xl border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-white">
                <th className="rounded-tl-2xl border-r border-white/40 bg-indigo-600/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur">Department</th>
                <th className=" border-r border-white/40 bg-indigo-600/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur">Budget</th>
                <th className="border-r border-white/40 bg-indigo-600/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur">Used This Year</th>
                <th className=" border-r border-white/40 bg-indigo-600/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur">Utilization</th>
                <th className="rounded-tr-2xl bg-indigo-600/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur">Transactions</th>
              </tr>
            </thead>
            <tbody>
              {departmentActivityGroups.length === 0 && (
                <tr className="border-t border-slate-100 text-sm text-slate-500">
                  <td colSpan={5} className="py-6 text-center font-semibold">No departments yet</td>
                </tr>
              )}
              {departmentActivityGroups.map((group) => (
                <React.Fragment key={group.companyId || 'unassigned'}>
                  <tr className="text-xs uppercase tracking-wider text-indigo-950">
                    <td colSpan={5} className="border-y border-white/80 bg-gradient-to-r from-indigo-100/90 via-sky-100/80 to-cyan-100/90 px-4 py-3 font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur">
                      <div className="relative flex min-h-8 items-center justify-center">
                        <span className="text-center text-base font-black tracking-[0.16em] text-indigo-950">
                          {group.companyName}
                        </span>
                        <span className="absolute right-0 rounded-full border border-white/70 bg-white/65 px-3 py-1 text-[11px] font-bold normal-case tracking-normal text-indigo-800 shadow-sm backdrop-blur">
                          {group.departments.length} {group.departments.length === 1 ? 'department' : 'departments'}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {group.departments.map((department) => (
                    <tr key={department.department_id} className="text-sm text-slate-700 transition hover:brightness-[0.98]">
                      <td className="border-b border-white/90 bg-indigo-500/10 px-4 py-3 font-semibold text-indigo-950 backdrop-blur">{department.department_name}</td>
                      <td className="border-b border-white/90 bg-emerald-500/10 px-4 py-3 font-bold text-emerald-800 backdrop-blur">TK {Number(department.annual_budget || 0).toLocaleString()}</td>
                      <td className="border-b border-white/90 bg-amber-400/20 px-4 py-3 font-bold text-amber-800 backdrop-blur">TK {Number(department.used_budget_current_year || 0).toLocaleString()}</td>
                      <td className="border-b border-white/90 bg-fuchsia-500/10 px-4 py-3 font-bold text-fuchsia-800 backdrop-blur">{Number(department.annual_budget_utilization_pct || 0).toFixed(1)}%</td>
                      <td className="border-b border-white/90 bg-cyan-500/10 px-4 py-3 font-bold text-cyan-800 backdrop-blur">{department.transaction_count || 0}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderCompanies = () => (
    <div className={cardStyle}>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-xl font-bold text-slate-900">Companies</h2>
        <button type="button" onClick={() => setShowAddCompanyModal(true)} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
          <Plus size={16} />
          Add Company
        </button>
      </div>
      <div className="space-y-3">
        {companies.map((company) => (
          <button
            key={company.company_id}
            type="button"
            onClick={() => handleCompanyClick(company)}
            className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-left transition hover:border-blue-200 hover:bg-blue-300/40"
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
  );

  const renderCompanyDetails = () => {
    if (!selectedCompany) return renderCompanies();

    return (
      <CompanyDetailView
        company={selectedCompany}
        accounts={companyAccounts}
        departments={companyDepartments}
        currentUserId={user.user_id}
        onBack={() => {
          setSelectedCompanyId(null);
          setActivePath('/companies');
        }}
        onAddUser={() => setShowCompanyUserModal(true)}
        onAddDepartment={() => {
          setDepartmentCompanyId(selectedCompany.company_id);
          setShowAddDepartmentModal(true);
        }}
        onToggleStatus={handleToggleStatus}
        onDeleteUser={handleDeleteUser}
      />
    );
  };

  const renderSettings = () => (
    <div className={cardStyle}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-slate-900">User Control</h2>
        <button type="button" onClick={() => setShowGlobalUserModal(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white transition hover:bg-blue-700">
          <Plus size={18} />
          Create New User
        </button>
      </div>
      <div className="space-y-3 max-h-[620px] overflow-auto">
        {users.map((account) => (
          <div key={account.user_id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-slate-900">{account.name}</p>
                <p className="text-sm text-slate-500">{account.email}</p>
                <p className="text-xs font-semibold text-slate-500 mt-1">
                  {account.company_id ? companyNameById.get(account.company_id) || 'Unknown Company' : 'No Company'}
                </p>
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
  );

  const content = loading
    ? <LoadingState label="Loading dashboard" />
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
      {showCompanyUserModal && selectedCompany && (
        <CreateUserModal
          company={selectedCompany}
          onClose={() => setShowCompanyUserModal(false)}
          onSubmit={(payload) => createUserFromPayload(payload)}
        />
      )}
      {showGlobalUserModal && (
        <CreateGlobalUserModal
          companyOptions={companyOptions}
          onClose={() => setShowGlobalUserModal(false)}
          onSubmit={(payload) => createUserFromPayload(payload)}
        />
      )}
      {showAddDepartmentModal && (
        <CreateDepartmentModal
          companyOptions={companyOptions}
          initialCompanyId={departmentCompanyId}
          onClose={() => setShowAddDepartmentModal(false)}
          onSubmit={(payload) => createDepartmentFromPayload(payload)}
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

const HealthCard = ({ label, value, tip }: { label: string; value: number; tip: string }) => (
  <div className={`rounded-2xl border p-5 ${value > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
    <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
      {label}
      <InfoDot text={tip} />
    </p>
    <p className={`mt-2 text-3xl font-black tabular-nums ${value > 0 ? 'text-amber-700' : 'text-slate-300'}`}>{value}</p>
  </div>
);

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
  departments,
  currentUserId,
  onBack,
  onAddUser,
  onAddDepartment,
  onToggleStatus,
  onDeleteUser,
}: {
  company: Company;
  accounts: UserAccount[];
  departments: Department[];
  currentUserId: string;
  onBack: () => void;
  onAddUser: () => void;
  onAddDepartment: () => void;
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

    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onAddDepartment} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white transition hover:bg-slate-800">
          <Plus size={18} />
          Create New Department
        </button>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/70 p-5">
          <h2 className="text-xl font-bold text-slate-900">Departments ({departments.length})</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {departments.map((department) => (
            <div key={department.department_id} className="grid grid-cols-1 gap-3 p-5 md:grid-cols-[1fr,0.7fr,0.7fr,0.5fr] md:items-center">
              <div>
                <p className="font-bold text-slate-900">{department.department_name}</p>
                <p className="mt-1 text-xs font-semibold text-slate-400">Department ID: {department.department_id}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Annual Budget</p>
                <p className="mt-1 font-bold text-emerald-700">TK {Number(department.annual_budget || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Used This Year</p>
                <p className="mt-1 font-bold text-amber-700">TK {Number(department.used_budget_current_year || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Transactions</p>
                <p className="mt-1 font-bold text-cyan-700">{department.transaction_count || 0}</p>
              </div>
            </div>
          ))}
          {!departments.length && (
            <div className="px-5 py-12 text-center text-sm font-medium text-slate-400">
              No departments found for this company.
            </div>
          )}
        </div>
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
            <button type="button" onClick={() => setPassword(generatePassword())} className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 font-bold text-slate-700 transition hover:bg-slate-200">
              <RefreshCw size={16} />
              Generate
            </button>
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

const CreateGlobalUserModal = ({
  companyOptions,
  onClose,
  onSubmit,
}: {
  companyOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
  onSubmit: (payload: { username: string; email: string; password: string; company_id?: string | null; is_admin: boolean }) => Promise<void>;
}) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [companyId, setCompanyId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        username,
        email,
        password,
        company_id: companyId || null,
        is_admin: isAdmin,
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
            <h2 className="text-2xl font-bold text-slate-900">Create User</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Add a platform or company account.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-3">
          <input value={username} onChange={(event) => setUsername(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Username" required />
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Email" required />
          <div className="flex gap-2">
            <input value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Password" required />
            <button type="button" onClick={() => setPassword(generatePassword())} className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 font-bold text-slate-700 transition hover:bg-slate-200">
              <RefreshCw size={16} />
              Generate
            </button>
          </div>
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <option value="">No company / super admin</option>
            {companyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <input type="checkbox" checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} />
            Grant admin access
          </label>
        </div>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} disabled={submitting} className="flex-1 rounded-2xl bg-slate-100 py-3 font-bold text-slate-600">Cancel</button>
          <button type="submit" disabled={submitting} className="flex-1 rounded-2xl bg-blue-600 py-3 font-bold text-white disabled:opacity-60">{submitting ? 'Creating...' : 'Create User'}</button>
        </div>
      </form>
    </div>
  );
};

const CreateDepartmentModal = ({
  companyOptions,
  initialCompanyId,
  onClose,
  onSubmit,
}: {
  companyOptions: Array<{ value: string; label: string }>;
  initialCompanyId: string;
  onClose: () => void;
  onSubmit: (payload: { department_name: string; annual_budget: number; company_id?: string | null }) => Promise<void>;
}) => {
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [departmentName, setDepartmentName] = useState('');
  const [departmentBudget, setDepartmentBudget] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        department_name: departmentName,
        annual_budget: departmentBudget === '' ? 0 : Number(departmentBudget),
        company_id: companyId || null,
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
            <h2 className="text-2xl font-bold text-slate-900">Create Department</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Add a department under a company.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-3">
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" required>
            {companyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Department name" required />
          <input value={departmentBudget} onChange={(event) => setDepartmentBudget(event.target.value)} type="number" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Annual budget" required />
        </div>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} disabled={submitting} className="flex-1 rounded-2xl bg-slate-100 py-3 font-bold text-slate-600">Cancel</button>
          <button type="submit" disabled={submitting || !companyId || !departmentName.trim()} className="flex-1 rounded-2xl bg-slate-950 py-3 font-bold text-white disabled:opacity-60">{submitting ? 'Creating...' : 'Create Department'}</button>
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
