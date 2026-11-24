import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, Home, Upload } from 'lucide-react';
import { Button, Callout } from '@/components/ui';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { findNavItem } from './navigation';
import { useApp } from '@/state/AppContext';
import { cx } from '@/lib/format';

/**
 * Explains, on every page where it applies, that the figures are sample data and
 * how to replace them with the company's own.
 */
function SampleDataBanner() {
  const { previewingSample, selectedCompany, sampleCompany, can } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  if (previewingSample && selectedCompany && sampleCompany) {
    return (
      <Callout
        tone="warning"
        className="mb-4 no-print"
        title="You are viewing sample data"
        actions={
          can('imports.create') && (
            <Button variant="primary" size="sm" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => navigate('/import')}>
              Import {selectedCompany.name}'s data
            </Button>
          )
        }
      >
        Nothing has been imported for <strong>{selectedCompany.name}</strong> yet, so this page shows the demo company{' '}
        <strong>{sampleCompany.name}</strong> to show what the dashboard produces. Once you import your chart of accounts, opening
        balances or vouchers, your own figures replace the sample automatically.
      </Callout>
    );
  }

  if (selectedCompany?.isSample && location.pathname !== '/profile') {
    return (
      <Callout
        tone="info"
        className="mb-4 no-print"
        title="Demo company: sample data, read-only"
        actions={
          can('companies.manage') && (
            <Button variant="primary" size="sm" icon={<Building2 className="w-3.5 h-3.5" />} onClick={() => navigate('/companies')}>
              Add your company
            </Button>
          )
        }
      >
        Every figure here comes from the bundled demo workbooks for a fictional manufacturer, imported through the same pipeline your
        own files will use. Explore any module and click a figure to drill down to its vouchers. To work with your own numbers, create
        your company and import its Excel files.
      </Callout>
    );
  }

  return null;
}

export function AppShell() {
  const location = useLocation();
  const { selectedCompany: company } = useApp();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dhyeya_nav_collapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('dhyeya_nav_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  // A route change should never leave the drawer open behind the new page.
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const current = findNavItem(location.pathname);
  const segments = location.pathname.split('/').filter(Boolean);
  const isNested = segments.length > 1;

  return (
    <div className="min-h-screen flex bg-page">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className={cx('flex-1 min-w-0 flex flex-col')}>
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />

        <main className="flex-1 px-3 sm:px-5 lg:px-6 py-5 max-w-[1560px] w-full mx-auto">
          {(isNested || (current && current.path !== '/')) && (
            <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-ink-muted no-print">
              <Link to="/" className="inline-flex items-center gap-1 hover:text-ink transition-colors">
                <Home className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{company?.name ?? 'ArthSetu'}</span>
              </Link>
              {current && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-ink-subtle" />
                  <span className={cx(isNested ? 'hover:text-ink' : 'text-ink font-medium')}>
                    {isNested ? <Link to={current.path}>{current.label}</Link> : current.label}
                  </span>
                </>
              )}
              {isNested && segments.length > 1 && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-ink-subtle" />
                  <span className="text-ink font-medium capitalize">{decodeURIComponent(segments[segments.length - 1]).replace(/-/g, ' ')}</span>
                </>
              )}
            </nav>
          )}

          <SampleDataBanner />

          <Outlet />
        </main>

        <footer className="px-5 py-3.5 border-t border-line text-2xs text-ink-subtle no-print">
          <div className="max-w-[1560px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>
              ArthSetu - CEO Finance Dashboard. Management reports produced from imported accounting data; not audited financial
              statements.
            </span>
            <span>Data source: Excel Import</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
