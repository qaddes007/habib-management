<?php
require_once __DIR__ . '/../security/request_guard.php';
enforceTrustedRequest();
require_once __DIR__ . '/../config/database.php';

set_exception_handler(function($e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $e->getMessage()]);
    exit;
});

// Pakistan timezone so bill dates match reports
date_default_timezone_set('Asia/Karachi');

$db = getDB();
try {
    $db->exec("SET time_zone = '+05:00'");
} catch (Exception $e) { /* ignore if not allowed */ }

$period = $_GET['period'] ?? 'all';

$today = date('Y-m-d');
// always include tomorrow buffer so TZ never hides today's bills
$to = date('Y-m-d', strtotime('+1 day'));

// Specific calendar month: period=2026-03
if (preg_match('/^\d{4}-\d{2}$/', $period)) {
    $from = $period . '-01';
    $lastDay = date('Y-m-t', strtotime($from));
    $to = date('Y-m-d', strtotime($lastDay . ' +1 day'));
} elseif (preg_match('/^year:(\d{4})$/', $period, $ym)) {
    // Full calendar year
    $from = $ym[1] . '-01-01';
    $to = date('Y-m-d', strtotime(($ym[1] + 1) . '-01-01'));
} else {
    switch ($period) {
        case 'weekly':
            // Working week: Saturday → Thursday
            // PHP: 0=Sun ... 6=Sat
            $dow = (int)date('w'); // today
            if ($dow === 6) {
                // Saturday = start of this week
                $from = $today;
            } elseif ($dow === 5) {
                // Friday = off / after week → last week's Saturday
                $from = date('Y-m-d', strtotime('last saturday'));
            } elseif ($dow === 0) {
                // Sunday → this week's Saturday was yesterday
                $from = date('Y-m-d', strtotime('yesterday')); // sat
            } else {
                // Mon(1)–Thu(4): go back to most recent Saturday
                $from = date('Y-m-d', strtotime('last saturday'));
            }
            // End = Thursday of same week (Sat+5) or today if earlier
            $weekThu = date('Y-m-d', strtotime($from . ' +5 days'));
            $to = date('Y-m-d', strtotime(min($weekThu, $today) . ' +1 day'));
            break;
        case 'monthly':
            $from = date('Y-m-01');
            break;
        case 'daily':
            $from = date('Y-m-d', strtotime('-1 day'));
            break;
        case 'all':
        default:
            $from = '2000-01-01';
            break;
    }
}

try {
    $stmt = $db->prepare("
        SELECT 
            COUNT(*) as bill_count,
            COALESCE(SUM(grand_total),0) as gross_total,
            COALESCE(SUM(discount),0) as total_discount,
            COALESCE(SUM(net_total),0) as net_total,
            COALESCE(SUM(paid_amount),0) as total_paid,
            COALESCE(SUM(remaining_balance),0) as total_remaining,
            COALESCE(SUM(personal_total),0) as bill_personal
        FROM bills
        WHERE DATE(created_at) BETWEEN ? AND ?
    ");
    $stmt->execute([$from, $to]);
    $revenue = $stmt->fetch();

    $stmt = $db->prepare("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE expense_date BETWEEN ? AND ?");
    $stmt->execute([$from, $to]);
    $bizExp = (float)$stmt->fetchColumn();

    $stmt = $db->prepare("SELECT COALESCE(SUM(amount),0) FROM personal_expenses WHERE expense_date BETWEEN ? AND ?");
    $stmt->execute([$from, $to]);
    $persExp = (float)$stmt->fetchColumn();

    $totalPersonal = $persExp + (float)$revenue['bill_personal'];
    $collected = (float)$revenue['total_paid'];
    $profit = $collected - $totalPersonal - $bizExp;

    $stmt = $db->prepare("
        SELECT COALESCE(NULLIF(TRIM(bf.bill_category), ''), 'cnc_only') as bill_category,
               COUNT(*) as items, COALESCE(SUM(bf.total),0) as amount
        FROM bill_frames bf
        JOIN bills b ON b.id = bf.bill_id
        WHERE DATE(b.created_at) BETWEEN ? AND ?
        GROUP BY COALESCE(NULLIF(TRIM(bf.bill_category), ''), 'cnc_only')
        ORDER BY amount DESC
    ");
    $stmt->execute([$from, $to]);
    $byCategory = $stmt->fetchAll();

    // Client-wise totals for period
    $stmt = $db->prepare("
        SELECT b.client_name,
               COUNT(*) as bills,
               COALESCE(SUM(b.net_total),0) as net_total,
               COALESCE(SUM(b.paid_amount),0) as paid,
               COALESCE(SUM(b.remaining_balance),0) as remaining,
               MAX(b.created_at) as last_date
        FROM bills b
        WHERE DATE(b.created_at) BETWEEN ? AND ?
        GROUP BY b.client_name
        ORDER BY net_total DESC
    ");
    $stmt->execute([$from, $to]);
    $byClient = $stmt->fetchAll();

    // All CNC frame usage — MS-CNC / SS-CNC / SG-CNC / GP (legacy aliases mapped)
    $stmt = $db->prepare("
        SELECT
            bf.material,
            bf.cnc_material,
            bf.gauge,
            bf.cnc_gauge,
            bf.pipe_gauge,
            bf.sheet_size,
            bf.area,
            bf.total,
            bf.rate,
            bf.bill_category,
            bf.pcs,
            b.created_at as used_at,
            b.sr_no,
            b.client_name
        FROM bill_frames bf
        JOIN bills b ON b.id = bf.bill_id
        WHERE DATE(b.created_at) BETWEEN ? AND ?
        ORDER BY b.created_at DESC
    ");
    $stmt->execute([$from, $to]);
    $rawFrames = $stmt->fetchAll();

    $agg = [];
    $usageDetail = [];
    foreach ($rawFrames as $row) {
        $rawMat = trim($row['cnc_material'] ?: $row['material'] ?: '');
        if ($rawMat === '') $rawMat = '(no material)';
        $base = $rawMat;
        // normalize known sheet bases from composites + legacy names
        foreach (['MS-CNC', 'SS-CNC', 'SG-CNC', 'GP', 'MS-BLACK', 'SS-SILVER', 'SS-GOLDEN'] as $b) {
            if (strcasecmp($rawMat, $b) === 0 || preg_match('/' . preg_quote($b, '/') . '$/i', $rawMat)) {
                $base = $b;
                if (strcasecmp($b, 'MS-BLACK') === 0) $base = 'MS-CNC';
                if (strcasecmp($b, 'SS-SILVER') === 0) $base = 'SS-CNC';
                if (strcasecmp($b, 'SS-GOLDEN') === 0) $base = 'SG-CNC';
                break;
            }
        }

        if ($row['bill_category'] === 'pipe_grill') {
            $gauge = $row['pipe_gauge'] ?: $row['gauge'] ?: '';
        } elseif (in_array($row['bill_category'], ['cnc_only', 'cnc_pipe'], true)) {
            $gauge = $row['cnc_gauge'] ?: $row['gauge'] ?: '';
        } else {
            $gauge = $row['gauge'] ?: $row['cnc_gauge'] ?: '';
        }
        $size = $row['sheet_size'] ?: '';
        $pcs = max(1, (int)$row['pcs']);
        $lineTotal = (float)($row['total'] ?? 0);
        $cat = $row['bill_category'] ?? '';
        $area = (float)$row['area'];
        if (in_array($cat, ['bending_sheet', 'only_cutting'], true)) {
            if (preg_match('/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i', $size, $matches)) {
                $area = (float)$matches[1] * (float)$matches[2];
            }
        } elseif ($cat === 'sheet_sale' && $area === 0.0 && preg_match('/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i', $size, $matches)) {
            $area = (float)$matches[1] * (float)$matches[2] * $pcs;
        }

        $key = $base . '|' . $gauge . '|' . $size . '|' . $cat;
        if (!isset($agg[$key])) {
            $agg[$key] = [
                'material' => $base,
                'gauge' => $gauge,
                'sheet_size' => $size,
                'bill_category' => $cat,
                'total_area' => 0,
                'total_amount' => 0,
                'items' => 0,
                'clients' => [],
            ];
        }
        $agg[$key]['total_area'] += $area;
        $agg[$key]['total_amount'] += $lineTotal;
        $agg[$key]['items'] += $pcs;
        $cn = $row['client_name'] ?? '';
        if ($cn && !in_array($cn, $agg[$key]['clients'])) {
            $agg[$key]['clients'][] = $cn;
        }

        $usageDetail[] = [
            'material' => $base,
            'gauge' => $gauge,
            'sheet_size' => $size,
            'bill_category' => $cat,
            'area' => $area,
            'pcs' => $pcs,
            'amount' => $lineTotal,
            'sr_no' => $row['sr_no'],
            'client_name' => $row['client_name'],
            'used_at' => $row['used_at'],
        ];
    }
    // clients as comma string for JSON simplicity
    foreach ($agg as &$a) {
        $a['clients'] = implode(', ', $a['clients']);
    }
    unset($a);
    $materialUsage = array_values($agg);

    $stock = $db->query('SELECT * FROM sheet_stock ORDER BY material, gauge, sheet_size')->fetchAll();

    $stmt = $db->prepare("SELECT id, sr_no, client_name, net_total, paid_amount, remaining_balance, payment_status, created_at 
                          FROM bills WHERE DATE(created_at) BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 50");
    $stmt->execute([$from, $to]);
    $recentBills = $stmt->fetchAll();

    jsonResponse([
        'success' => true,
        'period' => $period,
        'from' => $from,
        'to' => $today, // show real today to UI, query used $to buffer
        'revenue' => $revenue,
        'business_expenses' => $bizExp,
        'personal_expenses' => $totalPersonal,
        'profit' => $profit,
        'by_category' => $byCategory,
        'by_client' => $byClient,
        'material_usage' => $materialUsage,
        'usage_detail' => $usageDetail,
        'stock' => $stock,
        'recent_bills' => $recentBills,
    ]);
} catch (Exception $e) {
    jsonResponse(['error' => $e->getMessage()], 500);
}
