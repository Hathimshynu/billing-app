import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, Columns3Icon, DownloadIcon, SearchIcon, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { exportCsv, exportJson, exportPdf, exportXlsx, type ExportColumn, type ExportRow } from '@/lib/export';
import { EmptyState, LoadingRows } from './page';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting and exports. */
  value?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  /** Hidden below the md breakpoint (keeps phone tables readable). */
  hideOnMobile?: boolean;
  defaultHidden?: boolean;
  className?: string;
  numeric?: boolean;
  exportHeader?: string;
}

export interface DataTableProps<T> {
  data: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchPlaceholder?: string;
  /** Text searched by the search box. */
  searchText?: (row: T) => string;
  toolbar?: ReactNode;
  pageSize?: number;
  empty?: { icon: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode };
  exportName?: string;
  initialSort?: { id: string; desc: boolean };
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
  dense?: boolean;
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  onRowClick,
  searchPlaceholder,
  searchText,
  toolbar,
  pageSize = 25,
  empty,
  exportName,
  initialSort,
  rowClassName,
  footer,
  dense,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)));

  const visible = columns.filter((c) => !hidden.has(c.id));

  const filtered = useMemo(() => {
    if (!data) return undefined;
    const q = query.trim().toLowerCase();
    let rows = q && searchText ? data.filter((row) => searchText(row).toLowerCase().includes(q)) : data;
    if (sort) {
      const column = columns.find((c) => c.id === sort.id);
      if (column?.value) {
        const value = column.value;
        rows = [...rows].sort((a, b) => {
          const va = value(a);
          const vb = value(b);
          if (va === vb) return 0;
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
          return sort.desc ? -cmp : cmp;
        });
      }
    }
    return rows;
  }, [data, query, sort, columns, searchText]);

  const pageCount = filtered ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered?.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  const exportColumns: ExportColumn[] = columns.filter((c) => c.value).map((c) => ({ key: c.id, header: c.exportHeader ?? (typeof c.header === 'string' ? c.header : c.id), numeric: c.numeric }));
  const exportRows = (): ExportRow[] => (filtered ?? []).map((row) => Object.fromEntries(columns.filter((c) => c.value).map((c) => [c.id, c.value!(row) ?? null])));

  const toggleSort = (column: Column<T>) => {
    if (!column.value || column.sortable === false) return;
    setSort((current) => (current?.id === column.id ? (current.desc ? null : { id: column.id, desc: true }) : { id: column.id, desc: false }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {searchText ? (
          <InputGroup className="sm:max-w-xs">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder ?? t('common.search', 'Search')}
              aria-label={searchPlaceholder ?? t('common.search', 'Search')}
            />
          </InputGroup>
        ) : null}
        <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label={t('table.columns', 'Columns')}>
                <Columns3Icon /> <span className="hidden sm:inline">{t('table.columns', 'Columns')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('table.visible_columns', 'Visible columns')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={!hidden.has(c.id)}
                  onCheckedChange={(checked) =>
                    setHidden((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                >
                  {typeof c.header === 'string' ? c.header : c.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {exportName ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <DownloadIcon /> <span className="hidden sm:inline">{t('common.export', 'Export')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportCsv(exportName, exportColumns, exportRows())}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportXlsx(exportName, exportName, exportColumns, exportRows())}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportPdf(exportName, exportName, exportColumns, exportRows())}>PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportJson(exportName, exportRows())}>JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {!filtered ? (
        <LoadingRows />
      ) : filtered.length === 0 ? (
        empty ? (
          <EmptyState icon={empty.icon} title={query ? t('table.no_matches', 'No matches') : empty.title} description={query ? t('table.try_another', 'Try a different search.') : empty.description} action={query ? undefined : empty.action} />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('table.no_data', 'Nothing to show yet.')}</p>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="max-h-[70dvh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
                <TableRow>
                  {visible.map((c) => (
                    <TableHead
                      key={c.id}
                      className={cn(c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.hideOnMobile && 'hidden md:table-cell', c.className)}
                      aria-sort={sort?.id === c.id ? (sort.desc ? 'descending' : 'ascending') : undefined}
                    >
                      {c.value && c.sortable !== false ? (
                        <button type="button" onClick={() => toggleSort(c)} className={cn('inline-flex items-center gap-1 hover:text-foreground', c.align === 'right' && 'flex-row-reverse')}>
                          {c.header}
                          {sort?.id === c.id ? sort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" /> : <ArrowUpDownIcon className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        c.header
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows!.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row))}
                  >
                    {visible.map((c) => (
                      <TableCell
                        key={c.id}
                        className={cn(dense ? 'py-1.5' : 'py-2.5', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.numeric && 'money', c.hideOnMobile && 'hidden md:table-cell', c.className)}
                      >
                        {c.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {footer}
          {pageCount > 1 ? (
            <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
              <span>
                {t('table.showing', 'Showing')} {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, filtered.length)} {t('table.of', 'of')} {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label={t('table.previous', 'Previous page')}>
                  <ChevronLeftIcon />
                </Button>
                <span className="tabular-nums">
                  {currentPage + 1} / {pageCount}
                </span>
                <Button variant="ghost" size="icon-sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} aria-label={t('table.next', 'Next page')}>
                  <ChevronRightIcon />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
