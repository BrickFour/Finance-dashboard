import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api, setAuthToken, setActiveCompanyId, setRequestCompanyId, getAuthToken, getActiveCompanyId, ApiError } from '@/lib/api';
import type { CurrencyConfig } from '@/lib/format';

export type Role = 'admin' | 'finance' | 'executive' | 'sales';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  roleLabel: string;
  capabilities: string[];
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface Company {
  id: string;
  name: string;
  entityType: string;
  entityLabel?: string;
  currency: string;
  currencyScale: number;
  isDemo: boolean;
  /** The built-in, read-only sample company created from the demo workbooks. */
  isSample?: boolean;
  /** Whether any vouchers or opening balances have been imported yet. */
  hasData?: boolean;
  gstin?: string | null;
}

export interface FinancialYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export type PeriodType = 'financial_year' | 'quarter' | 'month' | 'custom';

export interface PeriodSelection {
  type: PeriodType;
  from?: string;
  to?: string;
}

/**
 * Report pages that show the sample company's figures while the selected company
 * has nothing imported. Data-entry pages (import, mapping, companies, settings…)
 * always work on the company the user actually selected.
 */
const SAMPLE_PREVIEW_PATHS = new Set([
  '/',
  '/cash-and-bank',
  '/receivables',
  '/payables',
  '/cash-flow-forecast',
  '/expenses',
  '/budgets',
  '/profit-and-loss',
  '/balance-sheet',
  '/equity',
  '/ratios',
  '/reports',
  '/alerts',
]);

interface AppState {
  user: User | null;
  companies: Company[];
  /** The company whose figures the current page shows (may be the sample company). */
  company: Company | null;
  /** The company the user chose in the company switcher. */
  selectedCompany: Company | null;
  sampleCompany: Company | null;
  /** True when the page shows the sample company because the selected one has no data yet. */
  previewingSample: boolean;
  financialYears: FinancialYear[];
  financialYear: FinancialYear | null;
  period: PeriodSelection;
  currency: CurrencyConfig;
  loading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  selectCompany: (id: string) => void;
  selectFinancialYear: (id: string) => void;
  setPeriod: (p: PeriodSelection) => void;
  refreshCompanies: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (capability: string) => boolean;
  /** Query parameters every scoped page passes to the API. */
  scopeQuery: Record<string, string | undefined>;
}

const AppContext = createContext<AppState | null>(null);

/** The stored choice if it still exists, else a real company (with data first), else the sample. */
function chooseCompany(list: Company[], stored: string | null): Company | null {
  return (
    list.find((c) => c.id === stored) ??
    list.find((c) => !c.isSample && c.hasData) ??
    list.find((c) => !c.isSample) ??
    list[0] ??
    null
  );
}

export function AppProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fyCache, setFyCache] = useState<Record<string, FinancialYear[]>>({});
  const [fyChoice, setFyChoice] = useState<Record<string, string>>({});
  const [period, setPeriodState] = useState<PeriodSelection>({ type: 'financial_year' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedCompany = companies.find((c) => c.id === selectedId) ?? null;
  const sampleCompany = companies.find((c) => c.isSample) ?? null;
  const previewingSample = Boolean(
    SAMPLE_PREVIEW_PATHS.has(location.pathname) &&
      sampleCompany &&
      selectedCompany &&
      !selectedCompany.isSample &&
      !selectedCompany.hasData,
  );
  const company = previewingSample ? sampleCompany : selectedCompany;

  // Set before children render, so every request a page makes on mount carries
  // the company that page is showing. The persisted choice stays the user's own.
  setRequestCompanyId(company?.id ?? null);

  const applyCompanies = useCallback((list: Company[], preferId?: string | null) => {
    setCompanies(list);
    const chosen = chooseCompany(list, preferId ?? getActiveCompanyId());
    setSelectedId(chosen?.id ?? null);
    setActiveCompanyId(chosen?.id ?? null);
  }, []);

  const loadSession = useCallback(async () => {
    if (!getAuthToken()) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.get<{ user: User; companies: Company[] }>('/auth/me', undefined, { noCompany: true });
      setUser(res.user);
      applyCompanies(res.companies);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        setUser(null);
      } else {
        setError(err instanceof Error ? err.message : 'Could not load your session.');
      }
    } finally {
      setLoading(false);
    }
  }, [applyCompanies]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // Financial years follow the company being shown, cached per company so moving
  // between a report page and an import page does not refetch them.
  const companyId = company?.id ?? null;
  useEffect(() => {
    if (!companyId || fyCache[companyId]) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await api.get<{ financialYears: FinancialYear[] }>(`/companies/${companyId}/financial-years`, { companyId });
        if (!cancelled) setFyCache((prev) => ({ ...prev, [companyId]: res.financialYears }));
      } catch {
        if (!cancelled) setFyCache((prev) => ({ ...prev, [companyId]: [] }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId, fyCache]);

  const financialYears = useMemo(() => (companyId ? fyCache[companyId] ?? [] : []), [companyId, fyCache]);
  const financialYear = useMemo(() => {
    if (!companyId || !financialYears.length) return null;
    const chosen = financialYears.find((f) => f.id === fyChoice[companyId]);
    if (chosen) return chosen;
    // Prefer the year containing today, then the most recent.
    const today = new Date().toISOString().slice(0, 10);
    return financialYears.find((f) => f.startDate <= today && f.endDate >= today) ?? financialYears[0];
  }, [companyId, financialYears, fyChoice]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
      setAuthToken(res.token);
      setUser(res.user);

      const me = await api.get<{ user: User; companies: Company[] }>('/auth/me', undefined, { noCompany: true });
      applyCompanies(me.companies, null);
    },
    [applyCompanies],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* signing out locally matters more than the round trip succeeding */
    }
    setAuthToken(null);
    setActiveCompanyId(null);
    setUser(null);
    setCompanies([]);
    setSelectedId(null);
    setFyCache({});
    setFyChoice({});
  }, []);

  const selectCompany = useCallback((id: string) => {
    setSelectedId(id);
    setActiveCompanyId(id);
    // A period chosen for another company's year would silently mislead.
    setPeriodState({ type: 'financial_year' });
  }, []);

  const selectFinancialYear = useCallback(
    (id: string) => {
      if (!companyId) return;
      if (financialYears.some((f) => f.id === id)) {
        setFyChoice((prev) => ({ ...prev, [companyId]: id }));
        setPeriodState({ type: 'financial_year' });
      }
    },
    [companyId, financialYears],
  );

  const refreshCompanies = useCallback(async () => {
    const me = await api.get<{ user: User; companies: Company[] }>('/auth/me', undefined, { noCompany: true });
    setCompanies(me.companies);
    setFyCache({});
    if (!me.companies.find((c) => c.id === selectedId)) {
      const next = chooseCompany(me.companies, null);
      setSelectedId(next?.id ?? null);
      setActiveCompanyId(next?.id ?? null);
    }
  }, [selectedId]);

  // While the selected company is still empty, re-check on every navigation so
  // its own figures replace the sample as soon as an import lands.
  const waitingForData = Boolean(user && selectedCompany && !selectedCompany.isSample && !selectedCompany.hasData);
  useEffect(() => {
    if (!waitingForData) return;
    let cancelled = false;
    void api
      .get<{ user: User; companies: Company[] }>('/auth/me', undefined, { noCompany: true })
      .then((me) => {
        if (cancelled) return;
        const fresh = me.companies.find((c) => c.id === selectedId);
        if (fresh?.hasData) {
          setCompanies(me.companies);
          setFyCache({});
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [location.pathname, waitingForData, selectedId]);

  const refreshUser = useCallback(async () => {
    const me = await api.get<{ user: User; companies: Company[] }>('/auth/me', undefined, { noCompany: true });
    setUser(me.user);
  }, []);

  const can = useCallback((capability: string) => Boolean(user?.capabilities.includes(capability)), [user]);

  const value = useMemo<AppState>(
    () => ({
      user,
      companies,
      company,
      selectedCompany,
      sampleCompany,
      previewingSample,
      financialYears,
      financialYear,
      period,
      currency: { currency: company?.currency ?? 'INR', scale: company?.currencyScale ?? 2 },
      loading,
      error,
      login,
      logout,
      selectCompany,
      selectFinancialYear,
      setPeriod: setPeriodState,
      refreshCompanies,
      refreshUser,
      can,
      scopeQuery: {
        companyId: company?.id,
        financialYearId: financialYear?.id,
        periodType: period.type,
        from: period.from,
        to: period.to,
      },
    }),
    [
      user, companies, company, selectedCompany, sampleCompany, previewingSample, financialYears, financialYear, period,
      loading, error, login, logout, selectCompany, selectFinancialYear, refreshCompanies, refreshUser, can,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
