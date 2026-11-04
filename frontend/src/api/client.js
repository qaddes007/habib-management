export const API_BASE = window.appSecurity?.apiBaseUrl || '/api';

const API_CACHE_PREFIX = 'habib-api-cache:v1:';
const OUTBOX_KEY = 'habib-offline-outbox:v1';
const BILL_ID_MAP_KEY = 'habib-offline-bill-ids:v1';
const OUTBOX_EVENT = 'habib-outbox';
const SYNC_EVENT = 'habib-sync';
let apiOnline = true;
let outboxSyncInProgress = false;

export function isApiOnline() {
  return apiOnline;
}

export function setApiOnline(online) {
  apiOnline = online;
}

function readOutbox() {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
  } catch (error) {
    console.warn('Could not read pending offline changes:', error);
    return [];
  }
}

function saveOutbox(outbox) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
}

export function getPendingChanges() {
  return readOutbox().map(({ id, kind, queuedAt, failed }) => ({ id, kind, queuedAt, failed }));
}

function readBillIdMap() {
  try {
    return JSON.parse(localStorage.getItem(BILL_ID_MAP_KEY) || '{}');
  } catch (error) {
    console.warn('Could not read offline bill number mappings:', error);
    return {};
  }
}

function apiUrl(url) {
  return new URL(API_BASE + url, window.location.href);
}

function queuedWriteKind(url, method, body) {
  if (method !== 'POST') return null;
  const parsed = apiUrl(url);
  const action = parsed.searchParams.get('action') || '';
  if (parsed.pathname.endsWith('/bills.php') && action === 'create') return 'bill';
  if (parsed.pathname.endsWith('/bills.php') && action === 'add_payment') return 'payment';
  if (parsed.pathname.endsWith('/expenses.php') && !action) return 'expense';
  if (parsed.pathname.endsWith('/stock.php') && ['add', 'update'].includes(action) && !body?.id) return 'stock';
  if (parsed.pathname.endsWith('/stock.php') && action === 'adjust' && Number(body?.id) > 0) return 'stock_adjust';
  return null;
}

function resolveLocalBillUrl(url) {
  const parsed = apiUrl(url);
  if (!parsed.pathname.endsWith('/bills.php') || parsed.searchParams.get('action') !== 'get') return url;
  const id = Number(parsed.searchParams.get('id'));
  const serverId = readBillIdMap()[id];
  if (serverId) parsed.searchParams.set('id', String(serverId));
  return parsed.pathname.replace(/^\/api/, '') + parsed.search;
}

function nextLocalId() {
  const previous = Number.parseInt(localStorage.getItem('habib-offline-next-id') || '0', 10);
  const next = previous + 1;
  localStorage.setItem('habib-offline-next-id', String(next));
  return -next;
}

function enqueueOfflineWrite(url, method, body, kind, mutationId = crypto.randomUUID()) {
  if (!kind) {
    throw new Error('Offline mein purani entries edit/delete nahi ho sakti. Internet reconnect karke dobara try karein.');
  }
  const localId = ['bill', 'expense', 'stock'].includes(kind) ? nextLocalId() : null;
  const operation = {
    id: mutationId,
    kind,
    method,
    url,
    body,
    queuedAt: new Date().toISOString(),
    ...(localId !== null ? { localId } : {}),
  };
  const outbox = readOutbox();
  outbox.push(operation);
  saveOutbox(outbox);

  if (kind === 'bill') return { success: true, bill_id: localId, sr_no: 'PENDING', pending: true };
  if (kind === 'expense' || kind === 'stock') return { success: true, id: localId, pending: true };
  return { success: true, pending: true };
}

function pendingError(response) {
  if (!response.ok) return `Server returned HTTP ${response.status}`;
  if (!response.data || response.data.error || response.data.success === false) {
    return response.data?.error || 'Server rejected the pending change';
  }
  return '';
}

function isTransientHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function syncPendingChanges() {
  if (outboxSyncInProgress || !apiOnline || navigator.onLine === false) return;
  outboxSyncInProgress = true;
  try {
    while (true) {
      const outbox = readOutbox();
      const operation = outbox[0];
      if (!operation || operation.failed) return;

      const body = { ...operation.body };
      if (operation.kind === 'payment' && Number(body.bill_id) < 0) {
        const serverBillId = readBillIdMap()[body.bill_id];
        if (!serverBillId) return;
        body.bill_id = Number(serverBillId);
      }

      let response;
      try {
        const appToken = window.appSecurity?.apiToken;
        const result = await fetch(API_BASE + operation.url, {
          method: operation.method,
          headers: {
            'Content-Type': 'application/json',
            'X-Offline-Mutation-Id': operation.id,
            ...(appToken ? { 'X-App-Token': appToken } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
        const text = await result.text();
        let data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = null;
          }
        }
        response = { ok: result.ok, status: result.status, data };
      } catch (error) {
        setApiOnline(false);
        return;
      }

      if (isTransientHttpStatus(response.status)) {
        setApiOnline(false);
        return;
      }

      const error = pendingError(response);
      if (error) {
        operation.failed = error;
        outbox[0] = operation;
        saveOutbox(outbox);
        window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
        return;
      }

      if (operation.kind === 'bill' && operation.localId) {
        const idMap = readBillIdMap();
        idMap[operation.localId] = response.data.bill_id;
        localStorage.setItem(BILL_ID_MAP_KEY, JSON.stringify(idMap));
      }
      outbox.shift();
      saveOutbox(outbox);
      setApiOnline(true);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { offlineWriteSynced: true } }));
    }
  } finally {
    outboxSyncInProgress = false;
  }
}

export function retryPendingChanges() {
  const outbox = readOutbox().map(operation => {
    const { failed, ...retryable } = operation;
    return retryable;
  });
  saveOutbox(outbox);
  if (apiOnline) return syncPendingChanges();
}

function calculatePendingBill(operation) {
  const payload = operation.body;
  const frames = (payload.frames || []).map((frame, index) => {
    const pcs = Math.max(1, Number.parseInt(frame.pcs, 10) || 1);
    const width = Number(frame.width) || 0;
    const length = Number(frame.length) || 0;
    const bend = (Number(frame.bend_rate) || 0) * (Number(frame.bend_count) || 0);
    const area = ['fancy', 'bending_only'].includes(frame.bill_category) ? 0 : width * length * pcs;
    let total = frame.bill_category === 'fancy'
      ? pcs * (Number(frame.direct_price) || 0)
      : frame.bill_category === 'bending_only'
        ? bend
        : area * (Number(frame.rate) || 0) + (frame.bill_category === 'bending_sheet' ? bend : 0);
    total += Number(frame.extra_item_price) || 0;
    return { ...frame, id: `pending-${index}`, serial: index + 1, area, total, tags: frame.tags || [] };
  });
  const grand = frames.reduce((sum, frame) => sum + frame.total, 0);
  const discount = Math.max(0, Number(payload.discount) || 0);
  const net = Math.max(0, grand - discount);
  const paid = Math.max(0, Number(payload.paid_amount) || 0);
  const payments = readOutbox()
    .filter(item => item.kind === 'payment' && Number(item.body.bill_id) === operation.localId)
    .map(item => ({ amount: Number(item.body.amount) || 0, note: item.body.note || 'Payment', paid_at: item.queuedAt, pending: true }));
  const totalPaid = paid + payments.reduce((sum, payment) => sum + payment.amount, 0);
  const personalExpenses = payload.personal_expenses || [];
  const personalTotal = personalExpenses.reduce((sum, expense) => sum + (Number(expense.cost) || 0), 0);

  return {
    id: operation.localId,
    sr_no: 'PENDING',
    client_name: payload.client_name,
    client_phone: payload.client_phone || '',
    created_at: operation.queuedAt.replace('T', ' ').slice(0, 19),
    grand_total: grand,
    discount,
    net_total: net,
    paid_amount: totalPaid,
    remaining_balance: Math.max(0, net - totalPaid),
    payment_status: totalPaid >= net ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID',
    notes: payload.notes || '',
    frames,
    frame_count: frames.length,
    payment_history: payments,
    personal_total: personalTotal,
    personal_expenses: personalExpenses,
    company: {},
    pending: true,
  };
}

function pendingBills() {
  return readOutbox().filter(item => item.kind === 'bill').map(calculatePendingBill);
}

function normalizePendingStockMaterial(material) {
  const value = String(material || '').trim();
  for (const base of ['MS-CNC', 'SS-CNC', 'SG-CNC', 'GP', 'MS-BLACK', 'SS-SILVER', 'SS-GOLDEN']) {
    if (value.toLowerCase() === base.toLowerCase() || value.toLowerCase().endsWith(base.toLowerCase())) {
      if (base === 'MS-BLACK') return 'MS-CNC';
      if (base === 'SS-SILVER') return 'SS-CNC';
      if (base === 'SS-GOLDEN') return 'SG-CNC';
      return base;
    }
  }
  return null;
}

function applyPendingStockChanges(rows, queue) {
  for (const operation of queue) {
    if (operation.kind === 'stock_adjust') {
      const existing = rows.find(row => Number(row.id) === Number(operation.body.id));
      if (existing) {
        existing.quantity = Math.max(0, (Number(existing.quantity) || 0) + (Number(operation.body.delta) || 0));
        existing.pending_changes = true;
      }
      continue;
    }

    if (operation.kind === 'stock') {
      const entry = operation.body;
      const existing = rows.find(row =>
        row.material === entry.material &&
        row.gauge === entry.gauge &&
        row.sheet_size === entry.sheet_size
      );
      if (existing) {
        existing.quantity = (Number(existing.quantity) || 0) + (Number(entry.quantity) || 0);
        existing.pending_changes = true;
      } else {
        rows.push({ ...entry, id: operation.localId, quantity: Number(entry.quantity) || 0, pending: true });
      }
      continue;
    }

    if (operation.kind !== 'bill') continue;
    for (const frame of operation.body.frames || []) {
      if (!['cnc_only', 'cnc_pipe', 'bending_sheet'].includes(frame.bill_category)) continue;
      const material = normalizePendingStockMaterial(frame.cnc_material || frame.material);
      if (!material) continue;

      const width = Number(frame.width) || 0;
      const length = Number(frame.length) || 0;
      const pieces = Math.max(1, Number.parseInt(frame.pcs, 10) || 1);
      const area = width * length * pieces;
      const sheetArea = { '4x8': 32, '5x8': 40, '4x10': 40, '5x10': 50 }[frame.sheet_size || '4x8'] || 32;
      const sheetsNeeded = area > 0 ? Math.round((area / sheetArea) * 100) / 100 : 0;
      if (sheetsNeeded <= 0) continue;

      const gauge = frame.cnc_gauge || frame.gauge || '';
      const gaugeNumber = String(gauge).replace(/[^0-9]/g, '');
      const size = frame.sheet_size || '4x8';
      const existing = rows.find(row =>
        row.material === material &&
        row.sheet_size === size &&
        (row.gauge === gauge || (gaugeNumber && (
          row.gauge === `${gaugeNumber} Gauge` ||
          String(row.gauge).includes(gaugeNumber)
        )))
      );
      if (existing) {
        existing.quantity = Math.max(0, (Number(existing.quantity) || 0) - sheetsNeeded);
        existing.pending_changes = true;
      }
    }
  }
}

function addQueuedChanges(url, response) {
  const parsed = apiUrl(url);
  const queue = readOutbox();
  const path = parsed.pathname;
  let result = response;
  try {
    result = JSON.parse(JSON.stringify(response));
  } catch {
    return response;
  }

  if (path.endsWith('/bills.php')) {
    const action = parsed.searchParams.get('action') || '';
    const id = Number(parsed.searchParams.get('id'));
    if (action === 'get' && id < 0) {
      const localBill = pendingBills().find(bill => bill.id === id);
      if (localBill) return { success: true, data: localBill, pending: true };
    }

    if (Array.isArray(result.data)) {
      const payments = queue.filter(item => item.kind === 'payment');
      result.data = result.data.map(bill => {
        const billPayments = payments.filter(item => Number(item.body.bill_id) === Number(bill.id));
        if (!billPayments.length) return bill;
        const amount = billPayments.reduce((sum, item) => sum + (Number(item.body.amount) || 0), 0);
        const paid = Number(bill.paid_amount || 0) + amount;
        const remaining = Math.max(0, Number(bill.net_total || 0) - paid);
        return { ...bill, paid_amount: paid, remaining_balance: remaining, payment_status: remaining === 0 ? 'PAID' : 'PARTIAL', pending_changes: true };
      });
    }

    if (action === 'get' && result.data && !Array.isArray(result.data)) {
      const billPayments = queue.filter(item =>
        item.kind === 'payment' && Number(item.body.bill_id) === Number(result.data.id)
      );
      if (billPayments.length) {
        const amount = billPayments.reduce((sum, item) => sum + (Number(item.body.amount) || 0), 0);
        const paid = Number(result.data.paid_amount || 0) + amount;
        const remaining = Math.max(0, Number(result.data.net_total || 0) - paid);
        result.data = {
          ...result.data,
          paid_amount: paid,
          remaining_balance: remaining,
          payment_status: remaining === 0 ? 'PAID' : 'PARTIAL',
          payment_history: [
            ...(result.data.payment_history || []),
            ...billPayments.map(item => ({
              amount: Number(item.body.amount) || 0,
              note: item.body.note || 'Payment',
              paid_at: item.queuedAt,
              pending: true,
            })),
          ],
          pending_changes: true,
        };
      }
    }

    if (action === 'list' && Array.isArray(result.data)) {
      const search = (parsed.searchParams.get('search') || '').toLowerCase();
      const status = parsed.searchParams.get('status') || '';
      const additions = pendingBills().filter(bill => {
        if (search && !`${bill.client_name} ${bill.client_phone} ${bill.sr_no}`.toLowerCase().includes(search)) return false;
        if (status && bill.payment_status !== status) return false;
        return true;
      });
      result.data = [...additions, ...result.data];
      result.total = (Number(result.total) || 0) + additions.length;
    }
  }

  if (path.endsWith('/expenses.php') && Array.isArray(result.data)) {
    const type = parsed.searchParams.get('type') || 'business';
    const from = parsed.searchParams.get('from') || '';
    const to = parsed.searchParams.get('to') || '';
    const additions = queue.filter(item =>
      item.kind === 'expense' &&
      (item.url.includes(`type=${type}`) || (!item.url.includes('type=') && type === 'business')) &&
      item.body.expense_date >= from &&
      item.body.expense_date <= to
    ).map(item => ({
      id: item.localId,
      description: item.body.description,
      amount: Number(item.body.amount) || 0,
      expense_date: item.body.expense_date,
      category: item.body.category || 'General',
      pending: true,
    }));
    result.data = [...additions, ...result.data];
    result.total = (Number(result.total) || 0) + additions.reduce((sum, item) => sum + item.amount, 0);
  }

  if (path.endsWith('/stock.php') && Array.isArray(result.data)) {
    applyPendingStockChanges(result.data, queue);
  }

  if (path.endsWith('/reports.php') && result.revenue) {
    const period = parsed.searchParams.get('period') || 'all';
    const now = new Date();
    const inPeriod = date => {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return false;
      if (period === 'all') return true;
      if (/^\d{4}-\d{2}$/.test(period)) {
        return d.getFullYear() === Number(period.slice(0, 4)) && d.getMonth() + 1 === Number(period.slice(5));
      }
      if (/^year:\d{4}$/.test(period)) return d.getFullYear() === Number(period.slice(5));
      if (period === 'monthly') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      if (period === 'daily') return d.toDateString() === now.toDateString() || d.toDateString() === new Date(now.getTime() - 86400000).toDateString();
      if (period === 'weekly') {
        const daysSinceSaturday = now.getDay() === 6 ? 0 : now.getDay() + 1;
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceSaturday);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        return d >= start && d < end;
      }
      return true;
    };
    const add = (key, amount) => { result.revenue[key] = (Number(result.revenue[key]) || 0) + amount; };
    for (const bill of pendingBills().filter(item => inPeriod(item.created_at))) {
      add('bill_count', 1);
      add('gross_total', Number(bill.grand_total) || 0);
      add('total_discount', Number(bill.discount) || 0);
      add('net_total', Number(bill.net_total) || 0);
      add('total_paid', Number(bill.paid_amount) || 0);
      add('total_remaining', Number(bill.remaining_balance) || 0);
      add('bill_personal', Number(bill.personal_total) || 0);
      result.personal_expenses = (Number(result.personal_expenses) || 0) + (Number(bill.personal_total) || 0);
      result.profit = (Number(result.profit) || 0) + (Number(bill.paid_amount) || 0) - (Number(bill.personal_total) || 0);
      result.recent_bills = [{ ...bill, pending: true }, ...(result.recent_bills || [])];

      result.by_client = result.by_client || [];
      let client = result.by_client.find(row => row.client_name === bill.client_name);
      if (!client) {
        client = { client_name: bill.client_name, bills: 0, net_total: 0, paid: 0, remaining: 0, last_date: bill.created_at };
        result.by_client.push(client);
      }
      client.bills = (Number(client.bills) || 0) + 1;
      client.net_total = (Number(client.net_total) || 0) + (Number(bill.net_total) || 0);
      client.paid = (Number(client.paid) || 0) + (Number(bill.paid_amount) || 0);
      client.remaining = (Number(client.remaining) || 0) + (Number(bill.remaining_balance) || 0);

      result.by_category = result.by_category || [];
      for (const frame of bill.frames) {
        const categoryKey = frame.bill_category || 'cnc_only';
        let category = result.by_category.find(row => row.bill_category === categoryKey);
        if (!category) {
          category = { bill_category: categoryKey, items: 0, amount: 0 };
          result.by_category.push(category);
        }
        category.items = (Number(category.items) || 0) + (Number(frame.pcs) || 1);
        category.amount = (Number(category.amount) || 0) + (Number(frame.total) || 0);

        const rawMaterial = String(frame.cnc_material || frame.material || '').trim() || '(no material)';
        const reportMaterial = ['MS-CNC', 'SS-CNC', 'SG-CNC', 'GP', 'MS-BLACK', 'SS-SILVER', 'SS-GOLDEN']
          .find(base => rawMaterial.toLowerCase() === base.toLowerCase() || rawMaterial.toLowerCase().endsWith(base.toLowerCase()));
        const aliases = { 'MS-BLACK': 'MS-CNC', 'SS-SILVER': 'SS-CNC', 'SS-GOLDEN': 'SG-CNC' };
        const material = aliases[reportMaterial] || reportMaterial || rawMaterial;
        const gauge = frame.cnc_gauge || frame.gauge || '';
        const size = frame.sheet_size || '';
        result.material_usage = result.material_usage || [];
        let usage = result.material_usage.find(row =>
          row.material === material &&
          row.gauge === gauge &&
          row.sheet_size === size &&
          row.bill_category === categoryKey
        );
        if (!usage) {
          usage = { material, gauge, sheet_size: size, bill_category: categoryKey, total_area: 0, total_amount: 0, items: 0, clients: '' };
          result.material_usage.push(usage);
        }
        usage.total_area = (Number(usage.total_area) || 0) + (Number(frame.area) || 0);
        usage.total_amount = (Number(usage.total_amount) || 0) + (Number(frame.total) || 0);
        usage.items = (Number(usage.items) || 0) + (Number(frame.pcs) || 1);
        if (bill.client_name && !String(usage.clients || '').split(', ').includes(bill.client_name)) {
          usage.clients = usage.clients ? `${usage.clients}, ${bill.client_name}` : bill.client_name;
        }
      }
    }

    const remainingByBill = new Map();
    for (const payment of queue.filter(item => item.kind === 'payment' && Number(item.body.bill_id) > 0)) {
      const billId = Number(payment.body.bill_id);
      const bill = getCachedBill(billId);
      if (!bill || !inPeriod(bill.created_at)) continue;
      const amount = Number(payment.body.amount) || 0;
      const alreadyQueued = remainingByBill.get(billId) || 0;
      const remaining = Math.max(0, (Number(bill.remaining_balance) || 0) - alreadyQueued);
      const applied = Math.min(amount, remaining);
      remainingByBill.set(billId, alreadyQueued + applied);
      add('total_paid', amount);
      result.revenue.total_remaining = Math.max(0, (Number(result.revenue.total_remaining) || 0) - applied);
      result.profit = (Number(result.profit) || 0) + amount;

      const client = (result.by_client || []).find(row => row.client_name === bill.client_name);
      if (client) {
        client.paid = (Number(client.paid) || 0) + amount;
        client.remaining = Math.max(0, (Number(client.remaining) || 0) - applied);
      }
      const recentBill = (result.recent_bills || []).find(row => Number(row.id) === billId);
      if (recentBill) {
        recentBill.paid_amount = (Number(recentBill.paid_amount) || 0) + amount;
        recentBill.remaining_balance = Math.max(0, (Number(recentBill.remaining_balance) || 0) - applied);
        recentBill.payment_status = recentBill.remaining_balance === 0 ? 'PAID' : 'PARTIAL';
        recentBill.pending_changes = true;
      }
    }

    for (const operation of queue.filter(item => item.kind === 'expense')) {
      const expenseUrl = apiUrl(operation.url);
      if (!inPeriod(operation.body.expense_date)) continue;
      const amount = Number(operation.body.amount) || 0;
      if (expenseUrl.searchParams.get('type') === 'personal') {
        result.personal_expenses = (Number(result.personal_expenses) || 0) + amount;
      } else {
        result.business_expenses = (Number(result.business_expenses) || 0) + amount;
      }
      result.profit = (Number(result.profit) || 0) - amount;
    }
    if (Array.isArray(result.stock)) applyPendingStockChanges(result.stock, queue);
  }

  return result;
}

function getCachedResponse(key) {
  try {
    const cached = localStorage.getItem(key);
    return cached === null ? null : JSON.parse(cached);
  } catch (error) {
    console.warn('Could not read saved offline data:', error);
    return null;
  }
}

function getCachedBill(id) {
  const key = API_CACHE_PREFIX + encodeURIComponent(`${API_BASE}/bills.php?action=get&id=${id}`);
  return getCachedResponse(key)?.data;
}

function saveCachedResponse(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn('Could not save offline data on this device:', error);
  }
}

export function fmt(n) {
  return 'PKR ' + Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const CAT_LABELS = {
  cnc_only: 'CNC Only',
  bending_sheet: 'Bending + Sheet',
  bending_only: 'Only Bending',
  cnc_pipe: 'CNC + Pipe',
  fancy: 'Fancy / Others',
  pipe_grill: 'Pipe Grill',
};

export const STANDARD_MATERIALS = ['MS-CNC', 'SS-CNC', 'SG-CNC', 'GP'];
export const CNC_PIPE_MATERIALS = [
  'MS(Pipe)-MS-CNC',
  'MS(Pipe)-SS-CNC',
  'MS(Pipe)-SG-CNC',
  'SS(Pipe)-SS-CNC',
  'SS(Pipe)-MS-CNC',
  'SS(Pipe)-SG-CNC',
];
export const CNC_GAUGES = [5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
export const PIPE_GAUGES = [5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];

async function request(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const parsedBody = opts.body ? JSON.parse(opts.body) : {};
  const writeKind = queuedWriteKind(url, method, parsedBody);
  const mutationId = writeKind ? crypto.randomUUID() : null;
  const pendingBillMatch = method === 'GET' && /\/bills\.php\?action=get&id=(-\d+)/.exec(url);
  if (pendingBillMatch) {
    const bill = pendingBills().find(item => item.id === Number(pendingBillMatch[1]));
    if (bill) return { success: true, data: bill, pending: true };
  }
  const requestUrl = method === 'GET' ? resolveLocalBillUrl(url) : url;
  const cacheKey = API_CACHE_PREFIX + encodeURIComponent(API_BASE + requestUrl);
  const cachedResponse = () => getCachedResponse(cacheKey);

  if (method !== 'GET' && (!apiOnline || navigator.onLine === false)) {
    return enqueueOfflineWrite(url, method, parsedBody, writeKind, mutationId);
  }

  if (method === 'GET' && (!apiOnline || navigator.onLine === false)) {
    const cached = cachedResponse();
    if (cached !== null) return addQueuedChanges(url, cached);
  }

  let res;
  try {
    const appToken = window.appSecurity?.apiToken;
    res = await fetch(API_BASE + requestUrl, {
      ...opts,
      signal: opts.signal || AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        ...(appToken ? { 'X-App-Token': appToken } : {}),
        ...(mutationId ? { 'X-Offline-Mutation-Id': mutationId } : {}),
        ...opts.headers,
      },
    });
  } catch (e) {
    setApiOnline(false);
    if (method === 'GET') {
      const cached = cachedResponse();
      if (cached !== null) return addQueuedChanges(url, cached);
    }
    if (method !== 'GET') return enqueueOfflineWrite(url, method, parsedBody, writeKind, mutationId);
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error('Server se connection nahi ho raha. Is laptop par pehle load hua data hi offline dikhega; connection wapas aane par dobara try karein.');
    }
    throw new Error(API_BASE === '/api'
      ? 'API offline — start PHP server on port 8080 (php -S localhost:8080 router.php)'
      : 'Shared server offline — check the host laptop, internet connection, and Tailscale.');
  }
  if (isTransientHttpStatus(res.status)) {
    setApiOnline(false);
    if (method === 'GET') {
      const cached = cachedResponse();
      if (cached !== null) return addQueuedChanges(url, cached);
    }
    if (method !== 'GET' && writeKind) {
      return enqueueOfflineWrite(url, method, parsedBody, writeKind, mutationId);
    }
  } else {
    setApiOnline(true);
  }
  const text = await res.text();
  if (!text || !text.trim()) {
    throw new Error(API_BASE === '/api'
      ? 'Empty API response — check PHP server is running on port 8080 and MySQL is started'
      : 'Shared server returned an empty response — check that the host app and Tailscale are running.');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(API_BASE === '/api'
      ? 'Invalid API response (not JSON). Is PHP server running? Open http://localhost:8080/api/health'
      : 'The shared server returned an invalid response. Check the Tailscale Serve address.');
  }
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed');
  if (method === 'GET') saveCachedResponse(cacheKey, data);
  return method === 'GET' ? addQueuedChanges(url, data) : data;
}

export const api = {
  // Bills
  listBills: (params = {}) => {
    const q = new URLSearchParams({ action: 'list', ...params });
    return request(`/bills.php?${q}`);
  },
  getBill: (id) => request(`/bills.php?action=get&id=${id}`),
  nextSr: () => request('/bills.php?action=next_sr'),
  createBill: (body) => request('/bills.php?action=create', { method: 'POST', body: JSON.stringify(body) }),
  updateBill: (body) => request('/bills.php?action=update', { method: 'POST', body: JSON.stringify(body) }),
  deleteBill: (id) => request(`/bills.php?id=${id}`, { method: 'DELETE' }),
  addPayment: (body) => request('/bills.php?action=add_payment', { method: 'POST', body: JSON.stringify(body) }),

  // Stock
  listStock: () => request('/stock.php?action=list'),
  saveStock: (body) => request('/stock.php?action=update', { method: 'POST', body: JSON.stringify(body) }),
  adjustStock: (body) => request('/stock.php?action=adjust', { method: 'POST', body: JSON.stringify(body) }),
  deleteStock: (id) => request(`/stock.php?id=${id}`, { method: 'DELETE' }),

  // Expenses
  listExpenses: (type, from, to) => request(`/expenses.php?type=${type}&from=${from}&to=${to}`),
  addExpense: (type, body) => request(`/expenses.php?type=${type}`, { method: 'POST', body: JSON.stringify(body) }),
  deleteExpense: (type, id) => request(`/expenses.php?type=${type}&id=${id}`, { method: 'DELETE' }),
  updateExpense: (type, body) => request(`/expenses.php?type=${type}&action=update`, { method: 'POST', body: JSON.stringify(body) }),

  // Reports
  report: (period) => request(`/reports.php?period=${period}`),
};

/** Business WhatsApp number (digits only, with country code e.g. 923037888350). Empty = open Business app to pick chat. */
export function getBusinessWaNumber() {
  try {
    return localStorage.getItem('habib_wa_business') || '';
  } catch {
    return '';
  }
}

export function setBusinessWaNumber(num) {
  const n = String(num || '').replace(/[^0-9]/g, '');
  try {
    if (n) localStorage.setItem('habib_wa_business', n);
    else localStorage.removeItem('habib_wa_business');
  } catch {}
  return n;
}

/**
 * Share via WhatsApp Business (preferred), not personal WhatsApp when possible.
 * - If business number saved: opens chat with that number (Business / regular)
 * - Android: tries WhatsApp Business package (com.whatsapp.w4b)
 * - Fallback: api.whatsapp.com (user can open in Business app)
 */
export function shareWhatsApp(message, phone = '') {
  const text = encodeURIComponent(message || '');
  const num = String(phone || getBusinessWaNumber() || '').replace(/[^0-9]/g, '');
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);

  // 1) Android: force WhatsApp Business app package
  if (isAndroid) {
    let intent;
    if (num) {
      intent =
        'intent://send?phone=' +
        num +
        '&text=' +
        text +
        '#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end';
    } else {
      intent =
        'intent://send?text=' +
        text +
        '#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end';
    }
    window.location.href = intent;
    // Fallback after short delay if Business not installed
    setTimeout(() => {
      const web = num
        ? 'https://api.whatsapp.com/send?phone=' + num + '&text=' + text
        : 'https://api.whatsapp.com/send?text=' + text;
      window.open(web, '_blank', 'noopener,noreferrer');
    }, 1200);
    return;
  }

  // 2) iOS / Desktop: api.whatsapp.com — choose "WhatsApp Business" when prompted
  //    whatsapp:// also works if Business is default handler
  if (isMobile) {
    const native = num
      ? 'whatsapp://send?phone=' + num + '&text=' + text
      : 'whatsapp://send?text=' + text;
    window.location.href = native;
    setTimeout(() => {
      const web = num
        ? 'https://api.whatsapp.com/send?phone=' + num + '&text=' + text
        : 'https://api.whatsapp.com/send?text=' + text;
      window.open(web, '_blank', 'noopener,noreferrer');
    }, 800);
    return;
  }

  // 3) Desktop: open api.whatsapp.com — use "Continue to WhatsApp Web" then Business Desktop if logged in there
  //    Prefer number so message lands on business chat
  const web = num
    ? 'https://api.whatsapp.com/send?phone=' + num + '&text=' + text
    : 'https://api.whatsapp.com/send?text=' + text;
  window.open(web, '_blank', 'noopener,noreferrer');
}


/** Draw multiline text card → PNG blob */
export function textToImageBlob(title, lines, opts = {}) {
  const pad = 28
  const lineH = 22
  const titleH = 32
  const width = opts.width || 720
  const rows = Array.isArray(lines) ? lines : String(lines || '').split('\n')
  const height = pad * 2 + titleH + 12 + rows.length * lineH + 20
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.max(height, 200)
  const ctx = canvas.getContext('2d')
  // background
  ctx.fillStyle = '#000B18'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // accent bar
  ctx.fillStyle = '#ff7300'
  ctx.fillRect(0, 0, canvas.width, 6)
  // title
  ctx.fillStyle = '#ff7300'
  ctx.font = 'bold 20px Segoe UI, Arial, sans-serif'
  ctx.fillText(title || 'S. HABIB STEEL', pad, pad + 22)
  // body
  ctx.fillStyle = '#f8fafc'
  ctx.font = '15px Consolas, Courier New, monospace'
  let y = pad + titleH + 16
  rows.forEach((line) => {
    const s = String(line).replace(/\*/g, '')
    ctx.fillText(s.slice(0, 78), pad, y)
    y += lineH
  })
  // footer
  ctx.fillStyle = '#9aa3b8'
  ctx.font = '12px Segoe UI, Arial, sans-serif'
  ctx.fillText('S. HABIB STEEL & LASER CRAFT', pad, canvas.height - 14)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

/** Share summary as IMAGE (WhatsApp Business if possible) + optional caption text */
export async function shareAsImage(title, lines, filename = 'habib-share.png') {
  const blob = await textToImageBlob(title, lines)
  if (!blob) throw new Error('Could not create image')
  const file = new File([blob], filename, { type: 'image/png' })
  const caption = Array.isArray(lines) ? lines.join('\n') : String(lines || '')

  // Mobile / supporting browsers: share file to WhatsApp Business
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: title || 'S. HABIB',
        text: title || 'S. HABIB summary',
      })
      return
    } catch (e) {
      if (e && e.name === 'AbortError') return
    }
  }

  // Desktop fallback: download PNG, then open WA with short caption
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)

  const short =
    (title || 'S. HABIB') +
    '\n📷 Image downloaded — WhatsApp Business mein attach karein (Gallery / Document).'
  shareWhatsApp(short)
}

export function formatBillWhatsApp(bill) {
  if (!bill) return '';
  const frames = bill.frames || [];
  const lines = [
    `*S. HABIB STEEL & LASER CRAFT*`,
    `Bill #${bill.sr_no}  |  ${String(bill.created_at || '').slice(0, 16)}`,
    `Client: ${bill.client_name}${bill.client_phone ? ' | ' + bill.client_phone : ''}`,
    `Status: ${bill.payment_status || '—'}`,
    `------------------------`,
  ];
  frames.forEach((f, i) => {
    const mat = f.material || f.cnc_material || '—';
    const g = f.gauge || f.cnc_gauge || '';
    const bend = (parseFloat(f.bend_rate) || 0) * (parseFloat(f.bend_count) || 0);
    lines.push(
      `${i + 1}. ${mat}${g ? ' / ' + g : ''}  ${Number(f.width || 0)}x${Number(f.length || 0)}  Pcs:${f.pcs || 1}`
    );
    lines.push(`   Total: PKR ${Number(f.total || 0).toLocaleString('en-PK')}${bend ? ` (Bend: ${bend})` : ''}`);
  });
  lines.push(`------------------------`);
  lines.push(`Grand Total: *PKR ${Number(bill.grand_total || 0).toLocaleString('en-PK')}*`);
  if (Number(bill.discount) > 0) lines.push(`Discount: PKR ${Number(bill.discount).toLocaleString('en-PK')}`);
  lines.push(`Paid: PKR ${Number(bill.paid_amount || 0).toLocaleString('en-PK')}`);
  lines.push(`Due: *PKR ${Number(bill.remaining_balance || 0).toLocaleString('en-PK')}*`);
  lines.push(`\nThank you!`);
  return lines.join('\n');
}
