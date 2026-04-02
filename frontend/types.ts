
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE'
}

export interface UserAccount {
  account_id: string;
  account_no: string;
  name: string;
  account_type: UserRole;
  company_id: string | null;
  is_active: boolean;
  purchase_date: string;
  last_active?: string;
}

export interface Company {
  company_id: string;
  company_name: string;
  purchase_date: string;
  is_active: boolean;
  active_account_count: number;
}

export interface UsageLog {
  log_id: string;
  account_id: string;
  session_start: string;
  session_end: string;
  duration_minutes: number;
  ip_address: string;
}

export interface Department {
  department_id: string;
  company_id: string;
  department_name: string;
  employee_account_ids: string[];
  annual_budget: number;
  is_active: boolean;
  created_at: string;
  transaction_count?: number;
}

export interface Transaction {
  transaction_id: string;
  department_id: string;
  transaction_date: string;
  amount: number;
  description: string;
  employee_name: string;
  category: 'NECESSARY' | 'OPTIONAL' | 'RISKY' | 'UNNECESSARY' | 'UNCATEGORIZED';
  flagged?: boolean;
  flag_reason?: string;
  status: 'OPEN' | 'RESOLVED';
}

export interface Permission {
  id: string;
  label: string;
  enabled: boolean;
}

export type PermissionSet = Record<string, string[]>; // dept_id -> list of permission keys
