import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Pencil, Trash2, TrendingUp, Calculator, Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Income, Farm, Plot, PaddyCrop, CropType, IncomeType, IncomePaymentStatus } from '@/lib/types';
import { INCOME_TYPES, INCOME_PAYMENT_STATUSES, PAYMENT_METHODS, type DateRangePreset } from '@/lib/constants';
import { formatCurrency, formatDate, todayISO, num, formatFarmPlot } from '@/lib/format';
import { PageHeader, LoadingState, ErrorState } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DateRangeFilter, resolvePreset } from '@/components/DateRangeFilter';
import { calcReceivablesPayables } from '@/lib/financeCalc';

export function IncomePage() {
  const [items, setItems] = useState<Income[]>([]);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [crops, setCrops] = useState<PaddyCrop[]>([]);
  const [cropTypes, setCropTypes] = useState<CropType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [deleting, setDeleting] = useState<Income | null>(null);
  const [busy, setBusy] = useState(false);

  const [preset, setPreset] = useState<DateRangePreset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [farmFilter, setFarmFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [iRes, fRes, pRes, cRes, ctRes] = await Promise.all([
      supabase.from('income').select('*').order('date', { ascending: false }),
      supabase.from('farms').select('id, name').order('name'),
      supabase.from('plots').select('id, name, farm_id').order('name'),
      supabase.from('paddy_crops').select('id, season_year, variety').order('created_at', { ascending: false }),
      supabase.from('crop_types').select('*').order('name'),
    ]);
    if (iRes.error) setError(iRes.error.message);
    else setItems(iRes.data ?? []);
    if (fRes.data) setFarms(fRes.data as Farm[]);
    if (pRes.data) setPlots(pRes.data as Plot[]);
    if (cRes.data) setCrops(cRes.data as PaddyCrop[]);
    if (ctRes.data) setCropTypes(ctRes.data as CropType[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (preset !== 'custom') {
      const r = resolvePreset(preset);
      setFrom(r.from);
      setTo(r.to);
    }
  }, [preset]);

  const farmName = (id: string | null) => farms.find((f) => f.id === id)?.name ?? '';
  const plotName = (id: string | null) => plots.find((p) => p.id === id)?.name ?? '';

  const filtered = useMemo(() => {
    return items.filter((e) => {
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      if (farmFilter && e.farm_id !== farmFilter) return false;
      if (productFilter && !e.product.toLowerCase().includes(productFilter.toLowerCase())) return false;
      if (statusFilter && e.payment_status !== statusFilter) return false;
      return true;
    });
  }, [items, from, to, farmFilter, productFilter, statusFilter]);

  const total = useMemo(
    () => filtered.reduce((sum, e) => sum + Number(e.total_income ?? 0), 0),
    [filtered],
  );

  const { totalReceivables } = useMemo(
    () => calcReceivablesPayables([], filtered),
    [filtered],
  );

  const save = async (data: Partial<Income>) => {
    setBusy(true);
    if (editing) {
      const { error } = await supabase.from('income').update(data).eq('id', editing.id);
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.from('income').insert(data);
      if (error) setError(error.message);
    }
    setBusy(false);
    setModal(false);
    setEditing(null);
    load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const { error } = await supabase.from('income').delete().eq('id', deleting.id);
    if (error) setError(error.message);
    setBusy(false);
    setDeleting(null);
    load();
  };

  if (loading) return <LoadingState />;

  return (
    <div className="animate-fadeIn">
      <PageHeader
        title="Income"
        subtitle="Record sales and farm income by product, farm and plot."
        actions={<Button onClick={() => { setEditing(null); setModal(true); }}><Plus className="h-4 w-4" /> Add income</Button>}
      />
      {error && <ErrorState message={error} />}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TrendingUp className="h-7 w-7" />}
            title="No income recorded"
            description="Add your first income entry to start tracking farm revenue."
            action={<Button onClick={() => setModal(true)}><Plus className="h-4 w-4" /> Add income</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-4 mb-5">
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Calculator className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Total income (filtered)</p>
                  <p className="text-2xl font-bold text-stone-800">{formatCurrency(total)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <Banknote className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-stone-500">Outstanding receivables</p>
                  <p className="text-2xl font-bold text-stone-800">{formatCurrency(totalReceivables)}</p>
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
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Product</label>
                <TextInput value={productFilter} onChange={(e) => setProductFilter(e.target.value)} placeholder="Search product" />
              </div>
              <div className="w-40">
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Payment status</label>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  {INCOME_PAYMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </div>
              {(preset !== 'all' || farmFilter || productFilter || statusFilter) && (
                <button
                  onClick={() => { setPreset('all'); setFrom(''); setTo(''); setFarmFilter(''); setProductFilter(''); setStatusFilter(''); }}
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
                    <th className="text-left px-4 py-3 font-medium">Product</th>
                    <th className="text-left px-4 py-3 font-medium">Buyer</th>
                    <th className="text-left px-4 py-3 font-medium">Farm / Plot</th>
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-right px-4 py-3 font-medium">Income</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filtered.map((e) => (
                    <tr key={e.id} className="hover:bg-stone-50/60">
                      <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="px-4 py-3 text-stone-700 font-medium">{e.product}</td>
                      <td className="px-4 py-3 text-stone-500">{e.buyer || '—'}</td>
                      <td className="px-4 py-3 text-stone-500 whitespace-nowrap">{formatFarmPlot(farmName(e.farm_id), plotName(e.plot_id))}</td>
                      <td className="px-4 py-3 text-stone-500 text-xs">{e.income_type === 'other' ? 'Other' : 'Sale'}</td>
                      <td className="px-4 py-3"><IncomeBadge status={e.payment_status} /></td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700 whitespace-nowrap">{formatCurrency(e.total_income)}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <IncomeFormModal
        open={modal}
        onClose={() => { setModal(false); setEditing(null); }}
        onSave={save}
        editing={editing}
        farms={farms}
        plots={plots}
        crops={crops}
        cropTypes={cropTypes}
        busy={busy}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete income"
        message="Delete this income record? This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        loading={busy}
      />
    </div>
  );
}

function IncomeBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    fully_received: { label: 'Received', cls: 'bg-emerald-50 text-emerald-700' },
    partially_received: { label: 'Partial', cls: 'bg-amber-50 text-amber-700' },
    pending: { label: 'Pending', cls: 'bg-rose-50 text-rose-700' },
  };
  const m = map[status] ?? map.fully_received;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

interface IncomeFormModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Income>) => void;
  editing: Income | null;
  farms: Farm[];
  plots: Plot[];
  crops: PaddyCrop[];
  cropTypes: CropType[];
  busy: boolean;
}

function IncomeFormModal({ open, onClose, onSave, editing, farms, plots, crops, cropTypes, busy }: IncomeFormModalProps) {
  const [date, setDate] = useState(todayISO());
  const [product, setProduct] = useState('');
  const [productCategory, setProductCategory] = useState('');
  const [incomeType, setIncomeType] = useState<IncomeType>('sale');
  const [cropId, setCropId] = useState('');
  const [cropTypeId, setCropTypeId] = useState('');
  const [farmId, setFarmId] = useState('');
  const [plotId, setPlotId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [totalIncome, setTotalIncome] = useState('');
  const [buyer, setBuyer] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<IncomePaymentStatus>('fully_received');
  const [amountReceived, setAmountReceived] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(editing?.date ?? todayISO());
    setProduct(editing?.product ?? '');
    setProductCategory(editing?.product_category ?? '');
    setIncomeType((editing?.income_type ?? 'sale') as IncomeType);
    setCropId(editing?.paddy_crop_id ?? '');
    setCropTypeId(editing?.crop_type_id ?? '');
    setFarmId(editing?.farm_id ?? '');
    setPlotId(editing?.plot_id ?? '');
    setQuantity(editing?.quantity != null ? String(editing.quantity) : '');
    setUnit(editing?.unit ?? '');
    setPricePerUnit(editing?.price_per_unit != null ? String(editing.price_per_unit) : '');
    setTotalIncome(editing?.total_income != null ? String(editing.total_income) : '');
    setBuyer(editing?.buyer ?? '');
    setPaymentMethod(editing?.payment_method ?? '');
    setInvoiceRef(editing?.invoice_ref ?? '');
    setPaymentStatus((editing?.payment_status ?? 'fully_received') as IncomePaymentStatus);
    setAmountReceived(editing?.amount_received != null ? String(editing.amount_received) : '');
    setNotes(editing?.notes ?? '');
    setErr(null);
  }, [open, editing]);

  const computedTotal = useMemo(() => {
    const q = Number(quantity);
    const p = Number(pricePerUnit);
    if (quantity !== '' && pricePerUnit !== '' && !Number.isNaN(q) && !Number.isNaN(p)) return q * p;
    return null;
  }, [quantity, pricePerUnit]);

  const displayTotal = computedTotal != null ? String(computedTotal) : totalIncome;
  const balance = useMemo(() => {
    const t = num(displayTotal) ?? 0;
    const r = amountReceived ? Number(amountReceived) : 0;
    if (paymentStatus === 'fully_received') return 0;
    if (paymentStatus === 'pending') return t;
    return Math.max(0, t - r);
  }, [displayTotal, amountReceived, paymentStatus]);

  const submit = () => {
    if (!date) { setErr('Date is required.'); return; }
    if (!product.trim()) { setErr('Product is required.'); return; }
    const total = computedTotal ?? Number(totalIncome);
    if (total == null || Number.isNaN(total)) { setErr('Enter quantity & price per unit, or a manual total income.'); return; }
    if (total < 0) { setErr('Total income cannot be negative.'); return; }
    if (quantity && Number(quantity) < 0) { setErr('Quantity cannot be negative.'); return; }
    if (pricePerUnit && Number(pricePerUnit) < 0) { setErr('Selling price cannot be negative.'); return; }

    let received = amountReceived ? Number(amountReceived) : null;
    let due: number | null = null;
    if (paymentStatus === 'fully_received') {
      received = received != null && received > 0 ? received : total;
      due = 0;
    } else if (paymentStatus === 'pending') {
      received = 0;
      due = total;
    } else if (paymentStatus === 'partially_received') {
      if (received == null || received <= 0) { setErr('Amount received must be greater than zero for partially received status.'); return; }
      if (received >= total) { setErr('Amount received must be less than the total for partially received status.'); return; }
      due = Math.max(0, total - received);
    }
    if (received != null && received > total) { setErr('Amount received cannot exceed the total income.'); return; }

    onSave({
      date,
      product: product.trim(),
      product_category: productCategory.trim() || null,
      income_type: incomeType,
      paddy_crop_id: cropId || null,
      crop_type_id: cropTypeId || null,
      farm_id: farmId || null,
      plot_id: plotId || null,
      quantity: quantity === '' ? null : Number(quantity),
      unit: unit.trim() || null,
      price_per_unit: pricePerUnit === '' ? null : Number(pricePerUnit),
      total_income: total,
      buyer: buyer.trim() || null,
      payment_method: paymentMethod || null,
      invoice_ref: invoiceRef.trim() || null,
      payment_status: paymentStatus,
      amount_due: due,
      amount_received: received,
      notes: notes.trim() || null,
    });
  };

  const filteredPlots = farmId ? plots.filter((p) => p.farm_id === farmId) : plots;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit income' : 'Add income'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save income'}</Button>
        </>
      }
    >
      {err && <div className="mb-3 text-sm text-rose-600">{err}</div>}
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Date" required>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Product" required>
            <TextInput value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Paddy (Sali)" />
          </Field>
          <Field label="Product category">
            <TextInput value={productCategory} onChange={(e) => setProductCategory(e.target.value)} placeholder="e.g. Grain, Honey" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Income type">
            <Select value={incomeType} onChange={(e) => setIncomeType(e.target.value as IncomeType)}>
              {INCOME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Crop (paddy)">
            <Select value={cropId} onChange={(e) => setCropId(e.target.value)}>
              <option value="">None</option>
              {crops.map((c) => <option key={c.id} value={c.id}>{c.season_year} · {c.variety ?? 'Paddy'}</option>)}
            </Select>
          </Field>
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
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Quantity">
            <TextInput type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} min={0} step="any" />
          </Field>
          <Field label="Unit">
            <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, quintal" />
          </Field>
          <Field label="Selling price / unit">
            <TextInput type="number" value={pricePerUnit} onChange={(e) => setPricePerUnit(e.target.value)} min={0} step="any" />
          </Field>
        </div>

        <Field label="Total income" hint={computedTotal != null ? 'Auto-calculated' : 'Enter quantity & price per unit, or a manual total'}>
          <TextInput
            type="number"
            value={displayTotal}
            onChange={(e) => setTotalIncome(e.target.value)}
            min={0}
            step="any"
            readOnly={computedTotal != null}
          />
        </Field>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Buyer / customer">
            <TextInput value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="e.g. Local mill" />
          </Field>
          <Field label="Payment method">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Invoice / reference">
            <TextInput value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Payment status">
            <Select value={paymentStatus} onChange={(e) => {
              const newStatus = e.target.value as IncomePaymentStatus;
              setPaymentStatus(newStatus);
              const t = computedTotal ?? Number(totalIncome);
              if (newStatus === 'fully_received' && !amountReceived) setAmountReceived(String(t));
              if (newStatus === 'pending') setAmountReceived('0');
            }}>
              {INCOME_PAYMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Amount received">
            <TextInput type="number" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} min={0} step="any" />
          </Field>
          <Field label="Balance (receivable)">
            <TextInput type="text" value={formatCurrency(balance)} readOnly className="bg-stone-50 font-semibold text-stone-700" />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
