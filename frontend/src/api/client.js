export const API_BASE = window.appSecurity?.apiBaseUrl || '/api';

const API_CACHE_PREFIX = 'habib-api-cache:v1:';
const OUTBOX_KEY = 'habib-offline-outbox:v1';
const BILL_ID_MAP_KEY = 'habib-offline-bill-ids:v1';
const RECORD_ID_MAP_KEY = 'habib-offline-record-ids:v1';
const OUTBOX_EVENT = 'habib-outbox';
const SYNC_EVENT = 'habib-sync';
let apiOnline = true;
let outboxSyncInProgress = false;

export function isApiOnline() {
  return apiOnline;
}

function getLegacyCachedResponse(requestUrl) {
  if (API_BASE === '/api') return null;
  const key = API_CACHE_PREFIX + encodeURIComponent('/api' + requestUrl);
  return getCachedResponse(key);
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

function readOfflineRecordIdMap() {
  try {
    return JSON.parse(localStorage.getItem(RECORD_ID_MAP_KEY) || '{"expense":{},"stock":{}}');
  } catch (error) {
    console.warn('Could not read offline record ID mappings:', error);
    return { expense: {}, stock: {} };
  }
}

function resolveOfflineRecordId(kind, id) {
  const numericId = Number(id);
  if (numericId >= 0) return numericId;
  const type = kind.startsWith('expense') ? 'expense' : 'stock';
  return Number(readOfflineRecordIdMap()[type]?.[numericId]) || numericId;
}

function resolveBillId(id) {
  const numericId = Number(id);
  return numericId < 0 ? Number(readBillIdMap()[numericId]) || numericId : numericId;
}

function sameBillId(firstId, secondId) {
  return resolveBillId(firstId) === resolveBillId(secondId);
}

function sameRecordId(kind, firstId, secondId) {
  if (kind.startsWith('bill')) return sameBillId(firstId, secondId);
  const recordType = kind.startsWith('expense') ? 'expense' : 'stock';
  return resolveOfflineRecordId(recordType, firstId) === resolveOfflineRecordId(recordType, secondId);
}

function getCachedExpense(id, type) {
  const resolvedId = resolveOfflineRecordId('expense', id);
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(API_CACHE_PREFIX)) continue;
    let cachedUrl;
    try {
      cachedUrl = decodeURIComponent(key.slice(API_CACHE_PREFIX.length));
    } catch {
      continue;
    }
    const cachedType = new URL(cachedUrl, window.location.href).searchParams.get('type') || 'business';
    if (cachedType !== type) continue;
    const rows = getCachedResponse(key)?.data;
    if (!Array.isArray(rows)) continue;
    const record = rows.find(row => Number(row.id) === resolvedId);
    if (record) return record;
  }
  return null;
}

function apiUrl(url) {
  return new URL(API_BASE + url, window.location.href);
}

function queuedWriteKind(url, method, body) {
  const parsed = apiUrl(url);
  const action = parsed.searchParams.get('action') || '';
  if (method === 'DELETE') {
    if (parsed.pathname.endsWith('/bills.php')) return 'bill_delete';
    if (parsed.pathname.endsWith('/expenses.php')) return 'expense_delete';
    if (parsed.pathname.endsWith('/stock.php')) return 'stock_delete';
    return null;
  }
  if (method !== 'POST') return null;
  if (parsed.pathname.endsWith('/bills.php') && action === 'create') return 'bill';
  if (parsed.pathname.endsWith('/bills.php') && action === 'update') return 'bill_update';
  if (parsed.pathname.endsWith('/bills.php') && action === 'add_payment') return 'payment';
  if (parsed.pathname.endsWith('/expenses.php') && !action) return 'expense';
  if (parsed.pathname.endsWith('/expenses.php') && action === 'update') return 'expense_update';
  if (parsed.pathname.endsWith('/stock.php') && ['add', 'update'].includes(action) && !body?.id) return 'stock';
  if (parsed.pathname.endsWith('/stock.php') && action === 'adjust' && Number(body?.id) !== 0) return 'stock_adjust';
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
    throw new Error('This change cannot be saved offline.');
  }
  const parsed = apiUrl(url);
  const operationBody = method === 'DELETE'
    ? { id: Number(parsed.searchParams.get('id')) }
    : body;
  const recordId = Number(operationBody.id);
  const outbox = readOutbox();

  if (kind === 'bill_delete') {
    const withoutPayments = outbox.filter(item =>
      !(item.kind === 'payment' && sameBillId(item.body.bill_id, recordId))
    );
    if (withoutPayments.length !== outbox.length) {
      outbox.splice(0, outbox.length, ...withoutPayments);
    }
  }

  if (kind === 'bill_update' && recordId < 0) {
    const pendingBill = outbox.find(item => item.kind === 'bill' && item.localId === recordId);
    if (pendingBill) {
      const queuedPayments = outbox
        .filter(item => item.kind === 'payment' && sameBillId(item.body.bill_id, recordId))
        .reduce((sum, item) => sum + (Number(item.body.amount) || 0), 0);
      pendingBill.body = {
        ...operationBody,
        paid_amount: Math.max(0, (Number(operationBody.paid_amount) || 0) - queuedPayments),
      };
      delete pendingBill.failed;
      saveOutbox(outbox.filter(item => !(item.kind === 'bill_update' && Number(item.body.id) === recordId)));
      return { success: true, bill_id: recordId, pending: true };
    }
  }
  if (kind === 'expense_update' && recordId < 0) {
    const pendingExpense = outbox.find(item => item.kind === 'expense' && item.localId === recordId);
    if (pendingExpense) {
      pendingExpense.body = { ...operationBody };
      delete pendingExpense.body.id;
      delete pendingExpense.failed;
      saveOutbox(outbox.filter(item => !(item.kind === 'expense_update' && Number(item.body.id) === recordId)));
      return { success: true, id: recordId, pending: true };
    }
  }

  const createKind = kind === 'bill_delete' ? 'bill' : kind === 'expense_delete' ? 'expense' : 'stock';
  const pendingCreate = ['bill_delete', 'expense_delete', 'stock_delete'].includes(kind)
    ? outbox.find(item => item.kind === createKind && item.localId === recordId)
    : null;
  if (pendingCreate) {
    const filtered = outbox.filter(item => {
      if (item.kind === createKind && item.localId === recordId) return false;
      if (kind === 'bill_delete' && item.kind === 'payment' && sameBillId(item.body.bill_id, recordId)) return false;
      if (kind === 'stock_delete' && item.kind === 'stock_adjust' && sameRecordId(kind, item.body.id, recordId)) return false;
      return !(
        item.kind === kind.replace('_delete', '_update') &&
        sameRecordId(kind, item.body.id, recordId)
      );
    });
    saveOutbox(filtered);
    return { success: true, pending: true };
  }

  const updateKinds = ['bill_update', 'expense_update'];
  if (updateKinds.includes(kind)) {
    const deleteKind = kind.replace('_update', '_delete');
    const withoutQueuedDelete = outbox.filter(item =>
      !(item.kind === deleteKind && sameRecordId(kind, item.body.id, recordId))
    );
    if (withoutQueuedDelete.length !== outbox.length) {
      outbox.splice(0, outbox.length, ...withoutQueuedDelete);
    }
    const previous = [...outbox].reverse().find(item =>
      item.kind === kind && sameRecordId(kind, item.body.id, recordId)
    );
    if (previous) {
      const index = outbox.indexOf(previous);
      outbox.splice(index, 1);
    }
  }
  if (['bill_delete', 'expense_delete', 'stock_delete'].includes(kind)) {
    const alreadyQueued = outbox.some(item =>
      item.kind === kind && sameRecordId(kind, item.body.id, recordId)
    );
    if (alreadyQueued) return { success: true, pending: true };
  }

  const localId = ['bill', 'expense', 'stock'].includes(kind) ? nextLocalId() : null;
  const operation = {
    id: mutationId,
    kind,
    method,
    url,
    body: operationBody,
    queuedAt: new Date().toISOString(),
    ...(localId !== null ? { localId } : {}),
  };
  if (kind === 'bill_update' || kind === 'bill_delete') {
    operation.before = getCachedBill(resolveBillId(recordId)) || null;
  } else if (kind === 'expense_update' || kind === 'expense_delete') {
    operation.before = getCachedExpense(recordId, parsed.searchParams.get('type') || 'business');
  }
  outbox.push(operation);
  saveOutbox(outbox);

  if (kind === 'bill') return { success: true, bill_id: localId, sr_no: 'PENDING', pending: true };
  if (kind === 'expense' || kind === 'stock') return { success: true, id: localId, pending: true };
  return { success: true, id: recordId, bill_id: recordId, pending: true };
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
      const requestUrl = apiUrl(operation.url);
      const billId = operation.kind === 'payment' ? Number(body.bill_id)
        : operation.kind === 'bill_update' ? Number(body.id)
          : operation.kind === 'bill_delete' ? Number(requestUrl.searchParams.get('id')) : 0;
      const recordKind = operation.kind.startsWith('expense') ? 'expense'
        : operation.kind.startsWith('stock') ? 'stock' : '';
      if (recordKind) {
        const recordId = operation.kind.endsWith('_delete')
          ? Number(requestUrl.searchParams.get('id'))
          : Number(body.id);
        if (recordId < 0) {
          const serverRecordId = resolveOfflineRecordId(recordKind, recordId);
          if (serverRecordId < 0) return;
          if (operation.kind.endsWith('_delete')) requestUrl.searchParams.set('id', String(serverRecordId));
          else body.id = serverRecordId;
        }
      }
      if (billId < 0) {
        const serverBillId = readBillIdMap()[billId];
        if (!serverBillId) return;
        if (operation.kind === 'payment') body.bill_id = Number(serverBillId);
        else if (operation.kind === 'bill_update') body.id = Number(serverBillId);
        else requestUrl.searchParams.set('id', String(serverBillId));
      }
      const endpoint = requestUrl.pathname.replace(/^\/api/, '') + requestUrl.search;

      let response;
      try {
        const appToken = window.appSecurity?.apiToken;
        const result = await fetch(API_BASE + endpoint, {
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

      const missingServerId =
        (operation.kind === 'bill' && !(Number(response.data.bill_id) > 0)) ||
        (['expense', 'stock'].includes(operation.kind) && !(Number(response.data.id) > 0));
      if (missingServerId) {
        operation.failed = 'Server accepted the change but did not return its permanent record ID.';
        outbox[0] = operation;
        saveOutbox(outbox);
        return;
      }

      if (operation.kind === 'bill' && operation.localId) {
        const idMap = readBillIdMap();
        idMap[operation.localId] = response.data.bill_id;
        localStorage.setItem(BILL_ID_MAP_KEY, JSON.stringify(idMap));
      }
      if (['expense', 'stock'].includes(operation.kind) && operation.localId) {
        const idMap = readOfflineRecordIdMap();
        const type = operation.kind === 'expense' ? 'expense' : 'stock';
        idMap[type] = idMap[type] || {};
        idMap[type][operation.localId] = response.data.id;
        localStorage.setItem(RECORD_ID_MAP_KEY, JSON.stringify(idMap));
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

function calculatePendingBill(operation, existingBill = null) {
  const payload = operation.body;
  const frames = (payload.frames || []).map((frame, index) => {
    const pcs = Math.max(1, Number.parseInt(frame.pcs, 10) || 1);
    const width = Number(frame.width) || 0;
    const length = Number(frame.length) || 0;
    const bend = (Number(frame.bend_rate) || 0) * (Number(frame.bend_count) || 0);
    const area = frame.bill_category === 'fancy'
      ? (Number(frame.width) || 0)
      : ['bending_only', 'sheet_sale', 'only_cutting'].includes(frame.bill_category) ? 0 : width * length * pcs;
    let total = frame.bill_category === 'fancy'
      ? ((Number(frame.width) > 0 || Number(frame.rate) > 0)
        ? area * (Number(frame.rate) || 0)
        : pcs * (Number(frame.direct_price) || 0))
      : frame.bill_category === 'sheet_sale'
        ? pcs * (Number(frame.direct_price) || 0)
        : frame.bill_category === 'only_cutting'
          ? Number(frame.direct_price) || 0
      : frame.bill_category === 'bending_only'
        ? bend
        : area * (Number(frame.rate) || 0) + (frame.bill_category === 'bending_sheet' ? bend : 0);
    total += Number(frame.extra_item_price) || 0;
    return { ...frame, id: `pending-${index}`, serial: index + 1, area, total, tags: frame.tags || [] };
  });
  const grand = frames.reduce((sum, frame) => sum + frame.total, 0);
  const discount = Math.max(0, Number(payload.discount) || 0);
  const net = Math.max(0, grand - discount);
  let paid = Math.max(0, Number(payload.paid_amount) || 0);
  const billId = operation.localId ?? Number(payload.id);
  const outbox = readOutbox();
  const payments = operation.kind === 'bill'
    ? outbox.filter(item => item.kind === 'payment' && sameBillId(item.body.bill_id, billId))
      .map(item => ({ amount: Number(item.body.amount) || 0, note: item.body.note || 'Payment', paid_at: item.queuedAt, pending: true }))
    : [];
  if (operation.kind === 'bill_update') {
    const operationIndex = outbox.findIndex(item => item.id === operation.id);
    if (operationIndex >= 0) {
      const previouslyIncludedPayments = outbox.slice(0, operationIndex)
        .filter(item => item.kind === 'payment' && sameBillId(item.body.bill_id, billId))
        .reduce((sum, item) => sum + (Number(item.body.amount) || 0), 0);
      paid = Math.max(0, paid - previouslyIncludedPayments);
    }
  }
  const totalPaid = paid + payments.reduce((sum, payment) => sum + payment.amount, 0);
  const personalExpenses = payload.personal_expenses || [];
  const personalTotal = personalExpenses.reduce((sum, expense) => sum + (Number(expense.cost) || 0), 0);

  return {
    ...existingBill,
    id: existingBill?.id ?? billId,
    sr_no: existingBill?.sr_no ?? 'PENDING',
    client_name: payload.client_name,
    client_phone: payload.client_phone || '',
    created_at: existingBill?.created_at ?? operation.queuedAt.replace('T', ' ').slice(0, 19),
    grand_total: grand,
    discount,
    net_total: net,
    paid_amount: totalPaid,
    remaining_balance: Math.max(0, net - totalPaid),
    payment_status: totalPaid >= net ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID',
    notes: payload.notes || '',
    frames,
    frame_count: frames.length,
    payment_history: [...(existingBill?.payment_history || []), ...payments],
    personal_total: personalTotal,
    personal_expenses: personalExpenses,
    company: existingBill?.company || {},
    pending: operation.kind === 'bill' || !!existingBill?.pending,
    pending_changes: operation.kind !== 'bill' || !!existingBill?.pending_changes,
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
  const adjustForBill = (bill, direction) => {
    if (!bill) return;
    for (const frame of bill.frames || []) {
      if (!['cnc_only', 'cnc_pipe', 'bending_sheet'].includes(frame.bill_category)) continue;
      const material = normalizePendingStockMaterial(frame.cnc_material || frame.material);
      if (!material) continue;

      const width = Number(frame.width) || 0;
      const length = Number(frame.length) || 0;
      const pieces = Math.max(1, Number.parseInt(frame.pcs, 10) || 1);
      const area = Number(frame.area) || width * length * pieces;
      const sheetArea = { '4x8': 32, '5x8': 40, '4x10': 40, '5x10': 50 }[frame.sheet_size || '4x8'] || 32;
      const sheetsNeeded = area > 0 ? Math.round((area / sheetArea) * 100) / 100 : 0;
      if (sheetsNeeded <= 0) continue;

      const gauge = frame.bill_category === 'pipe_grill'
        ? frame.pipe_gauge || frame.gauge || ''
        : frame.cnc_gauge || frame.gauge || '';
      const size = frame.sheet_size || '4x8';
      const existing = rows.find(row =>
        row.material === material &&
        row.sheet_size === size &&
        (row.gauge === gauge || (
          getStockGaugeNumber(gauge) !== '' &&
          getStockGaugeNumber(row.gauge) === getStockGaugeNumber(gauge)
        ))
      );
      if (existing) {
        existing.quantity = Math.max(0, (Number(existing.quantity) || 0) + direction * sheetsNeeded);
        existing.pending_changes = true;
      }
    }
  };

  for (const operation of queue) {
    if (operation.kind === 'stock_delete') {
      const index = rows.findIndex(row => Number(row.id) === resolveOfflineRecordId('stock', operation.body.id));
      if (index >= 0) rows.splice(index, 1);
      continue;
    }

    if (operation.kind === 'stock_adjust') {
      const existing = rows.find(row => Number(row.id) === resolveOfflineRecordId('stock', operation.body.id));
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

    if (operation.kind === 'bill') {
      adjustForBill(calculatePendingBill(operation), -1);
      continue;
    }
    if (operation.kind === 'bill_update') {
      const before = operation.before || getCachedBill(resolveBillId(operation.body.id));
      adjustForBill(before, 1);
      adjustForBill(calculatePendingBill(operation, before), -1);
      continue;
    }
    if (operation.kind === 'bill_delete') {
      adjustForBill(operation.before || getCachedBill(resolveBillId(operation.body.id)), 1);
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
    const originalServerBillCount = Array.isArray(result.data) ? result.data.length : 0;
    if (action === 'get' && id < 0) {
      const localBill = pendingBills().find(bill => bill.id === id);
      if (localBill) return { success: true, data: localBill, pending: true };
    }

    const applyBillChanges = bill => {
      const deleted = queue.some(item => item.kind === 'bill_delete' &&
        sameBillId(item.body.id, bill.id));
      if (deleted) return null;

      const update = [...queue].reverse().find(item =>
        item.kind === 'bill_update' && sameBillId(item.body.id, bill.id)
      );
      let updated = update ? calculatePendingBill(update, bill) : bill;
      const payments = queue.filter(item =>
        item.kind === 'payment' && sameBillId(item.body.bill_id, updated.id)
      );
      if (payments.length) {
        const amount = payments.reduce((sum, item) => sum + (Number(item.body.amount) || 0), 0);
        const paid = Number(updated.paid_amount || 0) + amount;
        const remaining = Math.max(0, Number(updated.net_total || 0) - paid);
        updated = {
          ...updated,
          paid_amount: paid,
          remaining_balance: remaining,
          payment_status: remaining === 0 ? 'PAID' : 'PARTIAL',
          payment_history: [
            ...(updated.payment_history || []),
            ...payments.map(item => ({
              amount: Number(item.body.amount) || 0,
              note: item.body.note || 'Payment',
              paid_at: item.queuedAt,
              pending: true,
            })),
          ],
          pending_changes: true,
        };
      }
      return updated;
    };

    if (Array.isArray(result.data)) {
      result.data = result.data.map(applyBillChanges).filter(Boolean);
    } else if (action === 'get' && result.data) {
      result.data = applyBillChanges(result.data);
    }

    if (action === 'list' && Array.isArray(result.data)) {
      const search = (parsed.searchParams.get('search') || '').toLowerCase();
      const status = parsed.searchParams.get('status') || '';
      result.data = result.data.filter(bill =>
        (!search || `${bill.client_name} ${bill.client_phone} ${bill.sr_no}`.toLowerCase().includes(search)) &&
        (!status || bill.payment_status === status)
      );
      const visibleIds = new Set(result.data.map(bill => Number(bill.id)));
      const updatedBills = queue.filter(item => item.kind === 'bill_update')
        .filter(item => !queue.some(change => change.kind === 'bill_delete' &&
          sameBillId(change.body.id, item.body.id)))
        .filter(item => !visibleIds.has(resolveBillId(item.body.id)))
        .map(item => {
          const cachedBill = getCachedBill(resolveBillId(item.body.id));
          return cachedBill ? calculatePendingBill(item, cachedBill) : null;
        })
        .filter(bill => bill &&
          (!search || `${bill.client_name} ${bill.client_phone} ${bill.sr_no}`.toLowerCase().includes(search)) &&
          (!status || bill.payment_status === status));
      const additions = pendingBills().filter(bill => {
        if (search && !`${bill.client_name} ${bill.client_phone} ${bill.sr_no}`.toLowerCase().includes(search)) return false;
        if (status && bill.payment_status !== status) return false;
        return true;
      });
      const visibleServerBillCount = result.data.length;
      result.data = [...additions, ...updatedBills, ...result.data];
      result.total = Math.max(
        0,
        (Number(result.total) || 0) - (originalServerBillCount - visibleServerBillCount) +
          additions.length + updatedBills.length
      );
    }
  }

  if (path.endsWith('/expenses.php') && Array.isArray(result.data)) {
    const type = parsed.searchParams.get('type') || 'business';
    const from = parsed.searchParams.get('from') || '';
    const to = parsed.searchParams.get('to') || '';
    const isType = operation => {
      const operationType = apiUrl(operation.url).searchParams.get('type') || 'business';
      return operationType === type;
    };
    const updatedRows = result.data
      .filter(row => !queue.some(item =>
        item.kind === 'expense_delete' && isType(item) && sameRecordId('expense', item.body.id, row.id)
      ))
      .map(row => {
        const update = [...queue].reverse().find(item =>
          item.kind === 'expense_update' && isType(item) && sameRecordId('expense', item.body.id, row.id)
        );
        return update ? { ...row, ...update.body, pending_changes: true } : row;
      })
      .filter(row => row.expense_date >= from && row.expense_date <= to);
    const listedIds = new Set(updatedRows.map(row => resolveOfflineRecordId('expense', row.id)));
    const queuedUpdates = queue.filter(item =>
      item.kind === 'expense_update' &&
      isType(item) &&
      !listedIds.has(resolveOfflineRecordId('expense', item.body.id)) &&
      item.body.expense_date >= from &&
      item.body.expense_date <= to &&
      !queue.some(deletion => deletion.kind === 'expense_delete' && isType(deletion) && sameRecordId('expense', deletion.body.id, item.body.id))
    ).map(item => ({
      ...item.body,
      id: resolveOfflineRecordId('expense', item.body.id),
      category: item.body.category || 'General',
      pending_changes: true,
    }));
    const additions = queue.filter(item =>
      item.kind === 'expense' &&
      isType(item) &&
      item.body.expense_date >= from &&
      item.body.expense_date <= to
    ).map(item => {
      const update = [...queue].reverse().find(change =>
        change.kind === 'expense_update' && isType(change) && sameRecordId('expense', change.body.id, item.localId)
      );
      return {
        ...item.body,
        ...update?.body,
        id: item.localId,
        category: (update?.body || item.body).category || 'General',
        pending: true,
      };
    }).filter(row => row.expense_date >= from && row.expense_date <= to);
    const pendingDeletes = new Set(queue
      .filter(item => item.kind === 'expense_delete' && isType(item))
      .map(item => resolveOfflineRecordId('expense', item.body.id)));
    const visibleAdditions = additions.filter(row => !pendingDeletes.has(Number(row.id)));
    result.data = [...visibleAdditions, ...queuedUpdates, ...updatedRows];
    result.total = result.data.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
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
    const changeBillReport = (bill, direction) => {
      if (!bill || !inPeriod(bill.created_at)) return;
      const sign = direction;
      add('bill_count', sign);
      add('gross_total', sign * (Number(bill.grand_total) || 0));
      add('total_discount', sign * (Number(bill.discount) || 0));
      add('net_total', sign * (Number(bill.net_total) || 0));
      add('total_paid', sign * (Number(bill.paid_amount) || 0));
      add('total_remaining', sign * (Number(bill.remaining_balance) || 0));
      add('bill_personal', sign * (Number(bill.personal_total) || 0));
      result.personal_expenses = (Number(result.personal_expenses) || 0) + sign * (Number(bill.personal_total) || 0);
      result.profit = (Number(result.profit) || 0) + sign * ((Number(bill.paid_amount) || 0) - (Number(bill.personal_total) || 0));

      result.by_client = result.by_client || [];
      let client = result.by_client.find(row => row.client_name === bill.client_name);
      if (!client && sign > 0) {
        client = { client_name: bill.client_name, bills: 0, net_total: 0, paid: 0, remaining: 0, last_date: bill.created_at };
        result.by_client.push(client);
      }
      if (client) {
        client.bills = (Number(client.bills) || 0) + sign;
        client.net_total = (Number(client.net_total) || 0) + sign * (Number(bill.net_total) || 0);
        client.paid = (Number(client.paid) || 0) + sign * (Number(bill.paid_amount) || 0);
        client.remaining = (Number(client.remaining) || 0) + sign * (Number(bill.remaining_balance) || 0);
        if (sign > 0 && String(bill.created_at) > String(client.last_date || '')) client.last_date = bill.created_at;
        if (client.bills <= 0) result.by_client = result.by_client.filter(row => row !== client);
      }

      result.by_category = result.by_category || [];
      result.material_usage = result.material_usage || [];
      result.usage_detail = result.usage_detail || [];
      if (sign < 0) {
        result.usage_detail = result.usage_detail.filter(row => String(row.sr_no) !== String(bill.sr_no));
      }
      for (const frame of bill.frames || []) {
        const categoryKey = frame.bill_category || 'cnc_only';
        let category = result.by_category.find(row => row.bill_category === categoryKey);
        if (!category && sign > 0) {
          category = { bill_category: categoryKey, items: 0, amount: 0 };
          result.by_category.push(category);
        }
        if (category) {
          category.items = (Number(category.items) || 0) + sign * (Number(frame.pcs) || 1);
          category.amount = (Number(category.amount) || 0) + sign * (Number(frame.total) || 0);
          if (category.items <= 0) result.by_category = result.by_category.filter(row => row !== category);
        }

        const rawMaterial = String(frame.cnc_material || frame.material || '').trim() || '(no material)';
        const reportMaterial = ['MS-CNC', 'SS-CNC', 'SG-CNC', 'GP', 'MS-BLACK', 'SS-SILVER', 'SS-GOLDEN']
          .find(base => rawMaterial.toLowerCase() === base.toLowerCase() || rawMaterial.toLowerCase().endsWith(base.toLowerCase()));
        const aliases = { 'MS-BLACK': 'MS-CNC', 'SS-SILVER': 'SS-CNC', 'SS-GOLDEN': 'SG-CNC' };
        const material = aliases[reportMaterial] || reportMaterial || rawMaterial;
        const gauge = frame.cnc_gauge || frame.gauge || '';
        const size = frame.sheet_size || '';
        if (sign > 0) {
          result.usage_detail.push({
            material,
            gauge,
            sheet_size: size,
            bill_category: categoryKey,
            area: Number(frame.area) || 0,
            pcs: Number(frame.pcs) || 1,
            amount: Number(frame.total) || 0,
            sr_no: bill.sr_no,
            client_name: bill.client_name,
            used_at: bill.created_at,
          });
        }
        let usage = result.material_usage.find(row =>
          row.material === material &&
          row.gauge === gauge &&
          row.sheet_size === size &&
          row.bill_category === categoryKey
        );
        if (!usage && sign > 0) {
          usage = { material, gauge, sheet_size: size, bill_category: categoryKey, total_area: 0, total_amount: 0, items: 0, clients: '' };
          result.material_usage.push(usage);
        }
        if (usage) {
          usage.total_area = (Number(usage.total_area) || 0) + sign * (Number(frame.area) || 0);
          usage.total_amount = (Number(usage.total_amount) || 0) + sign * (Number(frame.total) || 0);
          usage.items = (Number(usage.items) || 0) + sign * (Number(frame.pcs) || 1);
          const clients = String(usage.clients || '').split(', ').filter(Boolean);
          if (sign > 0 && bill.client_name && !clients.includes(bill.client_name)) clients.push(bill.client_name);
          if (usage.items <= 0) result.material_usage = result.material_usage.filter(row => row !== usage);
          else usage.clients = clients.join(', ');
        }
      }

      result.recent_bills = (result.recent_bills || []).filter(row => !sameBillId(row.id, bill.id));
      if (sign > 0) {
        result.recent_bills.unshift({
          id: bill.id,
          sr_no: bill.sr_no,
          client_name: bill.client_name,
          net_total: bill.net_total,
          paid_amount: bill.paid_amount,
          remaining_balance: bill.remaining_balance,
          payment_status: bill.payment_status,
          created_at: bill.created_at,
          pending_changes: true,
        });
        result.recent_bills = result.recent_bills.slice(0, 50);
      }
    };

    const latestBillMutations = new Map();
    for (const operation of queue) {
      if (!['bill_update', 'bill_delete'].includes(operation.kind)) continue;
      latestBillMutations.set(resolveBillId(operation.body.id), operation);
    }
    for (const [billId, operation] of latestBillMutations) {
      const recent = (result.recent_bills || []).find(bill => Number(bill.id) === billId);
      const before = operation.before || getCachedBill(billId) || recent;
      if (!before) continue;
      changeBillReport(before, -1);
      if (operation.kind === 'bill_update') {
        changeBillReport(calculatePendingBill(operation, before), 1);
      }
    }

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
      result.usage_detail = result.usage_detail || [];
      for (const frame of bill.frames) {
        const rawMaterial = String(frame.cnc_material || frame.material || '').trim() || '(no material)';
        const reportMaterial = ['MS-CNC', 'SS-CNC', 'SG-CNC', 'GP', 'MS-BLACK', 'SS-SILVER', 'SS-GOLDEN']
          .find(base => rawMaterial.toLowerCase() === base.toLowerCase() || rawMaterial.toLowerCase().endsWith(base.toLowerCase()));
        const aliases = { 'MS-BLACK': 'MS-CNC', 'SS-SILVER': 'SS-CNC', 'SS-GOLDEN': 'SG-CNC' };
        result.usage_detail.push({
          material: aliases[reportMaterial] || reportMaterial || rawMaterial,
          gauge: frame.bill_category === 'pipe_grill'
            ? frame.pipe_gauge || frame.gauge || ''
            : frame.cnc_gauge || frame.gauge || '',
          sheet_size: frame.sheet_size || '',
          bill_category: frame.bill_category || '',
          area: Number(frame.area) || 0,
          pcs: Number(frame.pcs) || 1,
          amount: Number(frame.total) || 0,
          sr_no: bill.sr_no,
          client_name: bill.client_name,
          used_at: bill.created_at,
        });
      }

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
    for (const payment of queue.filter(item =>
      item.kind === 'payment' &&
      Number(item.body.bill_id) > 0 &&
      !queue.some(operation => operation.kind === 'bill_update' && sameBillId(operation.body.id, item.body.bill_id))
    )) {
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
    const latestExpenseMutations = new Map();
    for (const operation of queue) {
      if (!['expense_update', 'expense_delete'].includes(operation.kind)) continue;
      const type = apiUrl(operation.url).searchParams.get('type') || 'business';
      latestExpenseMutations.set(`${type}:${resolveOfflineRecordId('expense', operation.body.id)}`, operation);
    }
    for (const [key, operation] of latestExpenseMutations) {
      const type = key.slice(0, key.indexOf(':'));
      const before = operation.before || getCachedExpense(resolveOfflineRecordId('expense', operation.body.id), type);
      const after = operation.kind === 'expense_update' ? operation.body : null;
      const applyExpenseDelta = (expense, direction) => {
        if (!expense || !inPeriod(expense.expense_date)) return;
        const amount = (Number(expense.amount) || 0) * direction;
        if (type === 'personal') {
          result.personal_expenses = (Number(result.personal_expenses) || 0) + amount;
        } else {
          result.business_expenses = (Number(result.business_expenses) || 0) + amount;
        }
        result.profit = (Number(result.profit) || 0) - amount;
      };
      applyExpenseDelta(before, -1);
      applyExpenseDelta(after, 1);
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

function getOfflineListFallback(url) {
  const requested = apiUrl(url);
  const action = requested.searchParams.get('action') || '';
  const isBillsList = requested.pathname.endsWith('/bills.php') && action === 'list';
  const isExpenseList = requested.pathname.endsWith('/expenses.php');
  if (!isBillsList && !isExpenseList) return null;

  const rowsById = new Map();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(API_CACHE_PREFIX)) continue;
    let cachedUrl;
    try {
      cachedUrl = decodeURIComponent(key.slice(API_CACHE_PREFIX.length));
    } catch {
      continue;
    }

    let cachedRequest;
    try {
      cachedRequest = new URL(cachedUrl, window.location.href);
    } catch {
      continue;
    }
    if (cachedRequest.origin !== requested.origin || cachedRequest.pathname !== requested.pathname) continue;
    if (isBillsList && cachedRequest.searchParams.get('action') !== 'list') continue;
    if (isExpenseList &&
      (cachedRequest.searchParams.get('type') || 'business') !== (requested.searchParams.get('type') || 'business')) continue;

    const data = getCachedResponse(key)?.data;
    if (!Array.isArray(data)) continue;
    for (const row of data) {
      if (row?.id !== undefined) rowsById.set(String(row.id), row);
    }
  }

  const data = [...rowsById.values()];
  return {
    success: true,
    data,
    total: isBillsList ? data.length : data.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    page: Number(requested.searchParams.get('page')) || 1,
  };
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
  sheet_sale: 'Complete Sheets',
  only_cutting: 'Only Cutting',
  cnc_pipe: 'CNC + Pipe',
  fancy: 'Fancy / Sheets',
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
export const CNC_GAUGES = Array.from({ length: 30 }, (_, index) => index + 1);
export const PIPE_GAUGES = CNC_GAUGES;

export function getFrameGaugeLabel(frame, compact = false) {
  const cncGauge = String(frame.cnc_gauge || frame.gauge || '');
  const pipeGauge = String(frame.pipe_gauge || '');
  if (frame.bill_category === 'pipe_grill') return pipeGauge || String(frame.gauge || '');
  if (frame.bill_category === 'cnc_pipe' && pipeGauge) {
    return compact
      ? `CNC ${cncGauge.replace(/ Gauge/gi, '')} / P ${pipeGauge.replace(/ Gauge/gi, '')}`
      : `CNC ${cncGauge} / Pipe ${pipeGauge}`;
  }
  if (['fancy', 'bending_only', 'sheet_sale', 'only_cutting'].includes(frame.bill_category)) {
    return String(frame.gauge || cncGauge);
  }
  return cncGauge;
}

function getStockGaugeNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

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
  const cachedResponse = () => getCachedResponse(cacheKey) ?? getLegacyCachedResponse(requestUrl);

  if (method !== 'GET' && (!apiOnline || navigator.onLine === false)) {
    return enqueueOfflineWrite(url, method, parsedBody, writeKind, mutationId);
  }

  if (method === 'GET' && (!apiOnline || navigator.onLine === false)) {
    const cached = cachedResponse();
    if (cached !== null) return addQueuedChanges(url, cached);
    const fallback = getOfflineListFallback(url);
    if (fallback !== null) return addQueuedChanges(url, fallback);
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
      const fallback = getOfflineListFallback(url);
      if (fallback !== null) return addQueuedChanges(url, fallback);
    }
    if (method !== 'GET') return enqueueOfflineWrite(url, method, parsedBody, writeKind, mutationId);
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error('Could not connect to the server. Previously loaded data from this computer is available offline; try again when the connection is restored.');
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
      const fallback = getOfflineListFallback(url);
      if (fallback !== null) return addQueuedChanges(url, fallback);
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
    '\n📷 Image downloaded — attach it in WhatsApp Business (Gallery / Document).'
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
