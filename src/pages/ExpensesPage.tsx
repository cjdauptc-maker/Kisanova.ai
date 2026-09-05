import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Pencil, Trash2, TrendingDown, Calculator, SplitSquareHorizontal } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Expense, Farm, Plot, PaddyCrop, CropType, ExpenseCategory, ExpenseAllocation, ExpenseType, RecurrenceType, ExpensePaymentStatus } from '@/lib/types';
import { DEFAULT_EXPENSE_CATEGORIES, EXPENSE_TYPES, RECURRENCE_TYPES, EXPENSE_PAYMENT_STATUSES, PAYMENT_METHODS } from '@/lib/constants';
import { formatCurrency, formatDate, todayISO, num, formatFarmPlot } from '@/lib/format';
import { PageHeader, LoadingState, ErrorState } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DateRangeFilter, resolvePreset, type DateRange } from '@/components/DateRangeFilter';
import type { DateRangePreset } from '@/lib/constants';
import { calcReceivablesPayables } from '@/lib/financeCalc';

interface AllocRow {
  id?: string;
  farm_id: string;
  plot_id: string;
  paddy_crop_id: string;
  amount: string;
  notes: string;
}

export function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [allocations, setAllocations] = useState<Record<string, ExpenseAllocation[]>>({});
  const [farms, setFarms] = useState<Farm[]>([]);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [crops, setCrops] = useState<PaddyCrop[]>([]);
  const [cropTypes, setCropTypes] = useState<CropType[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false);

  // filters
  const [preset, setPreset] = useState<DateRangePreset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [farmFilter, setFarmFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [eRes, fRes, pRes, cRes, ctRes, catRes, allocRes] = await Promise.all([
      supabase.from('expenses').select('*').order('date', { ascending: false }),
      supabase.from('farms').select('id, name').order('name'),
      supabase.from('plots').select('id, name, farm_id').order('name'),
      supabase.from('paddy_crops').select('id, season_year, variety').order('created_at', { ascending: false }),
      supabase.from('crop_types').select('*').order('name'),
      supabase.from('expense_categories').select('*').order('name'),
      supabase.from('expense_allocations').select('*'),
    ]);
    if (eRes.error) setError(eRes.error.message);
    else setExpenses(eRes.data ?? []);
    if (fRes.data) setFarms(fRes.data as Farm[]);
    if (pRes.data) setPlots(pRes.data as Plot[]);
    if (cRes.data) setCrops(cRes.data as PaddyCrop[]);
    if (ctRes.data) setCropTypes(ctRes.data as CropType[]);
    if (catRes.data) setCategories(catRes.data as ExpenseCategory[]);
    if (allocRes.data) {
      const map: Record<string, ExpenseAllocation[]> = {};
      (allocRes.data as ExpenseAllocation[]).forEach((a) => {
        if (!map[a.expense_id]) map[a.expense_id] = [];
        map[a.expense_id].push(a);
      });
      setAllocations(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (preset !== 'custom') {
      const r = resolvePreset(preset);
      setFrom(r.from);
      setTo(r.to);
    }
  }, [preset]);

  const farmName = (id: string | null) => farms.find((f) => f.id === id)?.name ?? '';
  const plotName = (id: string | null) => plots.find((p) => p.id === id)?.name ?? '';
  const cropLabel = (id: string | null) => {
    const c = crops.find((x) => x.id === id);
    return c ? `${c.season_year} · ${c.variety ?? 'Paddy'}` : '—';
  };

  const parentCategories = useMemo(
    () => categories.filter((c) => c.parent_id == null),
    [categories],
  );
  const subcategoriesFor = useCallback(
    (parentId: string | null) => categories.filter((c) => c.parent_id === parentId),
    [categories],
  );

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      if (farmFilter && e.farm_id !== farmFilter) return false;
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (statusFilter && e.payment_status !== statusFilter) return false;
      return true;
    });
  }, [expenses, from, to, farmFilter, categoryFilter, statusFilter]);

  const total = useMemo(
    () => filtered.reduce((sum, e) => sum + Number(e.total_amount ?? 0), 0),
    [filtered],
  );

  const { totalPayables } = useMemo(
    () => calcReceivablesPayables(filtered, []),
    [filtered],
  );

  const save = async (data: Partial<Expense>, allocRows: AllocRow[]) => {
    setBusy(true);
    try {
      let expenseId = editing?.id;
      if (editing) {
        const { error } = await supabase.from('expenses').update(data).eq('id', editing.id);
        if (error) { setError(error.message); setBusy(false); return; }
      } else {
        const { data: inserted, error } = await supabase.from('expenses').insert(data).select().single();
        if (error) { setError(error.message); setBusy(false); return; }
        expenseId = (inserted as Expense).id;
      }
      if (expenseId) {
        await supabase.from('expense_allocations').delete().eq('expense_id', expenseId);
        const valid = allocRows.filter((r) => r.amount && Number(r.amount) > 0);
        if (valid.length > 0) {
          const rows = valid.map((r) => ({
            expense_id: expenseId,
            farm_id: r.farm_id || null,
            plot_id: r.plot_id || null,
            paddy_crop_id: r.paddy_crop_id || null,
            amount: Number(r.amount),
            notes: r.notes.trim() || null,
          }));
          const { error: allocErr } = await supabase.from('expense_allocations').insert(rows);
          if (allocErr) setError(allocErr.message);
        }
      }
    } catch (err) {
      setError(String(err));
    }
    setBusy(false);
    setModal(false);
    setEditing(null);
    load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const { error } = await supabase.from('expenses').delete().eq('id', deleting.id);
    if (error) setError(error.message);
    setBusy(false);
    setDeleting(null);
    load();
  };

  if (loading) return <LoadingState />;

  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Expenses"
        subtitle="Track farm expenses by category, farm, plot and crop."
        actions={
          <Button onClick={() => { setEditing(null); setModal(true); }}>
            <Plus className="h-4 w-4" /> Add expense
          </Button>
        }
      />
      {error && <ErrorState message={error} />}

      {expenses.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TrendingDown className="h-7 w-7" />}
            title="No expenses recorded"
            description="Add your first expense to start tracking farm costs."
            action={<Button onClick={() => setModal(true)}><Plus className="h-4 w-4" /> Add expense</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-4 mb-5">
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <Calculator className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Total expenses (filtered)</p>
                  <p className="text-2xl font-bold text-stone-800">{formatCurrency(total)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <SplitSquareHorizontal className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Outstanding payables</p>
                  <p className="text-2xl font-bold text-stone-800">{formatCurrency(totalPayables)}</p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-4 mb-5">
            <div className="flex flex-wrap items-end gap-3">
              <DateRangeFilter
                preset={preset}
                from={from}
                to={to}
                onPresetChange={setPreset}
                onFromChange={setFrom}
                onToChange={setTo}
              />
              <div className="w-44">
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Farm</label>
                <Select value={farmFilter} onChange={(e) => setFarmFilter(e.target.value)}>
                  <option value="">All farms</option>
                  {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              </div>
              <div className="w-44">
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Category</label>
                <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="">All categories</option>
                  {parentCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </Select>
              </div>
              <div className="w-40">
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Payment status</label>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  {EXPENSE_PAYMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </div>
              {(preset !== 'all' || farmFilter || categoryFilter || statusFilter) && (
                <button
                  onClick={() => { setPreset('all'); setFrom(''); setTo(''); setFarmFilter(''); setCategoryFilter(''); setStatusFilter(''); }}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium pb-2"
                >
                  Clear filters
                </button>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                    <th className="text-left px-4 py-3 font-medium">Category</th>
                    <th className="text-left px-4 py-3 font-medium">Subcategory</th>
                    <th className="text-left px-4 py-3 font-medium">Description</th>
                    <th className="text-left px-4 py-3 font-medium">Farm / Plot</th>
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-right px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filtered.map((e) => {
                    const allocs = allocations[e.id] ?? [];
                    return (
                      <tr key={e.id} className="hover:bg-stone-50/60">
                        <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{formatDate(e.date)}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 text-xs font-medium">
                            {e.category || '—'}
                          </span>
                          {allocs.length > 0 && (
                            <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 text-[10px] font-medium" title={`${allocs.length} allocations`}>
                              <SplitSquareHorizontal className="h-3 w-3" />
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-stone-500 text-xs">{e.subcategory || '—'}</td>
                        <td className="px-4 py-3 text-stone-700 max-w-xs truncate">{e.description || '—'}</td>
                        <td className="px-4 py-3 text-stone-500 whitespace-nowrap">{formatFarmPlot(farmName(e.farm_id), plotName(e.plot_id))}</td>
                        <td className="px-4 py-3 text-stone-500 text-xs">{e.expense_type === 'capital' ? 'Capital' : 'Operating'}</td>
                        <td className="px-4 py-3">
                          <PaymentBadge status={e.payment_status} />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-stone-800 whitespace-nowrap">{formatCurrency(e.total_amount)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <button onClick={() => { setEditing(e); setModal(true); }} className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button onClick={() => setDeleting(e)} className="p-1.5 rounded-lg text-stone-400 hover:text-rose-500 hover:bg-rose-50">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <ExpenseFormModal
        open={modal}
        onClose={() => { setModal(false); setEditing(null); }}
        onSave={save}
        editing={editing}
        farms={farms}
        plots={plots}
        crops={crops}
        cropTypes={cropTypes}
        categories={categories}
        parentCategories={parentCategories}
        subcategoriesFor={subcategoriesFor}
        existingAllocations={editing ? (allocations[editing.id] ?? []) : []}
        busy={busy}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete expense"
        message="Delete this expense record? This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        loading={busy}
      />
    </div>
  );
}

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' },
    partially_paid: { label: 'Partial', cls: 'bg-amber-50 text-amber-700' },
    unpaid: { label: 'Unpaid', cls: 'bg-rose-50 text-rose-700' },
  };
  const m = map[status] ?? map.paid;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

interface ExpenseFormModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Expense>, allocRows: AllocRow[]) => void;
  editing: Expense | null;
  farms: Farm[];
  plots: Plot[];
  crops: PaddyCrop[];
  cropTypes: CropType[];
  categories: ExpenseCategory[];
  parentCategories: ExpenseCategory[];
  subcategoriesFor: (parentId: string | null) => ExpenseCategory[];
  existingAllocations: ExpenseAllocation[];
  busy: boolean;
}

function ExpenseFormModal({
  open, onClose, onSave, editing, farms, plots, crops, cropTypes, categories,
  parentCategories, subcategoriesFor, existingAllocations, busy,
}: ExpenseFormModalProps) {
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [description, setDescription] = useState('');
  const [farmId, setFarmId] = useState('');
  const [plotId, setPlotId] = useState('');
  const [cropId, setCropId] = useState('');
  const [cropTypeId, setCropTypeId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [manualTotal, setManualTotal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [vendor, setVendor] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [expenseType, setExpenseType] = useState<ExpenseType>('operating');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('one_time');
  const [recurrenceInterval, setRecurrenceInterval] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<ExpensePaymentStatus>('paid');
  const [amountPaid, setAmountPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [allocRows, setAllocRows] = useState<AllocRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(editing?.date ?? todayISO());
    setCategory(editing?.category ?? (parentCategories[0]?.name ?? DEFAULT_EXPENSE_CATEGORIES[0]));
    setSubcategory(editing?.subcategory ?? '');
    setDescription(editing?.description ?? '');
    setFarmId(editing?.farm_id ?? '');
    setPlotId(editing?.plot_id ?? '');
    setCropId(editing?.paddy_crop_id ?? '');
    setCropTypeId(editing?.crop_type_id ?? '');
    setQuantity(editing?.quantity != null ? String(editing.quantity) : '');
    setUnit(editing?.unit ?? '');
    setUnitCost(editing?.unit_cost != null ? String(editing.unit_cost) : '');
    setTotalAmount(editing?.total_amount != null ? String(editing.total_amount) : '');
    setManualTotal(editing?.quantity == null && editing?.unit_cost == null && editing?.total_amount != null);
    setPaymentMethod(editing?.payment_method ?? '');
    setVendor(editing?.vendor ?? '');
    setInvoiceRef(editing?.invoice_ref ?? '');
    setExpenseType((editing?.expense_type ?? 'operating') as ExpenseType);
    setRecurrenceType((editing?.recurrence_type ?? 'one_time') as RecurrenceType);
    setRecurrenceInterval(editing?.recurrence_interval != null ? String(editing.recurrence_interval) : '');
    setPaymentStatus((editing?.payment_status ?? 'paid') as ExpensePaymentStatus);
    setAmountPaid(editing?.amount_paid != null ? String(editing.amount_paid) : '');
    setNotes(editing?.notes ?? '');
    setAllocRows(
      existingAllocations.map((a) => ({
        id: a.id,
        farm_id: a.farm_id ?? '',
        plot_id: a.plot_id ?? '',
        paddy_crop_id: a.paddy_crop_id ?? '',
        amount: String(a.amount),
        notes: a.notes ?? '',
      })),
    );
    setErr(null);
  }, [open, editing, parentCategories, existingAllocations]);

  const computedTotal = useMemo(() => {
    const q = Number(quantity);
    const uc = Number(unitCost);
    if (quantity !== '' && unitCost !== '' && !Number.isNaN(q) && !Number.isNaN(uc)) return q * uc;
    return null;
  }, [quantity, unitCost]);

  const displayTotal = manualTotal ? totalAmount : computedTotal != null ? String(computedTotal) : totalAmount;

  const allocTotal = useMemo(
    () => allocRows.reduce((s, r) => s + (r.amount ? Number(r.amount) : 0), 0),
    [allocRows],
  );

  const submit = () => {
    if (!date) { setErr('Date is required.'); return; }
    const total = manualTotal ? Number(totalAmount) : computedTotal ?? Number(totalAmount);
    if (total == null || Number.isNaN(total)) { setErr('Enter quantity & unit cost, or a manual total amount.'); return; }
    if (total < 0) { setErr('Total amount cannot be negative.'); return; }
    if (quantity && Number(quantity) < 0) { setErr('Quantity cannot be negative.'); return; }
    if (unitCost && Number(unitCost) < 0) { setErr('Unit cost cannot be negative.'); return; }

    if (allocRows.length > 0 && allocTotal > total) {
      setErr(`Total allocation (${formatCurrency(allocTotal)}) exceeds the expense amount (${formatCurrency(total)}).`);
      return;
    }

    let paid = amountPaid ? Number(amountPaid) : null;
    let due: number | null = null;
    if (paymentStatus === 'paid') {
      paid = paid != null && paid > 0 ? paid : total;
      due = 0;
    } else if (paymentStatus === 'unpaid') {
      paid = 0;
      due = total;
    } else if (paymentStatus === 'partially_paid') {
      if (paid == null || paid <= 0) { setErr('Amount paid must be greater than zero for partially paid status.'); return; }
      if (paid >= total) { setErr('Amount paid must be less than the total for partially paid status.'); return; }
      due = Math.max(0, total - paid);
    }
    if (paid != null && paid > total) { setErr('Amount paid cannot exceed the total amount.'); return; }

    onSave({
      date,
      category,
      subcategory: subcategory || null,
      description: description.trim() || null,
      farm_id: farmId || null,
      plot_id: plotId || null,
      paddy_crop_id: cropId || null,
      crop_type_id: cropTypeId || null,
      quantity: quantity === '' ? null : Number(quantity),
      unit: unit.trim() || null,
      unit_cost: unitCost === '' ? null : Number(unitCost),
      total_amount: total,
      payment_method: paymentMethod || null,
      vendor: vendor.trim() || null,
      invoice_ref: invoiceRef.trim() || null,
      expense_type: expenseType,
      recurrence_type: recurrenceType,
      recurrence_interval: recurrenceInterval ? Number(recurrenceInterval) : null,
      payment_status: paymentStatus,
      amount_paid: paid,
      amount_due: due,
      notes: notes.trim() || null,
    }, allocRows);
  };

  const filteredPlots = farmId ? plots.filter((p) => p.farm_id === farmId) : plots;
  const currentParent = categories.find((c) => c.name === category && c.parent_id == null);
  const subs = currentParent ? subcategoriesFor(currentParent.id) : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit expense' : 'Add expense'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</Button>
        </>
      }
    >
      {err && <div className="mb-3 text-sm text-rose-600">{err}</div>}
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Date" required>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Category" required>
            <Select value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory(''); }}>
              {parentCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Subcategory">
            <Select value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
              <option value="">—</option>
              {subs.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Expense type">
            <Select value={expenseType} onChange={(e) => setExpenseType(e.target.value as ExpenseType)}>
              {EXPENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this expense for?" />
        </Field>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Farm">
            <Select value={farmId} onChange={(e) => { setFarmId(e.target.value); setPlotId(''); }}>
              <option value="">None</option>
              {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Plot">
            <Select value={plotId} onChange={(e) => setPlotId(e.target.value)}>
              <option value="">None</option>
              {filteredPlots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Crop (paddy)">
            <Select value={cropId} onChange={(e) => setCropId(e.target.value)}>
              <option value="">None</option>
              {crops.map((c) => <option key={c.id} value={c.id}>{c.season_year} · {c.variety ?? 'Paddy'}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Quantity">
            <TextInput type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} min={0} step="any" />
          </Field>
          <Field label="Unit">
            <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, litre, hour" />
          </Field>
          <Field label="Unit cost">
            <TextInput type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} min={0} step="any" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 items-end">
          <Field
            label="Total amount"
            hint={manualTotal ? 'Manual entry' : computedTotal != null ? 'Auto-calculated' : 'Enter qty & unit cost or switch to manual'}
          >
            <TextInput
              type="number"
              value={displayTotal}
              onChange={(e) => setTotalAmount(e.target.value)}
              min={0}
              step="any"
              readOnly={!manualTotal && computedTotal != null}
            />
          </Field>
          <label className="flex items-center gap-3 cursor-pointer pb-2">
            <input type="checkbox" checked={manualTotal} onChange={(e) => setManualTotal(e.target.checked)} className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500" />
            <span className="text-sm text-stone-700">Enter total manually</span>
          </label>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Vendor / supplier">
            <TextInput value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Local seed shop" />
          </Field>
          <Field label="Invoice / reference">
            <TextInput value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
          </Field>
          <Field label="Payment method">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Payment status">
            <Select value={paymentStatus} onChange={(e) => {
              const newStatus = e.target.value as ExpensePaymentStatus;
              setPaymentStatus(newStatus);
              const t = manualTotal ? Number(totalAmount) : computedTotal ?? Number(totalAmount);
              if (newStatus === 'paid' && !amountPaid) setAmountPaid(String(t));
              if (newStatus === 'unpaid') setAmountPaid('0');
            }}>
              {EXPENSE_PAYMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Amount paid">
            <TextInput type="number" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} min={0} step="any" />
          </Field>
          <Field label="Recurrence">
            <Select value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}>
              {RECURRENCE_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Interval">
            <TextInput type="number" value={recurrenceInterval} onChange={(e) => setRecurrenceInterval(e.target.value)} min={1} step="any" />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {/* Allocation panel */}
        <div className="border border-stone-200 rounded-xl p-4 bg-stone-50/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <SplitSquareHorizontal className="h-4 w-4 text-stone-500" />
              <h4 className="text-sm font-semibold text-stone-700">Cost allocation (optional)</h4>
            </div>
            <button
              onClick={() => setAllocRows([...allocRows, { farm_id: '', plot_id: '', paddy_crop_id: '', amount: '', notes: '' }])}
              className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
            >
              + Add allocation
            </button>
          </div>
          {allocRows.length === 0 ? (
            <p className="text-xs text-stone-400">Split this expense across multiple crops or plots. Leave empty if the expense is general.</p>
          ) : (
            <div className="space-y-2">
              {allocRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                  <div>
                    <label className="block text-[10px] text-stone-400 mb-0.5">Crop (paddy)</label>
                    <Select value={row.paddy_crop_id} onChange={(e) => { const r = [...allocRows]; r[idx] = { ...r[idx], paddy_crop_id: e.target.value }; setAllocRows(r); }}>
                      <option value="">None</option>
                      {crops.map((c) => <option key={c.id} value={c.id}>{c.season_year} · {c.variety ?? 'Paddy'}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-stone-400 mb-0.5">Farm</label>
                    <Select value={row.farm_id} onChange={(e) => { const r = [...allocRows]; r[idx] = { ...r[idx], farm_id: e.target.value }; setAllocRows(r); }}>
                      <option value="">None</option>
                      {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-stone-400 mb-0.5">Plot</label>
                    <Select value={row.plot_id} onChange={(e) => { const r = [...allocRows]; r[idx] = { ...r[idx], plot_id: e.target.value }; setAllocRows(r); }}>
                      <option value="">None</option>
                      {plots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-stone-400 mb-0.5">Amount</label>
                    <TextInput type="number" value={row.amount} onChange={(e) => { const r = [...allocRows]; r[idx] = { ...r[idx], amount: e.target.value }; setAllocRows(r); }} min={0} step="any" />
                  </div>
                  <button onClick={() => setAllocRows(allocRows.filter((_, i) => i !== idx))} className="text-xs text-rose-500 hover:text-rose-600 pb-2">
                    Remove
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-stone-500">
                  Allocated: <span className={allocTotal > (num(displayTotal) ?? 0) ? 'text-rose-600 font-semibold' : 'text-stone-700 font-semibold'}>{formatCurrency(allocTotal)}</span>
                  {' / '}{formatCurrency(num(displayTotal) ?? 0)}
                </span>
                {allocTotal > (num(displayTotal) ?? 0) && <span className="text-xs text-rose-600 font-medium">Exceeds expense amount</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
