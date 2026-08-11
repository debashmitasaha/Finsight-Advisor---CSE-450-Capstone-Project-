import {
  Activity,
  Building2,
  Clock3,
  Clock,
  FileSearch,
  LayoutDashboard,
  PieChart,
  Settings,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { UserRole } from './types';

export const COLORS: Record<string, string> = {
  necessary: 'bg-green-100 text-green-700 border-green-200',
  unnecessary: 'bg-red-100 text-red-700 border-red-200',
  uncategorized: 'bg-slate-100 text-slate-700 border-slate-200',
};

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
    { name: 'Forensic Lab', icon: ShieldAlert, path: '/forensic' },
    { name: 'Reports', icon: FileSearch, path: '/reports' },
    { name: 'History', icon: Clock3, path: '/history' },
    { name: 'Audit Logs', icon: Activity, path: '/audit-logs' },
  ],
  [UserRole.EMPLOYEE]: [
    { name: 'Departments', icon: PieChart, path: '/departments' },
    { name: 'Quick Analysis', icon: ShieldAlert, path: '/analysis' },
    { name: 'My History', icon: Clock, path: '/history' },
  ],
};
