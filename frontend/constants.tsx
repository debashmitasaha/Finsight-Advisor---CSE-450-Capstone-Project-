
import React from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Building2, 
  PieChart, 
  FileSearch, 
  Receipt, 
  Settings,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  History,
  FileText,
  Activity
} from 'lucide-react';
import { UserRole, Company, UserAccount, Department, Transaction } from './types';

export const COLORS = {
  NECESSARY: 'bg-green-100 text-green-700 border-green-200',
  OPTIONAL: 'bg-blue-100 text-blue-700 border-blue-200',
  RISKY: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  UNNECESSARY: 'bg-red-100 text-red-700 border-red-200',
  UNCATEGORIZED: 'bg-slate-100 text-slate-700 border-slate-200'
};

export const MOCK_COMPANIES: Company[] = [
  { company_id: 'COMP-001', company_name: 'Acme Corporation', purchase_date: '2025-01-15', is_active: true, active_account_count: 42 },
  { company_id: 'COMP-002', company_name: 'TechCo Industries', purchase_date: '2025-02-01', is_active: true, active_account_count: 18 },
  { company_id: 'COMP-003', company_name: 'Global Finance Ltd', purchase_date: '2024-11-10', is_active: false, active_account_count: 0 },
];

export const MOCK_ACCOUNTS: UserAccount[] = [
  { account_id: 'ACC-101', account_no: 'SA001', name: 'John Super', account_type: UserRole.SUPER_ADMIN, company_id: null, is_active: true, purchase_date: '2024-01-01' },
  { account_id: 'ACC-201', account_no: 'ADM001', name: 'Jane Admin', account_type: UserRole.ADMIN, company_id: 'COMP-001', is_active: true, purchase_date: '2025-01-15', last_active: '2025-02-10T14:30:00Z' },
  { account_id: 'ACC-301', account_no: 'EMP001', name: 'Alice Employee', account_type: UserRole.EMPLOYEE, company_id: 'COMP-001', is_active: true, purchase_date: '2025-01-20', last_active: '2025-02-09T10:15:00Z' },
  { account_id: 'ACC-302', account_no: 'EMP002', name: 'Bob Sales', account_type: UserRole.EMPLOYEE, company_id: 'COMP-001', is_active: true, purchase_date: '2025-01-22', last_active: '2025-02-10T09:00:00Z' },
  { account_id: 'ACC-303', account_no: 'EMP003', name: 'Charlie Success', account_type: UserRole.EMPLOYEE, company_id: 'COMP-001', is_active: true, purchase_date: '2025-01-25', last_active: '2025-02-08T16:45:00Z' },
  { account_id: 'ACC-304', account_no: 'EMP004', name: 'David HR', account_type: UserRole.EMPLOYEE, company_id: 'COMP-001', is_active: true, purchase_date: '2025-02-01', last_active: '2025-02-10T11:20:00Z' },
];

export const MOCK_DEPARTMENTS: Department[] = [
  { department_id: 'DEPT-001', company_id: 'COMP-001', department_name: 'Marketing', employee_account_ids: ['ACC-301'], annual_budget: 500000, is_active: true, created_at: '2025-01-16', transaction_count: 124 },
  { department_id: 'DEPT-002', company_id: 'COMP-001', department_name: 'Engineering', employee_account_ids: ['ACC-301', 'ACC-302'], annual_budget: 1200000, is_active: true, created_at: '2025-01-16', transaction_count: 89 },
  { department_id: 'DEPT-003', company_id: 'COMP-001', department_name: 'Sales', employee_account_ids: ['ACC-302'], annual_budget: 750000, is_active: true, created_at: '2025-01-20', transaction_count: 215 },
  { department_id: 'DEPT-004', company_id: 'COMP-001', department_name: 'Customer Success', employee_account_ids: ['ACC-303'], annual_budget: 300000, is_active: true, created_at: '2025-01-22', transaction_count: 62 },
  { department_id: 'DEPT-005', company_id: 'COMP-001', department_name: 'Human Resources', employee_account_ids: ['ACC-304'], annual_budget: 250000, is_active: true, created_at: '2025-01-25', transaction_count: 34 },
  { department_id: 'DEPT-006', company_id: 'COMP-001', department_name: 'Product Design', employee_account_ids: [], annual_budget: 450000, is_active: true, created_at: '2025-02-01', transaction_count: 12 },
  { department_id: 'DEPT-007', company_id: 'COMP-001', department_name: 'Legal & Compliance', employee_account_ids: [], annual_budget: 900000, is_active: true, created_at: '2025-02-05', transaction_count: 45 },
  { department_id: 'DEPT-008', company_id: 'COMP-001', department_name: 'IT Operations', employee_account_ids: [], annual_budget: 600000, is_active: true, created_at: '2025-02-10', transaction_count: 78 },
];

export const MOCK_TRANSACTIONS: Transaction[] = [
  { transaction_id: 'TXN-001', department_id: 'DEPT-001', transaction_date: '2025-02-05', amount: 1500.00, description: 'Office supplies restock', employee_name: 'Alice Employee', category: 'NECESSARY', status: 'RESOLVED' },
  { transaction_id: 'TXN-002', department_id: 'DEPT-001', transaction_date: '2025-02-06', amount: 250.50, description: 'Lunch with client', employee_name: 'Alice Employee', category: 'OPTIONAL', status: 'RESOLVED' },
  { transaction_id: 'TXN-003', department_id: 'DEPT-002', transaction_date: '2025-02-07', amount: 4500.00, description: 'Software license (unauthorized)', employee_name: 'Alice Employee', category: 'RISKY', flagged: true, flag_reason: 'Potential duplicate invoice - identical amount found in Marketing', status: 'OPEN' },
  { transaction_id: 'TXN-004', department_id: 'DEPT-003', transaction_date: '2025-02-08', amount: 12500.00, description: 'Annual SaaS Renewal', employee_name: 'Bob Sales', category: 'NECESSARY', status: 'RESOLVED' },
  { transaction_id: 'TXN-005', department_id: 'DEPT-003', transaction_date: '2025-02-09', amount: 85.00, description: 'Uber Trip - Weekend', employee_name: 'Bob Sales', category: 'RISKY', flagged: true, flag_reason: 'Weekend activity outside of business hours', status: 'OPEN' },
  { transaction_id: 'TXN-006', department_id: 'DEPT-004', transaction_date: '2025-02-09', amount: 320.00, description: 'Monitor for Home Office', employee_name: 'Charlie Success', category: 'OPTIONAL', status: 'RESOLVED' },
  { transaction_id: 'TXN-007', department_id: 'DEPT-005', transaction_date: '2025-02-10', amount: 1200.00, description: 'Recruitment Portal Ad', employee_name: 'David HR', category: 'NECESSARY', status: 'RESOLVED' },
  { transaction_id: 'TXN-008', department_id: 'DEPT-001', transaction_date: '2025-02-10', amount: 2500.00, description: 'Consultancy Fees', employee_name: 'Alice Employee', category: 'UNCATEGORIZED', status: 'OPEN' },
  { transaction_id: 'TXN-009', department_id: 'DEPT-003', transaction_date: '2025-02-10', amount: 999.00, description: 'High-end Espresso Machine', employee_name: 'Bob Sales', category: 'UNNECESSARY', flagged: true, flag_reason: 'Expense exceeds department guidelines for office perks', status: 'OPEN' },
  { transaction_id: 'TXN-010', department_id: 'DEPT-002', transaction_date: '2025-02-11', amount: 450.00, description: 'Cloud Storage Overage', employee_name: 'Bob Sales', category: 'NECESSARY', status: 'RESOLVED' },
];

export const SIDEBAR_ITEMS = {
  [UserRole.SUPER_ADMIN]: [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Companies', icon: Building2, path: '/companies' },
    { name: 'Global Settings', icon: Settings, path: '/settings' },
  ],
  [UserRole.ADMIN]: [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Employees', icon: Users, path: '/employees' },
    { name: 'Dept Control', icon: Settings, path: '/dept-control' },
    { name: 'Dept Status', icon: PieChart, path: '/dept-status' },
    { name: 'Reports', icon: FileSearch, path: '/reports' },
    { name: 'History', icon: History, path: '/history' },
    { name: 'Audit Logs', icon: Activity, path: '/audit-logs' },
  ],
  [UserRole.EMPLOYEE]: [
    { name: 'Departments', icon: PieChart, path: '/departments' },
    { name: 'Quick Analysis', icon: ShieldAlert, path: '/analysis' },
    { name: 'My History', icon: Clock, path: '/history' },
  ],
};
