const BASE = '/api';

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
  let res;
  try {
    res = await fetch(BASE + url, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
  } catch (e) {
    throw new Error('API offline — start PHP server on port 8080 (php -S localhost:8080 router.php)');
  }
  const text = await res.text();
  if (!text || !text.trim()) {
    throw new Error('Empty API response — check PHP server is running on port 8080 and MySQL is started');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Invalid API response (not JSON). Is PHP server running? Open http://localhost:8080/api/health');
  }
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed');
  return data;
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
