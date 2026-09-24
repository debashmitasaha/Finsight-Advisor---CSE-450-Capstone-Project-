import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CircleDollarSign,
  Eye,
  FileUp,
  Plus,
  Radar,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Table,
  TrendingUp,
  Upload,
  WalletCards,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Layout from '../components/Layout';
import LoadingState from '../components/LoadingState';
import ForensicIntelligence from './ForensicIntelligence';
import { api } from '../lib/api';
import {
  Anomaly,
  Department,
  DepartmentTransactionSummary,
  ExpenseCategory,
  ExpenseGroupSummary,
  Forecast,
  ForecastDiagnostics,
  ForecastSourceMode,
  ForensicRunResponse,
  Transaction,
  TransactionPage,
  UploadBatchSummary,
  UserAccount,
} from '../types';
import { COLORS } from '../constants';

interface AdminDashboardProps {
  user: UserAccount;
  onLogout: () => void;
}

const shellCard = 'rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]';
type ForensicMode = 'rule' | 'engine';
type ExpenseReviewTab = 'ledger' | 'pending' | 'approved';
const MAX_ANNUAL_BUDGET = 9_999_999_999_999.99;
const LEDGER_PAGE_SIZE = 50;
const GROUP_TRANSACTION_PAGE_SIZE = 50;
const EMPLOYEE_SCOPE_OPTIONS = [
  { id: 'view_transactions', label: 'View Ledger' },
  { id: 'run_analysis', label: 'Run Analysis' },
  { id: 'view_forecasts', label: 'View Forecasts' },
  { id: 'manage_department', label: 'Dept Control' },
] as const;

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout }) => {
  const [activePath, setActivePath] = useState('/dashboard');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [departmentSummary, setDepartmentSummary] = useState<DepartmentTransactionSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [forecastHistory, setForecastHistory] = useState<{ month: string; amount: number }[]>([]);
  const [forecastDiagnostics, setForecastDiagnostics] = useState<ForecastDiagnostics | null>(null);
  const [forecastModel, setForecastModel] = useState<{ model_type: string; model_version: string } | null>(null);
  const [monthsAhead, setMonthsAhead] = useState(3);
  const [sourceMode, setSourceMode] = useState<ForecastSourceMode>('latest_batch');
  const [uploadBatches, setUploadBatches] = useState<UploadBatchSummary[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [selectedForensicBatchId, setSelectedForensicBatchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [budgetDraft, setBudgetDraft] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [groupingStats, setGroupingStats] = useState<any>(null);
  const [categorizationSummary, setCategorizationSummary] = useState<any>(null);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [expenseGroups, setExpenseGroups] = useState<ExpenseGroupSummary[]>([]);
  const [expenseReviewTab, setExpenseReviewTab] = useState<ExpenseReviewTab>('ledger');
  const [ledgerBatchFilter, setLedgerBatchFilter] = useState('all');
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const [ledgerPage, setLedgerPage] = useState<TransactionPage | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerRefreshKey, setLedgerRefreshKey] = useState(0);
  const [selectedExpenseGroup, setSelectedExpenseGroup] = useState<ExpenseGroupSummary | null>(null);
  const [groupTransactionPage, setGroupTransactionPage] = useState<TransactionPage | null>(null);
  const [groupTransactionOffset, setGroupTransactionOffset] = useState(0);
  const [groupTransactionsLoading, setGroupTransactionsLoading] = useState(false);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [employees, setEmployees] = useState<UserAccount[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [forensicFile, setForensicFile] = useState<File | null>(null);
  const [forensicMonth, setForensicMonth] = useState('2022-08');
  const [forensicResult, setForensicResult] = useState<ForensicRunResponse | null>(null);
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);
  const [forensicMode, setForensicMode] = useState<ForensicMode>('rule');
  const [status, setStatus] = useState<string | null>(null);
  const [blockingAction, setBlockingAction] = useState<{ title: string; detail: string } | null>(null);
  const [expenseGroupAction, setExpenseGroupAction] = useState<{ key: string; action: 'approve' | 'reject' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [departmentLoading, setDepartmentLoading] = useState(false);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [controlDataLoading, setControlDataLoading] = useState(false);
  const [forecastLoading, setForecastLoading] = useState(false);
  const departmentRequestRef = useRef(0);
  const forecastRequestRef = useRef(0);

  const loadBase = async () => {
    const [departmentData, userData] = await Promise.all([api.departments(), api.users()]);
    setDepartments(departmentData);
    setEmployees(userData);
    if (!selectedDeptId && departmentData[0]) {
      setSelectedDeptId(departmentData[0].department_id);
    }
  };

  const loadDepartmentData = async (departmentId: string, shouldApply = () => true) => {
    if (!departmentId) return;
    const summaryData = await api.transactionSummary(departmentId);
    if (!shouldApply()) return;
    setDepartmentSummary(summaryData);
    setCategorizationSummary(summaryData.necessity);
  };

  const loadTransactionsData = async (departmentId: string, limit = 100, shouldApply = () => true) => {
    if (!departmentId) return;
    const transactionData = await api.transactions(departmentId, { limit });
    if (!shouldApply()) return;
    setTransactions(transactionData);
  };

  const loadForensicData = async (
    departmentId: string,
    options: { uploadBatchId?: string | null; shouldApply?: () => boolean } = {},
  ) => {
    if (!departmentId) return;
    const uploadBatchId = options.uploadBatchId || null;
    const [transactionData, anomalyData, batchData] = await Promise.all([
      api.transactions(departmentId, { limit: 500, uploadBatchId }),
      api.anomalies(departmentId, uploadBatchId),
      api.uploadBatches(departmentId),
    ]);
    if (options.shouldApply && !options.shouldApply()) return;
    setTransactions(transactionData);
    setAnomalies(anomalyData);
    setUploadBatches(batchData);
  };

  const loadControlData = async (departmentId: string, shouldApply = () => true) => {
    if (!departmentId) return;
    const [groupingData, batchData, expenseCategoryData, expenseGroupData] = await Promise.all([
      api.groupingStats(departmentId),
      api.uploadBatches(departmentId),
      api.expenseCategories(departmentId),
      api.expenseGroups(departmentId),
    ]);
    if (!shouldApply()) return;
    setGroupingStats(groupingData);
    setUploadBatches(batchData);
    setExpenseCategories(expenseCategoryData);
    setExpenseGroups(expenseGroupData);
  };

  const loadForecastContext = async (departmentId: string, shouldApply = () => true) => {
    if (!departmentId || !isForecastSourceReady(sourceMode, selectedBatchId, dateFrom, dateTo)) {
      if (!shouldApply()) return;
      setForecasts([]);
      setForecastHistory([]);
      setForecastDiagnostics(null);
      setForecastModel(null);
      return;
    }

    const forecastContext = await api.forecastContext(departmentId, {
      monthsAhead,
      sourceMode,
      uploadBatchId: selectedBatchId || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    });
    if (!shouldApply()) return;
    setForecasts(forecastContext.forecasts);
    setForecastHistory(forecastContext.history);
    setForecastDiagnostics(forecastContext.diagnostics);
    setForecastModel(forecastContext.model);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadBase();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to load admin data';
        setStatus(message.includes('Authentication') ? 'Your session expired. Please log out and log in again.' : message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedDeptId) return;
    const requestId = departmentRequestRef.current + 1;
    departmentRequestRef.current = requestId;
    setDepartmentLoading(true);

    loadDepartmentData(selectedDeptId, () => departmentRequestRef.current === requestId)
      .catch((err) => setStatus(err.message))
      .finally(() => {
        if (departmentRequestRef.current === requestId) {
          setDepartmentLoading(false);
        }
      });
  }, [selectedDeptId]);

  useEffect(() => {
    if (!selectedDeptId) return;
    const requestId = forecastRequestRef.current + 1;
    forecastRequestRef.current = requestId;

    const needsForecastContext = activePath === '/dept-status' || activePath === '/reports';
    if (!needsForecastContext) {
      setForecastLoading(false);
      return;
    }

    setForecastLoading(true);

    loadForecastContext(selectedDeptId, () => forecastRequestRef.current === requestId)
      .catch((err) => setStatus(err.message))
      .finally(() => {
        if (forecastRequestRef.current === requestId) {
          setForecastLoading(false);
        }
      });
  }, [selectedDeptId, monthsAhead, sourceMode, selectedBatchId, dateFrom, dateTo, activePath]);

  useEffect(() => {
    if (!selectedDeptId) return;
    let cancelled = false;
    const departmentId = selectedDeptId;

    if (activePath === '/history' || activePath === '/audit-logs') {
      setTransactionsLoading(true);
      loadTransactionsData(departmentId, 100, () => !cancelled)
        .catch((err) => setStatus(err.message))
        .finally(() => {
          if (!cancelled) setTransactionsLoading(false);
        });
    }

    if (activePath === '/forensic' || activePath === '/forensic-engine') {
      setTransactionsLoading(true);
      loadForensicData(departmentId, { uploadBatchId: selectedForensicBatchId || null, shouldApply: () => !cancelled })
        .catch((err) => setStatus(err.message))
        .finally(() => {
          if (!cancelled) setTransactionsLoading(false);
        });
    }

    if (activePath === '/dept-control' || activePath === '/dept-status') {
      setControlDataLoading(true);
      loadControlData(departmentId, () => !cancelled)
        .catch((err) => setStatus(err.message))
        .finally(() => {
          if (!cancelled) setControlDataLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedDeptId, activePath, selectedForensicBatchId]);

  useEffect(() => {
    if (sourceMode !== 'upload_batch') {
      setSelectedBatchId('');
      return;
    }
    if (!uploadBatches.length) {
      setSelectedBatchId('');
      return;
    }
    if (!uploadBatches.some((batch) => batch.upload_batch_id === selectedBatchId)) {
      setSelectedBatchId(uploadBatches[0].upload_batch_id);
    }
  }, [sourceMode, uploadBatches, selectedBatchId]);

  const forensicReviewBatches = useMemo(
    () => uploadBatches.filter((batch) => Number(batch.transaction_count || 0) > 0),
    [uploadBatches],
  );

  useEffect(() => {
    if (!forensicReviewBatches.length) {
      setSelectedForensicBatchId('');
      return;
    }
    if (!forensicReviewBatches.some((batch) => batch.upload_batch_id === selectedForensicBatchId)) {
      setSelectedForensicBatchId(forensicReviewBatches[0].upload_batch_id);
    }
  }, [forensicReviewBatches, selectedForensicBatchId]);

  useEffect(() => {
    if (!selectedAnomaly && !selectedExpenseGroup) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedAnomaly(null);
        setSelectedExpenseGroup(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnomaly, selectedExpenseGroup]);

  useEffect(() => {
    setSelectedExpenseGroup(null);
    setGroupTransactionPage(null);
    setGroupTransactionOffset(0);
  }, [selectedDeptId]);

  useEffect(() => {
    if (!selectedDeptId || activePath !== '/dept-control' || expenseReviewTab !== 'ledger') return;
    let cancelled = false;
    setLedgerLoading(true);
    api.transactionsPage(selectedDeptId, {
      limit: LEDGER_PAGE_SIZE,
      offset: ledgerOffset,
      uploadBatchId: ledgerBatchFilter === 'all' ? null : ledgerBatchFilter,
    })
      .then((page) => {
        if (!cancelled) setLedgerPage(page);
      })
      .catch((err) => setStatus(err.message))
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDeptId, activePath, expenseReviewTab, ledgerBatchFilter, ledgerOffset, ledgerRefreshKey]);

  useEffect(() => {
    if (!selectedDeptId || !selectedExpenseGroup) return;
    let cancelled = false;
    setGroupTransactionsLoading(true);
    api.transactionsPage(selectedDeptId, {
      limit: GROUP_TRANSACTION_PAGE_SIZE,
      offset: groupTransactionOffset,
      groupNo: selectedExpenseGroup.group_no,
      chartAccHeadName: selectedExpenseGroup.group_no === null || selectedExpenseGroup.group_no === undefined
        ? selectedExpenseGroup.chart_acc_head_name
        : null,
    })
      .then((page) => {
        if (!cancelled) setGroupTransactionPage(page);
      })
      .catch((err) => setStatus(err.message))
      .finally(() => {
        if (!cancelled) setGroupTransactionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDeptId, selectedExpenseGroup, groupTransactionOffset]);

  const selectedDepartment = useMemo(
    () => departments.find((department) => department.department_id === selectedDeptId) || null,
    [departments, selectedDeptId],
  );

  useEffect(() => {
    setBudgetDraft(selectedDepartment ? String(Number(selectedDepartment.annual_budget || 0)) : '');
  }, [selectedDepartment]);

  const selectedUploadBatch = useMemo(
    () => uploadBatches.find((batch) => batch.upload_batch_id === selectedBatchId) || null,
    [uploadBatches, selectedBatchId],
  );

  const selectedForensicBatch = useMemo(
    () => forensicReviewBatches.find((batch) => batch.upload_batch_id === selectedForensicBatchId) || null,
    [forensicReviewBatches, selectedForensicBatchId],
  );

  useEffect(() => {
    if (selectedForensicBatch?.first_transaction_date) {
      setForensicMonth(selectedForensicBatch.first_transaction_date.slice(0, 7));
    }
  }, [selectedForensicBatch?.upload_batch_id]);

  const isDepartmentSwitching = departmentLoading || forecastLoading;

  const handleDepartmentSelect = (departmentId: string) => {
    if (!departmentId || departmentId === selectedDeptId) return;
    setDepartmentSummary(null);
    setTransactions([]);
    setAnomalies([]);
    setGroupingStats(null);
    setCategorizationSummary(null);
    setUploadBatches([]);
    setExpenseCategories([]);
    setExpenseGroups([]);
    setForecasts([]);
    setForecastHistory([]);
    setForecastDiagnostics(null);
    setForecastModel(null);
    setLedgerPage(null);
    setLedgerOffset(0);
    setLedgerBatchFilter('all');
    setSelectedForensicBatchId('');
    setForensicResult(null);
    setDepartmentLoading(true);
    setTransactionsLoading(activePath === '/history' || activePath === '/audit-logs' || activePath === '/forensic' || activePath === '/forensic-engine');
    setControlDataLoading(activePath === '/dept-control' || activePath === '/dept-status');
    setForecastLoading(activePath === '/dept-status' || activePath === '/reports');
    setSelectedAnomaly(null);
    setSelectedDeptId(departmentId);
  };

  const transactionById = useMemo(() => {
    return new Map(transactions.map((transaction) => [transaction.transaction_id, transaction]));
  }, [transactions]);

  const activeAnomalies = useMemo(
    () => anomalies.filter((anomaly) => {
      if (anomaly.is_resolved || !selectedForensicBatchId) return false;
      const transactionUploadBatchId = transactionById.get(anomaly.transaction_id)?.upload_batch_id || null;
      const evidenceUploadBatchId = typeof anomaly.evidence_snapshot?.upload_batch_id === 'string'
        ? anomaly.evidence_snapshot.upload_batch_id
        : null;
      return transactionUploadBatchId === selectedForensicBatchId || evidenceUploadBatchId === selectedForensicBatchId;
    }),
    [anomalies, selectedForensicBatchId, transactionById],
  );

  const activeAnomalyCount = departmentSummary?.active_anomaly_count ?? activeAnomalies.length;

  const anomalyCounts = useMemo(() => {
    return activeAnomalies.reduce(
      (counts, anomaly) => {
        const key = anomaly.anomaly_type.toLowerCase();
        if (key.includes('benford')) counts.benford += 1;
        if (key.includes('zscore')) counts.zscore += 1;
        if (key.includes('rsf')) counts.rsf += 1;
        return counts;
      },
      { benford: 0, zscore: 0, rsf: 0 },
    );
  }, [activeAnomalies]);

  const currentForensicResult = useMemo(() => {
    if (!forensicResult) return null;
    if (forensicResult.upload_batch_id && forensicResult.upload_batch_id !== selectedForensicBatchId) return null;
    return forensicResult;
  }, [forensicResult, selectedForensicBatchId]);

  const flaggedRows = useMemo(() => {
    const rows = new Map<string, { transaction: Transaction | null; anomalies: Anomaly[] }>();
    activeAnomalies.forEach((anomaly) => {
      const existing = rows.get(anomaly.transaction_id) || {
        transaction: transactionById.get(anomaly.transaction_id) || null,
        anomalies: [],
      };
      existing.anomalies.push(anomaly);
      rows.set(anomaly.transaction_id, existing);
    });
    return Array.from(rows.values());
  }, [activeAnomalies, transactionById]);

  const parseForensicMonth = () => {
    const [year, month] = forensicMonth.split('-').map(Number);
    return { month, year };
  };

  const runForensicAnalysis = async () => {
    if (!selectedDeptId) return;
    if (!selectedForensicBatchId) {
      setStatus('Choose an uploaded transaction file before running forensic scan.');
      return;
    }
    const { month, year } = parseForensicMonth();
    const batchLabel = selectedForensicBatch?.source_file_name || 'selected file';
    try {
      setStatus(`Running forensic scan for ${batchLabel} in ${formatMonthLabel(`${year}-${String(month).padStart(2, '0')}`)}...`);
      const result = await api.runForensic(selectedDeptId, month, year, selectedForensicBatchId);
      setForensicResult(result);
      await loadDepartmentData(selectedDeptId);
      await loadForensicData(selectedDeptId, { uploadBatchId: selectedForensicBatchId });

      if (result.message) {
        setStatus(`${result.message} in ${batchLabel}.`);
        return;
      }

      const groupingNote = result.grouping
        ? ` Grouping refreshed ${result.grouping.groups_assigned} transactions (${result.grouping.new_groups_created} new groups).`
        : '';
      setStatus(
        `Forensic completed for ${batchLabel}: ${result.total_anomalies} anomalies found ` +
        `(Benford: ${result.benford_anomalies || 0}, Z-score: ${result.zscore_anomalies || 0}, RSF: ${result.rsf_anomalies || 0}).` +
        groupingNote
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Unable to run forensic scan.');
    }
  };

  const handleForensicUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDeptId) {
      setStatus('Choose a department before uploading forensic data.');
      return;
    }
    if (!forensicFile) {
      setStatus('Choose a ledger file before uploading.');
      return;
    }
    try {
      setStatus('Uploading monthly forensic ledger...');
      const upload = await api.uploadTransactions(selectedDeptId, forensicFile);
      await loadDepartmentData(selectedDeptId);
      await loadForensicData(selectedDeptId, { uploadBatchId: selectedForensicBatchId });
      setSelectedForensicBatchId(upload.upload_batch_id);
      setStatus('Monthly transaction data uploaded. This file is selected for forensic review.');
      setForensicFile(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Unable to upload forensic data.');
    }
  };

  const handleUndoAnomaly = async (anomalyId: string) => {
    try {
      await api.resolveAnomaly(anomalyId);
      await loadDepartmentData(selectedDeptId);
      await loadForensicData(selectedDeptId, { uploadBatchId: selectedForensicBatchId });
      if (selectedAnomaly?.anomaly_id === anomalyId) setSelectedAnomaly(null);
      setStatus('Anomaly flag undone.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Unable to undo anomaly flag.');
    }
  };

  const handleBudgetUpdate = async () => {
    if (!selectedDepartment) return;
    const nextBudget = Number(budgetDraft);
    if (Number.isNaN(nextBudget) || nextBudget < 0) {
      setStatus('Please enter a valid annual budget.');
      return;
    }
    if (nextBudget > MAX_ANNUAL_BUDGET) {
      setStatus('Annual budget is too large. Please enter a value below 10,000,000,000,000.');
      return;
    }

    setSavingBudget(true);
    setStatus('Updating annual budget...');
    try {
      const updatedDepartment = await api.updateDepartmentBudget(selectedDepartment.department_id, nextBudget);
      setDepartments((current) =>
        current.map((department) =>
          department.department_id === updatedDepartment.department_id ? updatedDepartment : department,
        ),
      );
      setBudgetDraft(String(Number(updatedDepartment.annual_budget || 0)));
      setStatus('Annual budget updated.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update annual budget');
    } finally {
      setSavingBudget(false);
    }
  };

  const handleUpdateEmployeeScopes = async (userId: string, permissionsByDepartment: Record<string, string[]>) => {
    const employee = employees.find((item) => item.user_id === userId);
    const existingDepartmentIds = employee?.departments.map((role) => role.department_id) || [];
    const targetDepartmentIds = Object.keys(permissionsByDepartment);
    const departmentIds = Array.from(new Set([...existingDepartmentIds, ...targetDepartmentIds]));

    setStatus('Updating employee access...');
    try {
      await Promise.all(
        departmentIds.map((departmentId) =>
          api.assignRole(userId, departmentId, permissionsByDepartment[departmentId] || []),
        ),
      );
      const refreshedUsers = await api.users();
      setEmployees(refreshedUsers);
      setStatus('Employee access updated.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update employee access');
      throw error;
    }
  };

  const triggerAction = async (action: 'group' | 'categorize' | 'expense' | 'forecast') => {
    if (!selectedDeptId) return;
    const blockingCopy: Record<'group' | 'expense', { title: string; detail: string }> = {
      group: {
        title: 'Running Grouping',
        detail: 'Assigning group IDs to the department ledger transactions.',
      },
      expense: {
        title: 'Suggesting Expense Categories',
        detail: 'Processing every eligible group in batches and saving review items.',
      },
    };
    const shouldBlock = action === 'group' || action === 'expense';
    if (shouldBlock) setBlockingAction(blockingCopy[action]);
    setStatus(`Running ${action}...`);
    try {
      if (action === 'group') await api.runGrouping(selectedDeptId);
      if (action === 'categorize') await api.runCategorization(selectedDeptId);
      if (action === 'expense') {
        const result = await api.runExpenseCategorization(selectedDeptId);
        setExpenseGroups(result.groups);
        await loadDepartmentData(selectedDeptId);
        await loadControlData(selectedDeptId);
        setStatus(`${result.suggested_count} expense category suggestion${result.suggested_count === 1 ? '' : 's'} ready for review.`);
        return;
      }
      if (action === 'forecast') {
        if (!isForecastSourceReady(sourceMode, selectedBatchId, dateFrom, dateTo)) {
          setStatus(sourceMode === 'upload_batch' ? 'Select an upload batch first.' : 'Choose both start and end dates first.');
          return;
        }
        const result = await api.runForecast(selectedDeptId, {
          monthsAhead,
          sourceMode,
          uploadBatchId: selectedBatchId || null,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        });
        setForecasts(result.forecasts);
        setForecastHistory(result.history);
        setForecastDiagnostics(result.diagnostics);
        setForecastModel(result.model);
        setStatus('Budget forecast updated successfully.');
        return;
      }
      
      await loadDepartmentData(selectedDeptId);
      if (action === 'group' || action === 'categorize') {
        await loadControlData(selectedDeptId);
      }
      setStatus(`${action} completed successfully.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Unable to run ${action}.`);
    } finally {
      if (shouldBlock) setBlockingAction(null);
    }
  };

  const handleViewExpenseGroupTransactions = (group: ExpenseGroupSummary) => {
    setSelectedExpenseGroup(group);
    setGroupTransactionOffset(0);
    setGroupTransactionPage(null);
  };

  const handleApproveExpenseGroup = async (group: ExpenseGroupSummary) => {
    if (!selectedDeptId) return;
    const key = expenseGroupKey(group);
    const categoryName = categoryDrafts[key] || group.suggested_category_name || group.expense_category_name;
    if (!categoryName) {
      setStatus('Choose a category before approving this group.');
      return;
    }

    setStatus('Approving expense category...');
    setExpenseGroupAction({ key, action: 'approve' });
    try {
      await api.approveExpenseGroup({
        dept_id: selectedDeptId,
        group_no: group.group_no,
        chart_acc_head_name: group.chart_acc_head_name,
        category_name: categoryName,
      });
      await loadDepartmentData(selectedDeptId);
      await loadControlData(selectedDeptId);
      setStatus('Expense category approved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to approve expense category.');
    } finally {
      setExpenseGroupAction(null);
    }
  };

  const handleRejectExpenseGroup = async (group: ExpenseGroupSummary) => {
    if (!selectedDeptId) return;
    const key = expenseGroupKey(group);
    setStatus('Rejecting expense category suggestion...');
    setExpenseGroupAction({ key, action: 'reject' });
    try {
      await api.rejectExpenseGroup({
        dept_id: selectedDeptId,
        group_no: group.group_no,
        chart_acc_head_name: group.chart_acc_head_name,
      });
      await loadDepartmentData(selectedDeptId);
      await loadControlData(selectedDeptId);
      setStatus('Expense category suggestion rejected.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to reject expense category suggestion.');
    } finally {
      setExpenseGroupAction(null);
    }
  };

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDeptId || !file) return;
    setBlockingAction({
      title: 'Uploading Ledger',
      detail: 'Reading the file, checking for previous uploads, and saving valid rows.',
    });
    setStatus('Uploading transactions...');
    try {
      await api.uploadTransactions(selectedDeptId, file);
      await loadDepartmentData(selectedDeptId);
      await loadControlData(selectedDeptId);
      setExpenseReviewTab('ledger');
      setLedgerOffset(0);
      setLedgerBatchFilter('all');
      setLedgerRefreshKey((current) => current + 1);
      setStatus('Upload complete.');
      setFile(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to upload transactions.');
    } finally {
      setBlockingAction(null);
    }
  };

  const actualSpend = useMemo(
    () => Number(departmentSummary?.total_spend || 0),
    [departmentSummary],
  );

  const expenseCategoryBreakdown = useMemo(() => {
    return departmentSummary?.expense_category_breakdown || [];
  }, [departmentSummary]);

  const spendTrend = useMemo(() => {
    return (departmentSummary?.spend_trend || []).map((point) => ({
      month: formatShortMonth(point.month),
      actual: Math.round(point.amount),
    }));
  }, [departmentSummary]);

  const forecastChartData = useMemo(() => {
    const history = (forecastHistory.length
      ? forecastHistory
      : spendTrend.map((point) => ({ month: point.month, amount: point.actual }))).slice(-6);
    const chronologicalForecasts = [...forecasts].sort((left, right) =>
      left.forecast_period_start.localeCompare(right.forecast_period_start),
    );

    const historical = history.map((point) => ({
      month: formatShortMonth(point.month),
      actual: Math.round(point.amount),
      forecast: null as number | null,
      lower: null as number | null,
      upper: null as number | null,
    }));

    const future = chronologicalForecasts.map((forecast) => ({
      month: formatShortMonth(forecast.forecast_period_start.slice(0, 7)),
      actual: null as number | null,
      forecast: Math.round(forecast.predicted_amount),
      lower: Math.round(forecast.lower_bound),
      upper: Math.round(forecast.upper_bound),
    }));

    return [...historical, ...future];
  }, [forecastHistory, forecasts, spendTrend]);

  const departmentBudgetData = useMemo(() => {
    return departments.map((department) => ({
      name: department.department_name.split(' ').slice(0, 2).join(' '),
      budget: Number(department.annual_budget || 0),
      spend: department.department_id === selectedDeptId ? Math.round(actualSpend) : Math.round(Number(department.annual_budget || 0) * 0.58),
    }));
  }, [departments, selectedDeptId, actualSpend]);

  const latestForecasts = useMemo(
    () => [...forecasts].sort((left, right) => right.forecast_period_start.localeCompare(left.forecast_period_start)),
    [forecasts],
  );

  const sourceModeLabel = useMemo(
    () => formatForecastSourceMode(sourceMode),
    [sourceMode],
  );

  const transactionCount = departmentSummary?.transaction_count || 0;
  const hasTransactions = transactionCount > 0;
  const hasGroups = Number(groupingStats?.total_groups || 0) > 0;
  const categorizedTotal = Number(categorizationSummary?.necessary || 0) + Number(categorizationSummary?.unnecessary || 0);
  const categorizationCoverage = transactionCount > 0 ? Math.round((categorizedTotal / transactionCount) * 100) : 0;
  const pendingExpenseReviews = expenseGroups.filter((group) => group.expense_category_status === 'pending_review').length;
  const pendingExpenseGroups = useMemo(
    () => expenseGroups.filter((group) => group.expense_category_status === 'pending_review'),
    [expenseGroups],
  );
  const approvedExpenseGroups = useMemo(
    () => expenseGroups.filter((group) => group.expense_category_status === 'approved'),
    [expenseGroups],
  );
  const visibleExpenseGroups = expenseReviewTab === 'pending' ? pendingExpenseGroups : approvedExpenseGroups;
  const ledgerBatchesWithTransactions = uploadBatches.filter((batch) => batch.transaction_count > 0);
  const duplicateOnlyBatches = uploadBatches.filter((batch) => batch.row_count > 0 && batch.transaction_count === 0);
  const ledgerRows = ledgerPage?.items || [];
  const ledgerTotal = ledgerPage?.total || 0;
  const ledgerStart = ledgerTotal > 0 ? ledgerOffset + 1 : 0;
  const ledgerEnd = Math.min(ledgerOffset + LEDGER_PAGE_SIZE, ledgerTotal);
  const forecastReady = forecasts.length > 0;
  const budgetUtilization = Number(selectedDepartment?.annual_budget_utilization_pct || 0);
  const latestTransactionLabel = departmentSummary?.latest_transaction_date
    ? formatDate(departmentSummary.latest_transaction_date)
    : 'No transactions yet';
  const dataReadiness = [
    {
      label: 'Transactions',
      value: hasTransactions ? `${transactionCount.toLocaleString()} rows` : 'Missing',
      state: hasTransactions ? 'ready' : 'missing',
    },
    {
      label: 'Grouping',
      value: hasGroups ? `${Number(groupingStats?.total_groups || 0).toLocaleString()} groups` : 'Not run',
      state: hasGroups ? 'ready' : 'missing',
    },
    {
      label: 'Categorization',
      value: categorizationCoverage ? `${categorizationCoverage}% covered` : 'Not run',
      state: categorizationCoverage >= 80 ? 'ready' : categorizationCoverage > 0 ? 'warning' : 'missing',
    },
    {
      label: 'Forecast',
      value: forecastReady ? `${forecasts.length} entries` : 'Pending',
      state: forecastReady ? 'ready' : 'missing',
    },
  ] as const;

  const overview = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Executive Command"
        title={selectedDepartment ? `${selectedDepartment.department_name} Intelligence` : 'Executive Intelligence'}
        description="A sharper operational workspace for budget oversight, forecast confidence, and risk visibility."
        actionContent={
          <DepartmentPicker
            departments={departments}
            selectedId={selectedDeptId}
            onSelect={handleDepartmentSelect}
            isLoading={isDepartmentSwitching}
          />
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <ExecutiveMetric
          label="Unit Ledger Items"
          value={transactionCount}
          note={selectedDepartment ? selectedDepartment.department_name : 'Department selected'}
          accent="positive"
          icon={WalletCards}
          isLoading={departmentLoading}
        />
        <ExecutiveMetric
          label="Actual Spending"
          value={`TK ${actualSpend.toLocaleString()}`}
          note="Current imported spend"
          accent="negative"
          icon={CircleDollarSign}
          isLoading={departmentLoading}
        />
        <ExecutiveMetric
          label="Monthly Budget"
          value={`TK ${Math.round(Number(selectedDepartment?.annual_budget || 0) / 12).toLocaleString()}`}
          note="Based on annual allocation"
          accent="neutral"
          icon={TrendingUp}
          isLoading={departmentLoading}
        />
        <ExecutiveMetric
          label="Data Integrity"
          value={`${Math.max(88, 100 - activeAnomalyCount * 2.1).toFixed(1)}%`}
          note={`${activeAnomalyCount} active anomalies`}
          accent="positive"
          icon={ShieldCheck}
          isLoading={departmentLoading}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr,0.65fr] gap-6">
        <div className={`${shellCard} p-7`}>
          <SectionKicker title="Spending Momentum" subtitle="Recent monthly spend for the selected department." />
          <div className="h-[340px] mt-6">
            {departmentLoading ? (
              <ChartLoadingState label="Loading department spend" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spendTrend}>
                  <defs>
                    <linearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke="#dbe7ff" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 700 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: 20, borderColor: '#dbeafe', boxShadow: '0 12px 40px rgba(59,130,246,0.14)' }} />
                  <Area type="monotone" dataKey="actual" stroke="#3B82F6" strokeWidth={4} fill="url(#spendArea)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className={`${shellCard} p-7`}>
          <SectionKicker title="Department Snapshot" subtitle="Current data, budget, and risk state." />
          <div className="mt-6 space-y-3">
            <DataPill label="Selected" value={selectedDepartment?.department_name || 'None'} isLoading={departmentLoading} />
            <DataPill label="Latest Entry" value={latestTransactionLabel} isLoading={departmentLoading} />
            <DataPill label="Budget Used" value={`${budgetUtilization.toFixed(1)}%`} isLoading={departmentLoading} />
            <DataPill label="Uncategorized" value={categorizationSummary?.uncategorized || 0} isLoading={departmentLoading} />
          </div>
        </div>
      </div>

      <div className={`${shellCard} p-7`}>
        <SectionKicker title="Spend Mix" subtitle="Top approved expense categories by amount." />
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {departmentLoading ? (
            <>
              <SkeletonLine className="h-20 rounded-2xl" />
              <SkeletonLine className="h-20 rounded-2xl" />
              <SkeletonLine className="h-20 rounded-2xl" />
              <SkeletonLine className="h-20 rounded-2xl" />
            </>
          ) : expenseCategoryBreakdown.slice(0, 4).map((category) => (
            <div key={category.name} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{category.name}</p>
              <p className="mt-2 text-lg font-black text-slate-950">TK {Math.round(category.amount).toLocaleString()}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">{category.count} transaction{category.count === 1 ? '' : 's'}</p>
            </div>
          ))}
          {!departmentLoading && !expenseCategoryBreakdown.length && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-center text-sm font-semibold text-slate-400">
              No approved spend mix available yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const expenseCategoryReview = (
    <div className={`${shellCard} p-7`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <SectionKicker title="Gemini Suggestions Approval" subtitle="Review pending suggestions and approved categorization decisions." />
        <div className="grid grid-cols-3 gap-3 text-right">
          <DataPill label="Groups" value={expenseGroups.length} isLoading={controlDataLoading} />
          <DataPill label="Pending" value={pendingExpenseGroups.length} isLoading={controlDataLoading} />
          <DataPill label="Approved" value={approvedExpenseGroups.length} isLoading={controlDataLoading} />
        </div>
      </div>

      <div className="mt-6 inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
        {[
          { id: 'ledger' as const, label: 'Uploaded Ledger', count: uploadBatches.length },
          { id: 'pending' as const, label: 'Pending Approval', count: pendingExpenseGroups.length },
          { id: 'approved' as const, label: 'Approved', count: approvedExpenseGroups.length },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setExpenseReviewTab(tab.id)}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${expenseReviewTab === tab.id ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {expenseReviewTab === 'ledger' ? (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <DataPill label="Uploads" value={uploadBatches.length} isLoading={controlDataLoading} />
            <DataPill label="Viewable Files" value={ledgerBatchesWithTransactions.length} isLoading={controlDataLoading} />
            <DataPill label="Skipped Duplicates" value={duplicateOnlyBatches.length} isLoading={controlDataLoading} />
          </div>

          <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Ledger Scope</p>
                <p className="mt-2 text-xl font-black text-slate-950">View transactions from all files or one upload.</p>
              </div>
              <div className="w-full lg:w-96">
                <label className="block text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Uploaded File</label>
                <select
                  value={ledgerBatchFilter}
                  onChange={(event) => {
                    setLedgerBatchFilter(event.target.value);
                    setLedgerOffset(0);
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700"
                >
                  <option value="all">All uploads with saved transactions</option>
                  {ledgerBatchesWithTransactions.map((batch) => (
                    <option key={batch.upload_batch_id} value={batch.upload_batch_id}>
                      {batch.source_file_name} ({batch.transaction_count} rows)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[940px] text-left">
                <thead className="bg-slate-50">
                  <tr className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                    <th className="px-5 py-4">File</th>
                    <th className="px-5 py-4">Uploaded</th>
                    <th className="px-5 py-4">Rows</th>
                    <th className="px-5 py-4">Saved</th>
                    <th className="px-5 py-4">Date Range</th>
                    <th className="px-5 py-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {controlDataLoading ? (
                    <tr><td colSpan={6} className="px-5 py-6"><SkeletonLine className="h-5 w-full" /></td></tr>
                  ) : uploadBatches.map((batch) => {
                    const duplicateOnly = batch.row_count > 0 && batch.transaction_count === 0;
                    return (
                      <tr key={batch.upload_batch_id} className="border-t border-slate-100 text-sm text-slate-700">
                        <td className="px-5 py-4 font-black text-slate-950">{batch.source_file_name}</td>
                        <td className="px-5 py-4 font-semibold text-slate-500">{formatDateTime(batch.uploaded_at)}</td>
                        <td className="px-5 py-4 font-bold">{batch.row_count}</td>
                        <td className="px-5 py-4 font-bold text-blue-700">{batch.transaction_count}</td>
                        <td className="px-5 py-4 font-semibold text-slate-500">
                          {batch.first_transaction_date || 'N/A'} to {batch.last_transaction_date || 'N/A'}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${duplicateOnly ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                            {duplicateOnly ? 'Skipped duplicate upload' : batch.status.replaceAll('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!controlDataLoading && !uploadBatches.length && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-sm font-semibold text-slate-400">No uploaded ledger files yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-x-auto rounded-[26px] border border-slate-200">
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-slate-50">
                <tr className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                  <th className="px-5 py-4">Date</th>
                  <th className="px-5 py-4">Description</th>
                  <th className="px-5 py-4">Amount</th>
                  <th className="px-5 py-4">Group</th>
                  <th className="px-5 py-4">Expense Type</th>
                  <th className="px-5 py-4">Necessity</th>
                  <th className="px-5 py-4">Source File</th>
                </tr>
              </thead>
              <tbody>
                {ledgerLoading ? (
                  <tr><td colSpan={7} className="px-5 py-8"><SkeletonLine className="h-5 w-full" /></td></tr>
                ) : ledgerRows.map((transaction) => (
                  <tr key={transaction.transaction_id} className="border-t border-slate-100 text-sm text-slate-700">
                    <td className="px-5 py-4 font-semibold">{formatDate(transaction.transaction_date)}</td>
                    <td className="px-5 py-4">
                      <p className="font-bold text-slate-900">{transaction.description || 'No description'}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">{transaction.chart_acc_head || transaction.cleaned_chart_acc_head || 'No account head'}</p>
                    </td>
                    <td className="px-5 py-4 font-bold">TK {Number(transaction.amount || 0).toLocaleString()}</td>
                    <td className="px-5 py-4">{transaction.group_name || 'Not grouped'}</td>
                    <td className="px-5 py-4">{transaction.expense_category_name || 'Unassigned'}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold border ${COLORS[transaction.category || 'uncategorized'] || COLORS.uncategorized}`}>
                        {transaction.category || 'uncategorized'}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-500">{transaction.source_file_name || 'N/A'}</td>
                  </tr>
                ))}
                {!ledgerLoading && !ledgerRows.length && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm font-semibold text-slate-400">
                      No transactions found for this ledger selection.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-slate-500">
                Showing {ledgerStart}-{ledgerEnd} of {ledgerTotal}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLedgerOffset((current) => Math.max(0, current - LEDGER_PAGE_SIZE))}
                  disabled={ledgerLoading || ledgerOffset === 0}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setLedgerOffset((current) => current + LEDGER_PAGE_SIZE)}
                  disabled={ledgerLoading || ledgerEnd >= ledgerTotal}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div className="mt-5 overflow-x-auto rounded-[26px] border border-slate-200">
        <table className="w-full min-w-[920px] text-left">
          <thead className="bg-slate-50">
            <tr className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
              <th className="px-5 py-4">Group</th>
              <th className="px-5 py-4">Samples</th>
              <th className="px-5 py-4">{expenseReviewTab === 'pending' ? 'Gemini Suggestion' : 'Approved Category'}</th>
              {expenseReviewTab === 'pending' && <th className="px-5 py-4">Approve As</th>}
              <th className="px-5 py-4">{expenseReviewTab === 'pending' ? 'Action' : 'Status'}</th>
            </tr>
          </thead>
          <tbody>
            {controlDataLoading ? (
              <tr className="border-t border-slate-100">
                <td colSpan={expenseReviewTab === 'pending' ? 5 : 4} className="px-5 py-8">
                  <div className="space-y-3">
                    <SkeletonLine className="h-5 w-48" />
                    <SkeletonLine className="h-4 w-full" />
                    <SkeletonLine className="h-4 w-3/4" />
                  </div>
                </td>
              </tr>
            ) : visibleExpenseGroups.map((group) => {
              const key = expenseGroupKey(group);
              const selectedCategory = categoryDrafts[key] ?? group.suggested_category_name ?? group.expense_category_name ?? '';
              const suggestionAlreadyInCatalog = expenseCategories.some((category) => category.name === group.suggested_category_name);
              const isApprovingGroup = expenseGroupAction?.key === key && expenseGroupAction.action === 'approve';
              const isRejectingGroup = expenseGroupAction?.key === key && expenseGroupAction.action === 'reject';
              const isGroupActionBusy = expenseGroupAction?.key === key;
              return (
                <tr key={key} className="border-t border-slate-100 align-top text-sm text-slate-700">
                  <td className="px-5 py-4">
                    <p className="font-black text-slate-950">{group.group_name || `Group ${group.group_no || ''}`}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{group.chart_acc_head_name}</p>
                    <span className={`mt-3 inline-block rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${expenseStatusClass(group.expense_category_status)}`}>
                      {group.expense_category_status.replaceAll('_', ' ')}
                    </span>
	                  </td>
	                  <td className="px-5 py-4">
	                    <button
	                      type="button"
	                      onClick={() => handleViewExpenseGroupTransactions(group)}
	                      className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-blue-700 transition hover:border-blue-200 hover:bg-blue-100"
	                    >
	                      <Eye size={14} />
	                      {group.transaction_count} transaction{group.transaction_count === 1 ? '' : 's'}
	                    </button>
	                    <div className="space-y-2">
                      {group.samples.slice(0, 3).map((sample, index) => (
                        <p key={`${key}-sample-${index}`} className="line-clamp-2 text-xs font-semibold leading-5 text-slate-600">
                          {sample.description || sample.chart_acc_head || 'No description'} · TK {Number(sample.amount || 0).toLocaleString()}
                        </p>
                      ))}
                      {!group.samples.length && <p className="text-xs font-semibold text-slate-400">No samples available.</p>}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <p className="font-black text-slate-950">{group.suggested_category_name || group.expense_category_name || 'Not suggested'}</p>
                    {group.suggested_category_confidence !== null && (
                      <p className="mt-1 text-xs font-bold text-blue-600">{Math.round(group.suggested_category_confidence * 100)}% confidence</p>
                    )}
                    {group.suggested_category_is_new && (
                      <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">New category needs approval</p>
                    )}
                    {group.suggested_category_reason && <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">{group.suggested_category_reason}</p>}
                  </td>
                  {expenseReviewTab === 'pending' && (
                    <td className="px-5 py-4">
                      <select
                        value={selectedCategory}
                        onChange={(event) => setCategoryDrafts((current) => ({ ...current, [key]: event.target.value }))}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                        aria-label="Approve expense category"
                      >
                        <option value="">Choose category</option>
                        {group.suggested_category_name && !suggestionAlreadyInCatalog && (
                          <option value={group.suggested_category_name}>{group.suggested_category_name} (new)</option>
                        )}
                        {expenseCategories.map((category) => (
                          <option key={category.category_id} value={category.name}>{category.name}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="px-5 py-4">
                    {expenseReviewTab === 'pending' ? (
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => handleApproveExpenseGroup(group)}
                          disabled={!selectedCategory || isGroupActionBusy}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-xs font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {isApprovingGroup ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Check size={15} />}
                          {isApprovingGroup ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectExpenseGroup(group)}
                          disabled={isGroupActionBusy}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-xs font-black text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRejectingGroup ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" /> : <X size={15} />}
                          {isRejectingGroup ? 'Rejecting...' : 'Reject'}
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                        Approved
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!controlDataLoading && !visibleExpenseGroups.length && (
          <div className="p-8 text-center">
            <p className="font-black text-slate-950">
              {expenseReviewTab === 'pending' ? 'No pending approvals' : 'No approved suggestions yet'}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {expenseReviewTab === 'pending'
                ? 'Run expense category suggestions to create pending decisions.'
                : 'Approved Gemini categorization decisions will appear here.'}
            </p>
          </div>
        )}
      </div>
      )}
      {expenseReviewTab === 'approved' && (
        <div className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Approved Spend Mix</p>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {expenseCategoryBreakdown.slice(0, 8).map((category) => (
              <div key={category.name} className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-slate-950">{category.name}</p>
                  <p className="text-sm font-black text-slate-700">TK {Math.round(category.amount).toLocaleString()}</p>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-500">{category.count} transaction{category.count === 1 ? '' : 's'}</p>
              </div>
            ))}
            {!expenseCategoryBreakdown.length && <p className="text-sm font-semibold text-slate-500">Approved expense categories will appear here.</p>}
          </div>
        </div>
      )}
    </div>
  );

  const deptControl = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Department Control"
        title="Department Operations"
        description="Manage department data, refresh forecasts, and keep financial operations up to date."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={`${shellCard} p-5`}>
          <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Department</label>
          <DepartmentPicker
            departments={departments}
            selectedId={selectedDeptId}
            onSelect={handleDepartmentSelect}
            isLoading={isDepartmentSwitching}
          />
        </div>
        <div className={`${shellCard} p-5`}>
          <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Annual Budget</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              inputMode="decimal"
              value={budgetDraft}
              onChange={(event) => setBudgetDraft(event.target.value.replace(/[^\d.]/g, ''))}
              className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700"
              placeholder="Annual budget"
            />
            <button
              type="button"
              onClick={handleBudgetUpdate}
              disabled={!selectedDepartment || savingBudget}
              className="rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {savingBudget ? 'Updating...' : 'Update'}
            </button>
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-500">
            Used this year: TK {Number(selectedDepartment?.used_budget_current_year || 0).toLocaleString()} ({Number(selectedDepartment?.annual_budget_utilization_pct || 0).toFixed(1)}%)
          </p>
        </div>
      </div>

      <form className={`${shellCard} p-7 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_45%),white]`} onSubmit={handleUpload}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr,220px] lg:items-stretch">
          <label className="block rounded-[26px] border border-dashed border-blue-200 bg-blue-50/70 p-6 cursor-pointer transition hover:border-blue-400 hover:bg-blue-50">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
                <Upload size={22} />
              </div>
              <div>
                <p className="font-bold text-slate-900">{file ? file.name : 'Drop CSV or Excel ledger here'}</p>
                <p className="text-sm text-slate-500 mt-1">Accepted formats: `.csv`, `.xls`, `.xlsx`</p>
              </div>
            </div>
            <input type="file" accept=".csv,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" />
          </label>
          <button className="inline-flex h-full min-h-[92px] w-full items-center justify-center gap-2 rounded-[26px] bg-slate-950 px-5 py-4 font-bold text-white shadow-[0_20px_40px_rgba(15,23,42,0.15)] transition hover:bg-slate-800">
            <FileUp size={18} />
            Upload Transactions
          </button>
        </div>
      </form>

      <div className={`${shellCard} p-7 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.16),_transparent_40%),white]`}>
          <SectionKicker title="Run Department Actions" subtitle="Run department actions in order." />
          <div className="mt-6 grid grid-cols-1 gap-4">
            <WorkflowStep
              step="1"
              title="Run Grouping"
              detail={hasTransactions ? `${transactionCount.toLocaleString()} transactions available` : 'Upload transactions first'}
              status={hasGroups ? 'Done' : hasTransactions ? 'Ready' : 'Needs upload'}
              icon={BarChart3}
              disabled={!hasTransactions || controlDataLoading}
              onClick={() => triggerAction('group')}
            />
            <WorkflowStep
              step="2"
              title="Suggest Expense Categories"
              detail={hasGroups ? `${Number(groupingStats?.total_groups || 0).toLocaleString()} groups ready` : 'Run grouping first'}
              status={pendingExpenseReviews ? `${pendingExpenseReviews} pending` : hasGroups ? 'Ready' : 'Waiting'}
              icon={Sparkles}
              disabled={!hasGroups || controlDataLoading}
              onClick={() => triggerAction('expense')}
            />
            <WorkflowStep
              step="3"
              title="Run Necessity Categorization"
              detail={categorizationCoverage ? `${categorizationCoverage}% categorized` : 'Transactions are uncategorized'}
              status={categorizationCoverage >= 80 ? 'Done' : hasTransactions ? 'Ready' : 'Needs upload'}
              icon={CheckCircle2}
              disabled={!hasTransactions || controlDataLoading}
              onClick={() => triggerAction('categorize')}
            />
          </div>

          <div className="mt-6 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Budget Forecast</p>
                <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">Forecast Setup</p>
              </div>
              <PipelineButton
                label="Forecast Budget"
                icon={Sparkles}
                onClick={() => triggerAction('forecast')}
                disabled={!hasTransactions || !isForecastSourceReady(sourceMode, selectedBatchId, dateFrom, dateTo)}
              />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Months Ahead</label>
                <select value={monthsAhead} onChange={(e) => setMonthsAhead(Number(e.target.value))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700">
                  {[1, 2, 3, 6].map((value) => <option key={value} value={value}>{value} month{value > 1 ? 's' : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Forecast Source</label>
                <select value={sourceMode} onChange={(e) => setSourceMode(e.target.value as ForecastSourceMode)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700">
                  <option value="latest_batch">Latest Upload Batch</option>
                  <option value="full_history">Full Department History</option>
                  <option value="upload_batch">Selected Upload Batch</option>
                  <option value="date_range">Custom Date Range</option>
                </select>
              </div>
            </div>
            {sourceMode === 'upload_batch' && (
              <div className="mt-5">
                <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Upload Batch</label>
                <select value={selectedBatchId} onChange={(e) => setSelectedBatchId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700">
                  {uploadBatches.map((batch) => (
                    <option key={batch.upload_batch_id} value={batch.upload_batch_id}>
                      {batch.source_file_name} ({batch.transaction_count} rows)
                    </option>
                  ))}
                </select>
                {selectedUploadBatch && (
                  <p className="mt-2 text-xs font-medium text-slate-500">
                    Range: {selectedUploadBatch.first_transaction_date || 'N/A'} to {selectedUploadBatch.last_transaction_date || 'N/A'}
                  </p>
                )}
              </div>
            )}
            {sourceMode === 'date_range' && (
              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Start Date</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700" />
                </div>
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">End Date</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700" />
                </div>
              </div>
            )}
          </div>
          {status && <p className="mt-5 text-sm font-semibold text-blue-700">{status}</p>}
      </div>
      {expenseCategoryReview}
    </div>
  );

  const ruleForensicView = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Forensic Lab"
        title={`${selectedDepartment?.department_name || 'Department'} Anomaly Review`}
        description="Upload a monthly transaction ledger, run Benford, Z-score, and RSF checks, then inspect every generated flag."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ExecutiveMetric label="Open Flags" value={activeAnomalies.length} note="Detected by forensic laws" accent="negative" icon={AlertTriangle} />
        <ExecutiveMetric label="Flagged Transactions" value={flaggedRows.length} note="Unique ledger rows under review" accent="negative" icon={ShieldAlert} />
        <ExecutiveMetric label="Integrity Score" value={`${Math.max(70, 100 - activeAnomalies.length * 4).toFixed(1)}%`} note={formatMonthLabel(forensicMonth)} accent="neutral" icon={ShieldCheck} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.86fr,1.14fr] gap-6">
        <form className={`${shellCard} p-7 bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.10),_transparent_42%),white]`} onSubmit={handleForensicUpload}>
          <SectionKicker title="Monthly Ledger Upload" subtitle="Add the transaction file for the month you want to audit." />
          <div className="mt-6 space-y-4">
            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
              <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Department</label>
              <select value={selectedDeptId} onChange={(event) => handleDepartmentSelect(event.target.value)} disabled={!departments.length} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100">
                {!departments.length && <option value="">No departments loaded</option>}
                {departments.map((department) => <option key={department.department_id} value={department.department_id}>{department.department_name}</option>)}
              </select>
            </div>

            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
              <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Audit Month</label>
              <input
                type="month"
                value={forensicMonth}
                onChange={(event) => setForensicMonth(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700"
              />
            </div>

            <label className="block rounded-[26px] border border-dashed border-red-200 bg-red-50/70 p-6 cursor-pointer transition hover:border-red-400 hover:bg-red-50">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-red-600 shadow-sm">
                  <Upload size={22} />
                </div>
                <div>
                  <p className="font-bold text-slate-900">{forensicFile ? forensicFile.name : 'Upload monthly ledger'}</p>
                  <p className="text-sm text-slate-500 mt-1">Supports normalized files and ledgers with Debit/narration/chart_of_acc_head columns.</p>
                </div>
              </div>
              <input type="file" accept=".csv,.xls,.xlsx" onChange={(event) => setForensicFile(event.target.files?.[0] || null)} className="hidden" />
            </label>

            <button type="submit" disabled={!selectedDeptId || !forensicFile} className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 font-bold text-white shadow-[0_20px_40px_rgba(15,23,42,0.15)] ${selectedDeptId && forensicFile ? 'bg-slate-950' : 'bg-slate-300 cursor-not-allowed'}`}>
              <FileUp size={18} />
              Upload Month Data
            </button>
          </div>
        </form>

        <div className={`${shellCard} p-7`}>
          <SectionKicker title="Detection Laws" subtitle="Choose a transaction file, then run the backend forensic checks against the selected month." />
          <div className="mt-6 rounded-[26px] border border-slate-200 bg-slate-50 p-4">
            <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Review File</label>
            <select
              value={selectedForensicBatchId}
              onChange={(event) => setSelectedForensicBatchId(event.target.value)}
              disabled={!forensicReviewBatches.length}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              {!forensicReviewBatches.length && <option value="">No files with saved transactions yet</option>}
              {forensicReviewBatches.map((batch) => (
                <option key={batch.upload_batch_id} value={batch.upload_batch_id}>
                  {batch.source_file_name} ({batch.transaction_count} rows)
                </option>
              ))}
            </select>
            {selectedForensicBatch && (
              <p className="mt-2 text-xs font-medium text-slate-500">
                Range: {selectedForensicBatch.first_transaction_date || 'N/A'} to {selectedForensicBatch.last_transaction_date || 'N/A'}
              </p>
            )}
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <ForensicLawCard title="Benford" value={anomalyCounts.benford} description="Flags unusual leading-digit distributions." />
            <ForensicLawCard title="Z-score" value={anomalyCounts.zscore} description="Flags outliers inside transaction groups." />
            <ForensicLawCard title="RSF" value={anomalyCounts.rsf} description="Flags amounts far above their cohort median." />
          </div>

          <button type="button" disabled={!selectedDeptId || !selectedForensicBatchId} onClick={runForensicAnalysis} className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[24px] px-5 py-4 font-black text-white shadow-[0_20px_40px_rgba(239,68,68,0.20)] transition ${selectedDeptId && selectedForensicBatchId ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-300 cursor-not-allowed'}`}>
            <AlertTriangle size={18} />
            Run Forensic Scan
          </button>

          {currentForensicResult && (
            <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Latest Run</p>
              <p className="mt-2 text-sm font-semibold text-slate-700">
                {currentForensicResult.message || `${currentForensicResult.total_anomalies} anomalies detected for ${currentForensicResult.source_file_name || selectedForensicBatch?.source_file_name || 'selected file'} in ${formatMonthLabel(forensicMonth)}.`}
              </p>
            </div>
          )}

          {status && <p className="mt-5 text-sm font-semibold text-blue-700">{status}</p>}
        </div>
      </div>

      <div className={`${shellCard} p-7`}>
        <SectionKicker title="Generated Flags" subtitle="Open each explanation to see which law flagged the transaction and the evidence behind it." />
        <div className="mt-6 space-y-4">
          {flaggedRows.map(({ transaction, anomalies: rowAnomalies }) => (
            <div key={rowAnomalies[0].transaction_id} className="rounded-[26px] border border-red-100 bg-red-50/60 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    {rowAnomalies.map((anomaly) => (
                      <span key={anomaly.anomaly_id} className="rounded-full border border-red-200 bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-red-700">
                        {formatAnomalyType(anomaly.anomaly_type)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 font-black text-slate-950">{transaction?.description || 'Flagged transaction'}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {transaction ? `${formatDate(transaction.transaction_date)} | TK ${transaction.amount.toLocaleString()} | ${transaction.group_name || transaction.chart_acc_head || 'Ungrouped'}` : rowAnomalies[0].transaction_id}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rowAnomalies.map((anomaly) => (
                    <div key={anomaly.anomaly_id} className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelectedAnomaly(anomaly)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-red-700 shadow-sm transition hover:bg-red-100">
                        <Eye size={16} />
                        View {formatAnomalyType(anomaly.anomaly_type)}
                      </button>
                      <button type="button" onClick={() => handleUndoAnomaly(anomaly.anomaly_id)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 shadow-sm transition hover:bg-slate-100">
                        <X size={16} />
                        Undo Flag
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {!flaggedRows.length && (
            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <p className="font-black text-slate-950">No generated flags yet</p>
                  <p className="mt-1 text-sm text-slate-500">Upload or select a ledger file, choose the month, then run the forensic scan for that file.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );


  const forensicView = (
    <div className="space-y-6">
      <div className={`${shellCard} p-3`}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setForensicMode('rule')}
            className={`flex items-center gap-4 rounded-[26px] px-5 py-4 text-left transition ${forensicMode === 'rule' ? 'bg-slate-950 text-white shadow-[0_16px_38px_rgba(15,23,42,0.24)]' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${forensicMode === 'rule' ? 'bg-white/12 text-white' : 'bg-white text-red-600 shadow-sm'}`}>
              <ShieldAlert size={22} />
            </span>
            <span>
              <span className="block text-[11px] font-black uppercase tracking-[0.22em] opacity-70">Standard Review</span>
              <span className="mt-1 block text-lg font-black">Rule-Based Scan</span>
              <span className="mt-1 block text-sm font-semibold opacity-75">Benford, Z-score, and RSF checks.</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setForensicMode('engine')}
            className={`flex items-center gap-4 rounded-[26px] px-5 py-4 text-left transition ${forensicMode === 'engine' ? 'bg-slate-950 text-white shadow-[0_16px_38px_rgba(15,23,42,0.24)]' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${forensicMode === 'engine' ? 'bg-white/12 text-white' : 'bg-white text-blue-600 shadow-sm'}`}>
              <Radar size={22} />
            </span>
            <span>
              <span className="block text-[11px] font-black uppercase tracking-[0.22em] opacity-70">Deep Review</span>
              <span className="mt-1 block text-lg font-black">Intelligence Engine</span>
              <span className="mt-1 block text-sm font-semibold opacity-75">Multi-view forensic scoring and case reports.</span>
            </span>
          </button>
        </div>
      </div>

      {transactionsLoading ? (
        <div className={`${shellCard} p-7`}>
          <div className="h-80">
            <ChartLoadingState label="Loading forensic review" />
          </div>
        </div>
      ) : forensicMode === 'rule'
        ? ruleForensicView
        : <ForensicIntelligence department={selectedDepartment} transactions={transactions} />}
    </div>
  );

  const reports = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Executive Intelligence"
        title="Holistic Performance Reports"
        description="A cleaner presentation layer for budget utilization, forecast confidence, and operational efficiency."
      />
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr,0.6fr,0.6fr] gap-6">
        <div className={`${shellCard} p-7`}>
          <SectionKicker title="Budget Utilization by Business Unit" subtitle="Budget vs. realized spend across active departments." />
          <div className="h-[380px] mt-6">
            {departmentLoading ? (
              <ChartLoadingState label="Loading budget utilization" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={departmentBudgetData} barGap={12}>
                  <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 700 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: 20, borderColor: '#dbeafe', boxShadow: '0 12px 40px rgba(15,23,42,0.10)' }} />
                  <Bar dataKey="budget" fill="#E8EEF8" radius={[10, 10, 0, 0]} />
                  <Bar dataKey="spend" radius={[10, 10, 0, 0]}>
                    {departmentBudgetData.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={entry.name === selectedDepartment?.department_name.split(' ').slice(0, 2).join(' ') ? '#3B82F6' : '#94A3B8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <CalloutCard
          tone="dark"
          eyebrow="Forecast Accuracy"
          title={forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined ? `${forecastDiagnostics.mape}%` : 'N/A'}
          description="Lower MAPE means the prediction pipeline is tracking actual spend more tightly."
          footer="Forecast quality"
          isLoading={forecastLoading}
        />

        <CalloutCard
          tone="green"
          eyebrow="Savings Potential"
          title={`TK ${Math.round((categorizationSummary?.unnecessary || 0) * 1200 + activeAnomalyCount * 450).toLocaleString()}`}
          description="Potential reduction from unnecessary transactions and anomalies requiring remediation."
          footer="Estimated savings"
          isLoading={departmentLoading}
        />
      </div>
    </div>
  );

  const deptStatus = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Realtime Fiscal Analysis"
        title={`${selectedDepartment?.department_name || 'Department'} Status`}
        description="Track department spending, forecast updates, and data integrity in one place."
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <ExecutiveMetric label="Forecast Entries" value={forecasts.length} note="Serialized or live model output" accent="neutral" icon={Sparkles} isLoading={forecastLoading} />
        <ExecutiveMetric label="Open Anomalies" value={activeAnomalyCount} note="Needs attention" accent="negative" icon={AlertTriangle} isLoading={departmentLoading} />
        <ExecutiveMetric label="Necessary" value={categorizationSummary?.necessary || 0} note="Spending marked essential" accent="positive" icon={CheckCircle2} isLoading={departmentLoading} />
        <ExecutiveMetric label="Integrity" value={`${Math.max(88, 100 - activeAnomalyCount * 2.1).toFixed(1)}%`} note={forecasts.length ? 'Forecast available' : 'Awaiting forecast'} accent="positive" icon={ShieldCheck} isLoading={isDepartmentSwitching} />
      </div>

      <div className={`${shellCard} p-7`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <SectionKicker title="Data Readiness" subtitle="Department health before reporting and forecasting." />
          <button
            type="button"
            onClick={() => setActivePath('/dept-control')}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-700"
          >
            <ArrowRight size={17} />
            Go to Dept Control
          </button>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {dataReadiness.map((item) => (
            <ReadinessCard key={item.label} label={item.label} value={item.value} state={item.state} isLoading={departmentLoading || controlDataLoading} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr,0.65fr] gap-6">
        <div className={`${shellCard} p-7`}>
          <SectionKicker title="Budget Forecast Curve" subtitle="Historical monthly spend extended into the prediction window." />
          <div className="h-[380px] mt-6">
            {isDepartmentSwitching ? (
              <ChartLoadingState label="Loading forecast curve" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={forecastChartData}>
                  <defs>
                    <linearGradient id="forecastBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#60A5FA" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#60A5FA" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke="#dbeafe" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 700 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: 20, borderColor: '#dbeafe', boxShadow: '0 12px 40px rgba(59,130,246,0.14)' }} />
                  <Area type="monotone" dataKey="upper" stroke="transparent" fill="url(#forecastBand)" />
                  <Area type="monotone" dataKey="actual" stroke="#1D4ED8" strokeWidth={4} fillOpacity={0} />
                  <Area type="monotone" dataKey="forecast" stroke="#60A5FA" strokeWidth={4} fillOpacity={0} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className={`${shellCard} p-7`}>
            <SectionKicker title="Forecast Summary" subtitle="Current forecast health and coverage." />
            <div className="mt-5 space-y-4">
              <DataPill label="Forecast Status" value={forecasts.length ? 'Ready' : 'Pending'} isLoading={forecastLoading} />
              <DataPill label="Source" value={sourceModeLabel} isLoading={forecastLoading} />
              <DataPill label="Confidence" value={forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined ? `${Math.max(0, Math.round(100 - forecastDiagnostics.mape))}%` : 'N/A'} isLoading={forecastLoading} />
              <DataPill label="MAPE" value={forecastDiagnostics?.mape !== null && forecastDiagnostics?.mape !== undefined ? `${forecastDiagnostics.mape}%` : 'N/A'} isLoading={forecastLoading} />
              <DataPill label="Coverage" value={`${forecastDiagnostics?.train_months || 0} months`} isLoading={forecastLoading} />
            </div>
            {forecastDiagnostics?.notes && (
              <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
                Forecast data is available and ready to review.
              </div>
            )}
          </div>

          <div className={`${shellCard} p-7`}>
            <SectionKicker title="Latest Forecasts" subtitle="Confidence-bounded projections." />
            <div className="mt-5 space-y-3">
              {forecastLoading ? (
                <ForecastListSkeleton />
              ) : latestForecasts.map((forecast) => (
                <div key={forecast.forecast_id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-black text-slate-950">{formatMonthLabel(forecast.forecast_period_start)}</p>
                      <p className="text-sm text-slate-500 mt-1">Projected department spend</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-slate-950">TK {forecast.predicted_amount.toLocaleString()}</p>
                      <p className="text-xs font-semibold text-slate-500">TK {forecast.lower_bound.toLocaleString()} - {forecast.upper_bound.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
              {!forecastLoading && !forecasts.length && <p className="text-sm text-slate-500">No forecasts yet. Run budget prediction for this department.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const historyView = (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Operational History"
        title="Recent Transaction Timeline"
        description="A cleaner ledger table for reviewing recent imported activity."
      />
      <div className={`${shellCard} p-7`}>
        <SectionKicker title="Transaction History" subtitle="Recent imported records for the selected department." />
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                <th className="pb-4">Date</th>
                <th className="pb-4">Description</th>
                <th className="pb-4">Amount</th>
                <th className="pb-4">Group</th>
                <th className="pb-4">Expense Type</th>
                <th className="pb-4">Necessity</th>
              </tr>
            </thead>
            <tbody>
              {transactionsLoading ? (
                <TransactionTableSkeleton />
              ) : transactions.slice(0, 30).map((transaction) => (
                <tr key={transaction.transaction_id} className="border-t border-slate-100 text-sm text-slate-700">
                  <td className="py-4 font-semibold">{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                  <td className="py-4">
                    <p className="font-bold text-slate-900">{transaction.description || 'No description'}</p>
                    {transaction.flagged_reason && <p className="mt-1 text-xs text-red-500">{transaction.flagged_reason}</p>}
                  </td>
                  <td className="py-4 font-bold">TK {transaction.amount.toLocaleString()}</td>
                  <td className="py-4">{transaction.group_name || 'Not grouped'}</td>
                  <td className="py-4">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                      {transaction.expense_category_name || 'Unassigned'}
                    </span>
                  </td>
                  <td className="py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold border ${COLORS[transaction.category || 'uncategorized'] || COLORS.uncategorized}`}>
                      {transaction.category || 'uncategorized'}
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

  const employeesView = (
    <EmployeeAccessSection
      accounts={employees.filter((employee) => employee.account_type === 'EMPLOYEE')}
      departments={departments}
      onUpdatePermissions={handleUpdateEmployeeScopes}
    />
  );

  const content = loading
    ? <LoadingState label="Loading admin workspace" />
    : activePath === '/dashboard'
      ? overview
      : activePath === '/dept-control'
        ? deptControl
        : activePath === '/dept-status'
          ? deptStatus
          : activePath === '/forensic' || activePath === '/forensic-engine'
            ? forensicView
            : activePath === '/reports'
              ? reports
              : activePath === '/history'
                ? historyView
                : activePath === '/audit-logs'
                  ? historyView
                  : employeesView;

  const modalTransaction = selectedAnomaly ? transactionById.get(selectedAnomaly.transaction_id) || null : null;
  const groupTransactionRows = groupTransactionPage?.items || [];
  const groupTransactionTotal = groupTransactionPage?.total ?? selectedExpenseGroup?.transaction_count ?? 0;
  const groupTransactionStart = groupTransactionTotal > 0 ? groupTransactionOffset + 1 : 0;
  const groupTransactionEnd = Math.min(groupTransactionOffset + GROUP_TRANSACTION_PAGE_SIZE, groupTransactionTotal);

  return (
    <>
      <Layout user={user} onLogout={onLogout} activePath={activePath} onNavigate={setActivePath}>{content}</Layout>
      {blockingAction && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm" role="status" aria-live="polite">
          <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-white p-8 text-center shadow-[0_30px_90px_rgba(15,23,42,0.4)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
              <span className="h-9 w-9 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            </div>
            <h2 className="mt-6 text-2xl font-black tracking-tight text-slate-950">{blockingAction.title}</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">{blockingAction.detail}</p>
          </div>
        </div>
      )}
      {selectedExpenseGroup && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 px-4 py-8 backdrop-blur-sm"
          onClick={() => setSelectedExpenseGroup(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[32px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-7">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-blue-600">Group Transactions</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950">
                  {selectedExpenseGroup.group_name || `Group ${selectedExpenseGroup.group_no || ''}`}
                </h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  {selectedExpenseGroup.chart_acc_head_name} | {groupTransactionTotal.toLocaleString()} transaction{groupTransactionTotal === 1 ? '' : 's'}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedExpenseGroup(null)} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200" aria-label="Close group transactions">
                <X size={20} />
              </button>
            </div>

            <div className="max-h-[calc(92vh-132px)] overflow-y-auto p-7">
              <div className="overflow-x-auto rounded-[26px] border border-slate-200">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="bg-slate-50">
                    <tr className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                      <th className="px-5 py-4">Date</th>
                      <th className="px-5 py-4">Description</th>
                      <th className="px-5 py-4">Amount</th>
                      <th className="px-5 py-4">Type</th>
                      <th className="px-5 py-4">Expense Type</th>
                      <th className="px-5 py-4">Source File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupTransactionsLoading ? (
                      <tr><td colSpan={6} className="px-5 py-8"><SkeletonLine className="h-5 w-full" /></td></tr>
                    ) : groupTransactionRows.map((transaction) => (
                      <tr key={transaction.transaction_id} className="border-t border-slate-100 text-sm text-slate-700">
                        <td className="px-5 py-4 font-semibold">{formatDate(transaction.transaction_date)}</td>
                        <td className="px-5 py-4">
                          <p className="font-bold text-slate-900">{transaction.description || 'No description'}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{transaction.chart_acc_head || transaction.cleaned_chart_acc_head || 'No account head'}</p>
                        </td>
                        <td className="px-5 py-4 font-bold">TK {Number(transaction.amount || 0).toLocaleString()}</td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${transaction.transaction_type === 'credit' ? 'bg-cyan-50 text-cyan-700' : 'bg-amber-50 text-amber-700'}`}>
                            {transaction.transaction_type}
                          </span>
                        </td>
                        <td className="px-5 py-4">{transaction.expense_category_name || selectedExpenseGroup.suggested_category_name || 'Unassigned'}</td>
                        <td className="px-5 py-4 font-semibold text-slate-500">{transaction.source_file_name || 'N/A'}</td>
                      </tr>
                    ))}
                    {!groupTransactionsLoading && !groupTransactionRows.length && (
                      <tr>
                        <td colSpan={6} className="px-5 py-10 text-center text-sm font-semibold text-slate-400">
                          No transactions found for this group.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-slate-500">
                    Showing {groupTransactionStart}-{groupTransactionEnd} of {groupTransactionTotal}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setGroupTransactionOffset((current) => Math.max(0, current - GROUP_TRANSACTION_PAGE_SIZE))}
                      disabled={groupTransactionsLoading || groupTransactionOffset === 0}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupTransactionOffset((current) => current + GROUP_TRANSACTION_PAGE_SIZE)}
                      disabled={groupTransactionsLoading || groupTransactionEnd >= groupTransactionTotal}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {selectedAnomaly && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 px-4 py-8 backdrop-blur-sm"
          onClick={() => setSelectedAnomaly(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[32px] bg-white p-7 shadow-[0_30px_80px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-600">Flag Explanation</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950">{formatAnomalyType(selectedAnomaly.anomaly_type)} Detection</h2>
              </div>
              <button type="button" onClick={() => setSelectedAnomaly(null)} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200" aria-label="Close explanation">
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Flagged Transaction</p>
              <p className="font-black text-slate-950">{modalTransaction?.description || 'Flagged transaction'}</p>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                {modalTransaction
                  ? `${formatDate(modalTransaction.transaction_date)} | TK ${modalTransaction.amount.toLocaleString()} | ${modalTransaction.group_name || modalTransaction.chart_acc_head || 'Ungrouped'}`
                  : selectedAnomaly.transaction_id}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TransactionDetail label="Transaction ID" value={selectedAnomaly.transaction_id} />
                <TransactionDetail label="Voucher" value={modalTransaction?.invoice_id || 'N/A'} />
                <TransactionDetail label="Reference" value={modalTransaction?.po_number || 'N/A'} />
                <TransactionDetail label="Account Head" value={modalTransaction?.chart_acc_head || modalTransaction?.cleaned_chart_acc_head || 'N/A'} />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <DataPill label="Law" value={formatAnomalyType(selectedAnomaly.anomaly_type)} />
              <DataPill label="Score" value={selectedAnomaly.score.toFixed(4)} />
              <DataPill label="Threshold" value={selectedAnomaly.threshold.toFixed(4)} />
              <DataPill label="Status" value={selectedAnomaly.is_resolved ? 'Resolved' : 'Open'} />
            </div>

            <div className="mt-5 rounded-[26px] border border-red-100 bg-red-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-red-700">Why it was flagged</p>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
                {buildAnomalyExplanation(selectedAnomaly)}
              </p>
            </div>

            <div className="mt-5 rounded-[26px] border border-slate-200 bg-white p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Evidence Snapshot</p>
              <div className="mt-3 space-y-2">
                {Object.entries(selectedAnomaly.evidence_snapshot || {}).map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                    <span className="font-black uppercase tracking-[0.12em] text-slate-400">{key.replaceAll('_', ' ')}</span>
                    <span className="text-right font-semibold text-slate-700">{formatEvidenceValue(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setSelectedAnomaly(null)} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-600 transition hover:bg-slate-50">
                Close
              </button>
              {!selectedAnomaly.is_resolved && (
                <button type="button" onClick={() => handleUndoAnomaly(selectedAnomaly.anomaly_id)} className="rounded-2xl bg-slate-950 px-5 py-3 font-black text-white transition hover:bg-slate-800">
                  Undo Flag
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const HeroHeader = ({
  eyebrow,
  title,
  description,
  actionLabel,
  actionContent,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionContent?: React.ReactNode;
}) => (
  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
    <div>
      <p className="text-[11px] font-black uppercase tracking-[0.28em] text-blue-600">{eyebrow}</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] text-slate-950">{title}</h1>
      <p className="mt-3 max-w-2xl text-lg text-slate-500">{description}</p>
    </div>
    {(actionContent || actionLabel) && (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
        {actionContent}
        {actionLabel && (
          <button type="button" className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-[22px] border border-slate-200 bg-white px-5 py-4 font-bold text-slate-700 shadow-[0_15px_40px_rgba(15,23,42,0.06)]">
            <ArrowUpRight size={18} />
            {actionLabel}
          </button>
        )}
      </div>
    )}
  </div>
);

const DepartmentPicker = ({
  departments,
  selectedId,
  onSelect,
  isLoading = false,
}: {
  departments: Department[];
  selectedId: string;
  onSelect: (departmentId: string) => void;
  isLoading?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedDepartment = departments.find((department) => department.department_id === selectedId);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={pickerRef} className="relative w-full sm:w-[290px]">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={!departments.length}
        className={`group flex min-h-[64px] w-full items-center gap-3 rounded-2xl border bg-white px-3.5 py-2.5 text-left shadow-[0_15px_40px_rgba(15,23,42,0.07)] outline-none transition focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 ${isOpen ? 'border-blue-300 ring-4 ring-blue-100' : 'border-slate-200 hover:border-blue-200 hover:bg-blue-50/30'}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="overview-department-menu"
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${isOpen ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600 group-hover:bg-blue-100'}`}>
          <Building2 size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Viewing department</span>
          <span className="mt-0.5 block truncate text-sm font-black text-slate-800">
            {selectedDepartment?.department_name || 'Choose department'}
          </span>
        </span>
        {isLoading ? (
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600" aria-label="Loading department data" />
        ) : (
          <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-600' : ''}`} />
        )}
      </button>

      {isOpen && (
        <div
          id="overview-department-menu"
          role="listbox"
          aria-label="Departments"
          className="absolute right-0 top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
        >
          <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Switch workspace</p>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto p-2">
            {departments.map((department) => {
              const isSelected = department.department_id === selectedId;
              return (
                <button
                  key={department.department_id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelect(department.department_id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${isSelected ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-white/15' : 'bg-slate-100 text-slate-500'}`}>
                    <Building2 size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{department.department_name}</span>
                  {isSelected && <Check size={17} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const EmployeeAccessSection = ({
  accounts,
  departments,
  onUpdatePermissions,
}: {
  accounts: UserAccount[];
  departments: Department[];
  onUpdatePermissions: (userId: string, permissionsByDepartment: Record<string, string[]>) => Promise<void>;
}) => {
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, Record<string, string[]>>>({});
  const [openAccessPickerId, setOpenAccessPickerId] = useState<string | null>(null);
  const [savingEmployeeId, setSavingEmployeeId] = useState<string | null>(null);
  const [savedEmployeeId, setSavedEmployeeId] = useState<string | null>(null);

  const employeePermissions = (employee: UserAccount) =>
    permissionDrafts[employee.user_id] ??
    employee.departments.reduce<Record<string, string[]>>((accumulator, role) => {
      accumulator[role.department_id] = role.permissions || [];
      return accumulator;
    }, {});

  const updateEmployeePermissions = (
    employee: UserAccount,
    updater: (permissions: Record<string, string[]>) => Record<string, string[]>,
  ) => {
    setPermissionDrafts((current) => ({
      ...current,
      [employee.user_id]: updater(employeePermissions(employee)),
    }));
    setSavedEmployeeId(null);
  };

  const togglePermission = (employee: UserAccount, departmentId: string, permissionId: string) => {
    updateEmployeePermissions(employee, (currentPermissions) => {
      const current = currentPermissions[departmentId] || [];
      const next = current.includes(permissionId)
        ? current.filter((permission) => permission !== permissionId)
        : [...current, permissionId];
      return { ...currentPermissions, [departmentId]: next };
    });
  };

  const addDepartmentAccess = (employee: UserAccount, departmentId: string) => {
    updateEmployeePermissions(employee, (currentPermissions) => ({
      ...currentPermissions,
      [departmentId]: ['view_transactions'],
    }));
    setOpenAccessPickerId(null);
  };

  const revokeDepartmentAccess = (employee: UserAccount, departmentId: string) => {
    updateEmployeePermissions(employee, (currentPermissions) => {
      const updated = { ...currentPermissions };
      delete updated[departmentId];
      return updated;
    });
  };

  const saveEmployeeAccess = async (employee: UserAccount) => {
    setSavingEmployeeId(employee.user_id);
    try {
      await onUpdatePermissions(employee.user_id, employeePermissions(employee));
      setPermissionDrafts((current) => {
        const updated = { ...current };
        delete updated[employee.user_id];
        return updated;
      });
      setSavedEmployeeId(employee.user_id);
      window.setTimeout(() => setSavedEmployeeId(null), 1600);
    } finally {
      setSavingEmployeeId(null);
    }
  };

  return (
    <div className="space-y-8">
      <HeroHeader
        eyebrow="Team Oversight"
        title="Employee Access Map"
        description="Choose which company departments and workspace sections each employee can access."
      />
      <div className="space-y-5">
        {accounts.map((employee) => {
          const permissions = employeePermissions(employee);
          const isExpanded = expandedEmployeeId === employee.user_id;
          const authorizedDepartmentIds = Object.keys(permissions);
          const availableDepartments = departments.filter((department) => !permissions[department.department_id]);
          const isSaving = savingEmployeeId === employee.user_id;
          const isSaved = savedEmployeeId === employee.user_id;

          return (
            <div key={employee.user_id} className={`${shellCard} overflow-visible bg-white`}>
              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-slate-950 text-white flex items-center justify-center font-black">
                      {employee.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-lg font-black text-slate-950">{employee.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{employee.email}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${employee.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {employee.is_active ? 'Active' : 'Disabled'}
                  </span>
                </div>

                <div className="mt-6 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Clock size={16} />
                    <span className="text-[10px] font-black uppercase tracking-[0.18em]">
                      {authorizedDepartmentIds.length} {authorizedDepartmentIds.length === 1 ? 'unit' : 'units'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedEmployeeId((current) => current === employee.user_id ? null : employee.user_id);
                      setOpenAccessPickerId(null);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-50 px-4 py-2 text-sm font-black text-blue-600 transition hover:bg-blue-100"
                  >
                    {isExpanded ? 'Hide Controls' : 'Configure'}
                    <ChevronRight size={16} className={`transition ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-6 space-y-5 rounded-[28px] border border-slate-200 bg-slate-50/70 p-5">
                    <div className="flex items-center gap-3">
                      <Shield className="text-blue-600" size={20} />
                      <div>
                        <h3 className="font-black text-slate-950">Department Scopes</h3>
                        <p className="text-sm font-medium text-slate-500">Toggle access sections for this employee.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {authorizedDepartmentIds.map((departmentId) => {
                        const department = departments.find((item) => item.department_id === departmentId);
                        if (!department) return null;

                        return (
                          <div key={departmentId} className="rounded-[24px] border border-slate-200 bg-white p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-blue-600">
                                  <Table size={16} />
                                </div>
                                <div>
                                  <p className="font-black text-slate-950">{department.department_name}</p>
                                  <p className="text-xs font-semibold text-slate-400">{permissions[departmentId]?.length || 0} permissions enabled</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => revokeDepartmentAccess(employee, departmentId)}
                                className="self-start rounded-xl border border-red-100 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-red-500 transition hover:bg-red-50 sm:self-auto"
                              >
                                Revoke
                              </button>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {EMPLOYEE_SCOPE_OPTIONS.map((permission) => {
                                const isActive = permissions[departmentId]?.includes(permission.id);
                                return (
                                  <button
                                    key={permission.id}
                                    type="button"
                                    onClick={() => togglePermission(employee, departmentId, permission.id)}
                                    className={`flex min-h-[56px] items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${isActive ? 'border-blue-300 bg-blue-50/70 shadow-sm ring-1 ring-blue-100' : 'border-slate-200 bg-white text-slate-400 hover:text-slate-700'}`}
                                  >
                                    <span className={`text-xs font-black uppercase tracking-[0.08em] ${isActive ? 'text-slate-900' : ''}`}>{permission.label}</span>
                                    <span className={`flex h-5 w-9 items-center rounded-full p-0.5 transition ${isActive ? 'bg-blue-600' : 'bg-slate-300'}`}>
                                      <span className={`h-4 w-4 rounded-full bg-white transition ${isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {!authorizedDepartmentIds.length && (
                        <div className="rounded-[24px] border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-400">
                          This employee does not have department access yet.
                        </div>
                      )}
                    </div>

                    <div className="relative flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        onClick={() => setOpenAccessPickerId((current) => current === employee.user_id ? null : employee.user_id)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-blue-100 bg-white px-4 py-3 font-black text-blue-600 shadow-sm transition hover:bg-blue-50"
                      >
                        <Plus size={18} />
                        Grant Department
                      </button>

                      <button
                        type="button"
                        onClick={() => saveEmployeeAccess(employee)}
                        disabled={isSaving}
                        className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 font-black text-white transition disabled:opacity-70 ${isSaved ? 'bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                      >
                        {isSaving ? (
                          <>
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            Saving
                          </>
                        ) : isSaved ? (
                          <>
                            <Check size={18} />
                            Saved
                          </>
                        ) : (
                          'Save Access'
                        )}
                      </button>

                      {openAccessPickerId === employee.user_id && (
                        <div className="absolute bottom-full left-0 mb-3 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
                          <p className="border-b border-slate-50 p-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Available Departments</p>
                          <div className="max-h-56 space-y-1 overflow-y-auto pt-2">
                            {availableDepartments.map((department) => (
                              <button
                                key={department.department_id}
                                type="button"
                                onClick={() => addDepartmentAccess(employee, department.department_id)}
                                className="group flex w-full items-center justify-between rounded-xl p-3 text-left text-sm font-bold text-slate-700 transition hover:bg-blue-600 hover:text-white"
                              >
                                <span>{department.department_name}</span>
                                <ArrowRight size={14} className="opacity-0 transition group-hover:opacity-100" />
                              </button>
                            ))}
                            {!availableDepartments.length && (
                              <p className="p-6 text-center text-xs font-semibold text-slate-400">All departments are already assigned.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!accounts.length && (
          <div className="col-span-full rounded-[32px] border border-dashed border-slate-200 bg-slate-50 p-12 text-center text-sm font-semibold text-slate-400">
            No employee accounts found for this company yet.
          </div>
        )}
      </div>
    </div>
  );
};

const expenseGroupKey = (group: ExpenseGroupSummary) => (
  group.group_no !== null && group.group_no !== undefined
    ? `group:${group.group_no}`
    : `chart:${group.chart_acc_head_name}`
);

const expenseStatusClass = (status: string) => {
  if (status === 'approved') return 'border border-emerald-100 bg-emerald-50 text-emerald-700';
  if (status === 'pending_review') return 'border border-amber-100 bg-amber-50 text-amber-700';
  if (status === 'rejected') return 'border border-red-100 bg-red-50 text-red-600';
  return 'border border-slate-200 bg-slate-50 text-slate-500';
};

const SectionKicker = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div>
    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{title}</p>
    <p className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950">{subtitle}</p>
  </div>
);

const ExecutiveMetric = ({
  label,
  value,
  note,
  accent,
  icon: Icon,
  isLoading = false,
}: {
  label: string;
  value: string | number;
  note: string;
  accent: 'positive' | 'negative' | 'neutral';
  icon: React.ElementType;
  isLoading?: boolean;
}) => (
  <div className={`${shellCard} p-6 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_42%),white]`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
        {isLoading ? (
          <>
            <SkeletonLine className="mt-4 h-10 w-32" />
            <SkeletonLine className="mt-3 h-4 w-44" />
          </>
        ) : (
          <>
            <p className="mt-3 text-4xl font-black tracking-[-0.05em] text-slate-950">{value}</p>
            <p className="mt-2 text-sm font-medium text-slate-500">{note}</p>
          </>
        )}
      </div>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
        <Icon size={22} />
      </div>
    </div>
    <div className="mt-5">
      <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${
        accent === 'positive'
          ? 'bg-emerald-50 text-emerald-700'
          : accent === 'negative'
            ? 'bg-red-50 text-red-700'
            : 'bg-blue-50 text-blue-700'
      }`}>
        {accent === 'positive' ? 'Healthy' : accent === 'negative' ? 'Needs review' : 'Stable'}
      </span>
    </div>
  </div>
);

const CalloutCard = ({
  tone,
  eyebrow,
  title,
  description,
  footer,
  isLoading = false,
}: {
  tone: 'dark' | 'green';
  eyebrow: string;
  title: string;
  description: string;
  footer: string;
  isLoading?: boolean;
}) => (
  <div className={`rounded-[34px] p-7 shadow-[0_24px_60px_rgba(15,23,42,0.18)] ${
    tone === 'dark' ? 'bg-slate-950 text-white' : 'bg-emerald-600 text-white'
  }`}>
    <p className={`text-[11px] font-black uppercase tracking-[0.26em] ${tone === 'dark' ? 'text-blue-200' : 'text-emerald-100'}`}>{eyebrow}</p>
    {isLoading ? (
      <>
        <SkeletonLine className={`mt-7 h-12 w-32 ${tone === 'dark' ? 'bg-white/15' : 'bg-white/25'}`} />
        <SkeletonLine className={`mt-6 h-4 w-full ${tone === 'dark' ? 'bg-white/10' : 'bg-white/20'}`} />
        <SkeletonLine className={`mt-3 h-4 w-4/5 ${tone === 'dark' ? 'bg-white/10' : 'bg-white/20'}`} />
      </>
    ) : (
      <>
        <p className="mt-6 text-5xl font-black tracking-[-0.05em]">{title}</p>
        <p className={`mt-5 text-base leading-7 ${tone === 'dark' ? 'text-slate-300' : 'text-emerald-50/85'}`}>{description}</p>
      </>
    )}
    <p className={`mt-10 border-t pt-4 text-sm font-black uppercase tracking-[0.18em] ${
      tone === 'dark' ? 'border-white/10 text-slate-200' : 'border-emerald-400/50 text-emerald-50'
    }`}>
      {footer}
    </p>
  </div>
);

const WorkflowStep = ({
  step,
  title,
  detail,
  status,
  icon: Icon,
  disabled,
  onClick,
}: {
  step: string;
  title: string;
  detail: string;
  status: string;
  icon: React.ElementType;
  disabled: boolean;
  onClick: () => void;
}) => (
  <div className={`rounded-[26px] border p-4 transition ${disabled ? 'border-slate-200 bg-slate-50/80' : 'border-blue-100 bg-white shadow-sm'}`}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-black ${disabled ? 'bg-slate-200 text-slate-500' : 'bg-blue-600 text-white'}`}>
          {step}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Icon size={17} className={disabled ? 'text-slate-400' : 'text-blue-600'} />
            <p className="font-black text-slate-950">{title}</p>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-500">{detail}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${disabled ? 'bg-slate-200 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>
          {status}
        </span>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="rounded-2xl bg-slate-950 px-4 py-3 text-xs font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Run
        </button>
      </div>
    </div>
  </div>
);

const PipelineButton = ({ label, icon: Icon, onClick, disabled = false }: { label: string; icon: React.ElementType; onClick: () => void; disabled?: boolean }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="inline-flex items-center justify-center gap-2 rounded-[24px] border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:hover:translate-y-0"
  >
    <Icon size={18} />
    {label}
  </button>
);

const DataPill = ({ label, value, isLoading = false }: { label: string; value: string | number; isLoading?: boolean }) => (
  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</span>
    {isLoading ? <SkeletonLine className="h-4 w-16" /> : <span className="text-sm font-black text-slate-950">{value}</span>}
  </div>
);

const ReadinessCard = ({
  label,
  value,
  state,
  isLoading = false,
}: {
  label: string;
  value: string;
  state: 'ready' | 'warning' | 'missing';
  isLoading?: boolean;
}) => {
  const styles = state === 'ready'
    ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
    : state === 'warning'
      ? 'border-amber-100 bg-amber-50 text-amber-700'
      : 'border-slate-200 bg-slate-50 text-slate-500';

  return (
    <div className={`rounded-2xl border px-4 py-4 ${styles}`}>
      <p className="text-[11px] font-black uppercase tracking-[0.16em] opacity-75">{label}</p>
      {isLoading ? (
        <SkeletonLine className="mt-3 h-5 w-28 bg-white/70" />
      ) : (
        <p className="mt-2 text-lg font-black">{value}</p>
      )}
    </div>
  );
};

const SkeletonLine = ({ className = '' }: { className?: string }) => (
  <span className={`block animate-pulse rounded-full bg-slate-200 ${className}`} />
);

const ChartLoadingState = ({ label }: { label: string }) => (
  <div className="flex h-full w-full items-center justify-center rounded-[26px] border border-dashed border-blue-100 bg-blue-50/40">
    <div className="text-center">
      <span className="mx-auto flex h-11 w-11 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
      <p className="mt-4 text-sm font-black uppercase tracking-[0.16em] text-blue-600">{label}</p>
      <div className="mx-auto mt-5 grid w-56 grid-cols-5 items-end gap-2">
        {[42, 68, 48, 76, 58].map((height, index) => (
          <span
            key={index}
            className="block animate-pulse rounded-t-xl bg-blue-200/70"
            style={{ height }}
          />
        ))}
      </div>
    </div>
  </div>
);

const ForecastListSkeleton = () => (
  <>
    {[0, 1, 2].map((index) => (
      <div key={index} className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <SkeletonLine className="h-5 w-28" />
            <SkeletonLine className="mt-3 h-4 w-40" />
          </div>
          <div className="w-28">
            <SkeletonLine className="ml-auto h-5 w-24" />
            <SkeletonLine className="ml-auto mt-3 h-3 w-28" />
          </div>
        </div>
      </div>
    ))}
  </>
);

const TransactionTableSkeleton = () => (
  <>
    {[0, 1, 2, 3, 4].map((index) => (
      <tr key={index} className="border-t border-slate-100">
        <td className="py-4"><SkeletonLine className="h-4 w-20" /></td>
        <td className="py-4">
          <SkeletonLine className="h-4 w-52" />
          <SkeletonLine className="mt-2 h-3 w-32" />
        </td>
        <td className="py-4"><SkeletonLine className="h-4 w-24" /></td>
        <td className="py-4"><SkeletonLine className="h-4 w-28" /></td>
        <td className="py-4"><SkeletonLine className="h-7 w-24" /></td>
        <td className="py-4"><SkeletonLine className="h-7 w-20" /></td>
      </tr>
    ))}
  </>
);

const TransactionDetail = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
    <p className="mt-1 break-words text-sm font-black text-slate-800">{value}</p>
  </div>
);

const ForensicLawCard = ({ title, value, description }: { title: string; value: number; description: string }) => (
  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{title}</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{description}</p>
      </div>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-xl font-black text-red-600 shadow-sm">
        {value}
      </span>
    </div>
  </div>
);

const formatAnomalyType = (value: string) => {
  const normalized = value.toLowerCase();
  if (normalized.includes('zscore')) return 'Z-score';
  if (normalized.includes('rsf')) return 'RSF';
  if (normalized.includes('benford')) return 'Benford';
  return value.replaceAll('_', ' ');
};

const formatEvidenceValue = (value: unknown) => {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'N/A';
  return JSON.stringify(value);
};

const buildAnomalyExplanation = (anomaly: Anomaly) => {
  const evidence = anomaly.evidence_snapshot || {};
  const type = anomaly.anomaly_type.toLowerCase();
  if (type.includes('benford')) {
    return `Benford's Law flagged this transaction because first digit ${formatEvidenceValue(evidence.digit)} appeared with observed frequency ${formatEvidenceValue(evidence.observed_frequency)}, while the expected frequency is ${formatEvidenceValue(evidence.expected_frequency)}. The deviation crossed the configured threshold of ${anomaly.threshold.toFixed(4)}.`;
  }
  if (type.includes('zscore')) {
    return `Z-score flagged this transaction because its amount was unusually far from the average in group "${formatEvidenceValue(evidence.group_name)}". The anomaly score is ${anomaly.score.toFixed(4)}, which is above the threshold of ${anomaly.threshold.toFixed(4)}.`;
  }
  if (type.includes('rsf')) {
    return `Relative Size Factor flagged this transaction because its amount was ${anomaly.score.toFixed(4)} times the median amount in group "${formatEvidenceValue(evidence.group_name)}". That is above the configured threshold of ${anomaly.threshold.toFixed(4)}.`;
  }
  return `This transaction was flagged by ${formatAnomalyType(anomaly.anomaly_type)} with score ${anomaly.score.toFixed(4)}, above threshold ${anomaly.threshold.toFixed(4)}.`;
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatMonthLabel = (value: string) =>
  new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const formatShortMonth = (value: string) =>
  value.length === 7
    ? new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' })
    : value;

const isForecastSourceReady = (
  sourceMode: ForecastSourceMode,
  selectedBatchId: string,
  dateFrom: string,
  dateTo: string,
) => {
  if (sourceMode === 'upload_batch') return Boolean(selectedBatchId);
  if (sourceMode === 'date_range') return Boolean(dateFrom && dateTo);
  return true;
};

const formatForecastSourceMode = (sourceMode: ForecastSourceMode) => {
  if (sourceMode === 'latest_batch') return 'Latest Batch';
  if (sourceMode === 'full_history') return 'Full History';
  if (sourceMode === 'upload_batch') return 'Selected Batch';
  return 'Date Range';
};

export default AdminDashboard;
