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

$db = getDB();
// ensure bend columns exist
try {
    $db->exec("ALTER TABLE bill_frames ADD COLUMN bend_rate DECIMAL(12,2) DEFAULT 0");
} catch (Exception $e) {}
try {
    $db->exec("ALTER TABLE bill_frames ADD COLUMN bend_count DECIMAL(12,2) DEFAULT 0");
} catch (Exception $e) {}
// Expand bill_category ENUM so bending_sheet / bending_only actually save
try {
    $db->exec("ALTER TABLE bill_frames MODIFY COLUMN bill_category ENUM('cnc_only','cnc_pipe','fancy','pipe_grill','bending_sheet','bending_only') DEFAULT 'cnc_only'");
} catch (Exception $e) {}
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

try {
    switch ($method) {
        case 'GET':
            if ($action === 'list') {
                $page = max(1, (int)($_GET['page'] ?? 1));
                $limit = min(100, max(10, (int)($_GET['limit'] ?? 50)));
                $offset = ($page - 1) * $limit;
                $search = trim($_GET['search'] ?? '');
                $status = $_GET['status'] ?? '';

                $where = [];
                $params = [];
                if ($search !== '') {
                    $where[] = '(client_name LIKE ? OR client_phone LIKE ? OR sr_no LIKE ?)';
                    $params[] = "%$search%";
                    $params[] = "%$search%";
                    $params[] = "%$search%";
                }
                if (in_array($status, ['PAID', 'PARTIAL', 'UNPAID'])) {
                    $where[] = 'payment_status = ?';
                    $params[] = $status;
                }
                $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

                $countStmt = $db->prepare("SELECT COUNT(*) FROM bills $whereSql");
                $countStmt->execute($params);
                $total = (int)$countStmt->fetchColumn();

                $stmt = $db->prepare("SELECT * FROM bills $whereSql ORDER BY sr_no DESC LIMIT $limit OFFSET $offset");
                $stmt->execute($params);
                $bills = $stmt->fetchAll();

                // Attach frame count
                foreach ($bills as &$b) {
                    $fs = $db->prepare('SELECT COUNT(*) FROM bill_frames WHERE bill_id = ?');
                    $fs->execute([$b['id']]);
                    $b['frame_count'] = (int)$fs->fetchColumn();
                }

                jsonResponse(['success' => true, 'data' => $bills, 'total' => $total, 'page' => $page]);
            }

            if ($action === 'get' && isset($_GET['id'])) {
                $id = (int)$_GET['id'];
                $stmt = $db->prepare('SELECT * FROM bills WHERE id = ?');
                $stmt->execute([$id]);
                $bill = $stmt->fetch();
                if (!$bill) jsonResponse(['error' => 'Bill not found'], 404);

                $fs = $db->prepare('SELECT * FROM bill_frames WHERE bill_id = ? ORDER BY serial');
                $fs->execute([$id]);
                $bill['frames'] = $fs->fetchAll();
                foreach ($bill['frames'] as &$f) {
                    $f['tags'] = json_decode($f['tags'] ?? '[]', true) ?: [];
                }

                $ps = $db->prepare('SELECT * FROM payment_history WHERE bill_id = ? ORDER BY paid_at');
                $ps->execute([$id]);
                $bill['payment_history'] = $ps->fetchAll();

                $pe = $db->prepare('SELECT * FROM bill_personal_expenses WHERE bill_id = ?');
                $pe->execute([$id]);
                $bill['personal_expenses'] = $pe->fetchAll();
                $bill['company'] = getCompany();

                jsonResponse(['success' => true, 'data' => $bill]);
            }

            if ($action === 'next_sr') {
                $comp = getCompany();
                jsonResponse(['success' => true, 'next_sr' => (int)($comp['next_sr_no'] ?? 1001)]);
            }

            jsonResponse(['error' => 'Invalid action'], 400);
            break;

        case 'POST':
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input) jsonResponse(['error' => 'Invalid JSON'], 400);

            if ($action === 'create' || $action === 'update') {
                $isUpdate = ($action === 'update');
                $billId = $isUpdate ? (int)($input['id'] ?? 0) : 0;
                $mutationId = $isUpdate ? null : getOfflineMutationId();
                if (!$isUpdate) {
                    ensureOfflineMutationColumn($db, 'bills');
                }
                if ($mutationId !== null) {
                    $existing = $db->prepare('SELECT id, sr_no FROM bills WHERE offline_mutation_id=?');
                    $existing->execute([$mutationId]);
                    $savedBill = $existing->fetch();
                    if ($savedBill) {
                        jsonResponse(['success' => true, 'bill_id' => (int)$savedBill['id'], 'sr_no' => (int)$savedBill['sr_no']]);
                    }
                }

                $clientName = trim($input['client_name'] ?? '');
                if ($clientName === '') jsonResponse(['error' => 'Client name required'], 400);

                $frames = $input['frames'] ?? [];
                if (empty($frames)) jsonResponse(['error' => 'At least one frame required'], 400);

                $db->beginTransaction();
                if (!$isUpdate) {
                    $db->query('SELECT id FROM company WHERE id=1 FOR UPDATE')->fetch();
                    if ($mutationId !== null) {
                        $existing = $db->prepare('SELECT id, sr_no FROM bills WHERE offline_mutation_id=?');
                        $existing->execute([$mutationId]);
                        $savedBill = $existing->fetch();
                        if ($savedBill) {
                            $db->commit();
                            jsonResponse(['success' => true, 'bill_id' => (int)$savedBill['id'], 'sr_no' => (int)$savedBill['sr_no']]);
                        }
                    }
                }

                // Calculate totals
                $grand = 0.0;
                foreach ($frames as $f) {
                    $pcs = max(1, (int)($f['pcs'] ?? 1));
                    $cat = $f['bill_category'] ?? 'cnc_only';
                    $bendRate = (float)($f['bend_rate'] ?? 0);
                    $bendCount = (float)($f['bend_count'] ?? 0);
                    $bendTotal = $bendRate * $bendCount;
                    if ($cat === 'fancy') {
                        $total = $pcs * (float)($f['direct_price'] ?? 0);
                    } elseif ($cat === 'bending_only') {
                        $total = $bendTotal;
                    } elseif ($cat === 'bending_sheet') {
                        $w = (float)($f['width'] ?? 0);
                        $l = (float)($f['length'] ?? 0);
                        $r = (float)($f['rate'] ?? 0);
                        $total = $w * $l * $pcs * $r + $bendTotal;
                    } else {
                        $w = (float)($f['width'] ?? 0);
                        $l = (float)($f['length'] ?? 0);
                        $r = (float)($f['rate'] ?? 0);
                        $total = $w * $l * $pcs * $r;
                    }
                    $extra = (float)($f['extra_item_price'] ?? 0);
                    $total += $extra;
                    $grand += $total;
                }

                $discount = max(0, (float)($input['discount'] ?? 0));
                $net = max(0, $grand - $discount);
                $paid = max(0, (float)($input['paid_amount'] ?? 0));
                $remaining = max(0, $net - $paid);
                $status = $remaining <= 0 ? 'PAID' : ($paid > 0 ? 'PARTIAL' : 'UNPAID');

                $personalTotal = 0;
                $personalExpenses = $input['personal_expenses'] ?? [];
                foreach ($personalExpenses as $pe) {
                    $personalTotal += (float)($pe['cost'] ?? 0);
                }

                if ($isUpdate) {
                    // Refund stock first
                    refundStockForBill($db, $billId);

                    $stmt = $db->prepare('UPDATE bills SET client_name=?, client_phone=?, grand_total=?, discount=?, net_total=?, paid_amount=?, remaining_balance=?, payment_status=?, personal_total=?, notes=?, updated_at=NOW() WHERE id=?');
                    $stmt->execute([
                        $clientName,
                        trim($input['client_phone'] ?? ''),
                        $grand, $discount, $net, $paid, $remaining, $status, $personalTotal,
                        $input['notes'] ?? '',
                        $billId
                    ]);

                    // Delete old frames & personal
                    $db->prepare('DELETE FROM bill_frames WHERE bill_id=?')->execute([$billId]);
                    $db->prepare('DELETE FROM bill_personal_expenses WHERE bill_id=?')->execute([$billId]);
                } else {
                    // Get next SR
                    $comp = getCompany();
                    $srNo = (int)($comp['next_sr_no'] ?? 1001);

                    $stmt = $db->prepare('INSERT INTO bills (sr_no, client_name, client_phone, grand_total, discount, net_total, paid_amount, remaining_balance, payment_status, personal_total, notes, offline_mutation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
                    $stmt->execute([
                        $srNo, $clientName, trim($input['client_phone'] ?? ''),
                        $grand, $discount, $net, $paid, $remaining, $status, $personalTotal,
                        $input['notes'] ?? '', $mutationId
                    ]);
                    $billId = (int)$db->lastInsertId();

                    // Increment next_sr
                    $db->prepare('UPDATE company SET next_sr_no = next_sr_no + 1 WHERE id=1')->execute();

                    // Initial payment history
                    $db->prepare('INSERT INTO payment_history (bill_id, amount, note) VALUES (?,?,?)')
                       ->execute([$billId, $paid, $paid > 0 ? 'Initial Payment' : 'Created - Unpaid']);
                }

                // Insert frames
                $serial = 1;
                foreach ($frames as $f) {
                    $pcs = max(1, (int)($f['pcs'] ?? 1));
                    $cat = $f['bill_category'] ?? 'cnc_only';
                    $w = (float)($f['width'] ?? 0);
                    $l = (float)($f['length'] ?? 0);
                    $r = (float)($f['rate'] ?? 0);
                    $dp = (float)($f['direct_price'] ?? 0);
                    $extra = (float)($f['extra_item_price'] ?? 0);

                    $bendRate = (float)($f['bend_rate'] ?? 0);
                    $bendCount = (float)($f['bend_count'] ?? 0);
                    $bendTotal = $bendRate * $bendCount;
                    if ($cat === 'fancy') {
                        $area = 0;
                        $total = $pcs * $dp + $extra;
                    } elseif ($cat === 'bending_only') {
                        $area = 0;
                        $total = $bendTotal + $extra;
                    } elseif ($cat === 'bending_sheet') {
                        $area = $w * $l * $pcs;
                        $total = $area * $r + $bendTotal + $extra;
                    } else {
                        $area = $w * $l * $pcs;
                        $total = $area * $r + $extra;
                    }

                    $tags = json_encode($f['tags'] ?? []);

                    $stmt = $db->prepare('INSERT INTO bill_frames 
                        (bill_id, serial, bill_category, material, pipe_material, cnc_material, gauge, pipe_gauge, cnc_gauge,
                         pcs, width, length, rate, direct_price, area, total, extra_item_name, extra_item_price, sheet_size,
                         tags, color_yes, color_no, fitting_yes, fitting_no,
                         pipe_tag_gauge, pipe_tag_size, gola_tag_gauge, gola_tag_size, master_tag_gauge, master_tag_size,
                         bend_rate, bend_count)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
                    $stmt->execute([
                        $billId, $serial++, $cat,
                        $f['material'] ?? '', $f['pipe_material'] ?? '', $f['cnc_material'] ?? ($f['material'] ?? ''),
                        $f['gauge'] ?? '', $f['pipe_gauge'] ?? '', $f['cnc_gauge'] ?? ($f['gauge'] ?? ''),
                        $pcs, $w, $l, $r, $dp, $area, $total,
                        $f['extra_item_name'] ?? '', $extra, $f['sheet_size'] ?? '4x8',
                        $tags,
                        !empty($f['color_yes']) ? 1 : 0, !empty($f['color_no']) ? 1 : 0,
                        !empty($f['fitting_yes']) ? 1 : 0, !empty($f['fitting_no']) ? 1 : 0,
                        $f['pipe_tag_gauge'] ?? '', $f['pipe_tag_size'] ?? '',
                        $f['gola_tag_gauge'] ?? '', $f['gola_tag_size'] ?? '',
                        $f['master_tag_gauge'] ?? '', $f['master_tag_size'] ?? '',
                        $bendRate, $bendCount
                    ]);
                }

                // Personal expenses
                foreach ($personalExpenses as $pe) {
                    $db->prepare('INSERT INTO bill_personal_expenses (bill_id, description, cost) VALUES (?,?,?)')
                       ->execute([$billId, $pe['description'] ?? '', (float)($pe['cost'] ?? 0)]);
                }

                // Consume stock for CNC categories
                consumeStockForBill($db, $billId);

                // If update and paid changed, add payment history entry
                if ($isUpdate && isset($input['new_payment']) && (float)$input['new_payment'] > 0) {
                    $db->prepare('INSERT INTO payment_history (bill_id, amount, note) VALUES (?,?,?)')
                       ->execute([$billId, (float)$input['new_payment'], $input['payment_note'] ?? 'Payment']);
                }

                $db->commit();
                jsonResponse(['success' => true, 'bill_id' => $billId, 'sr_no' => $isUpdate ? null : $srNo]);
            }

            if ($action === 'add_payment') {
                $billId = (int)($input['bill_id'] ?? 0);
                $amount = (float)($input['amount'] ?? 0);
                $note = $input['note'] ?? 'Payment';
                if ($billId <= 0 || $amount <= 0) jsonResponse(['error' => 'Invalid data'], 400);
                $mutationId = getOfflineMutationId();
                ensureOfflineMutationColumn($db, 'payment_history');
                if ($mutationId !== null) {
                    $existing = $db->prepare('SELECT id FROM payment_history WHERE offline_mutation_id=?');
                    $existing->execute([$mutationId]);
                    if ($existing->fetch()) {
                        $current = $db->prepare('SELECT paid_amount, remaining_balance, payment_status FROM bills WHERE id=?');
                        $current->execute([$billId]);
                        $bill = $current->fetch();
                        if (!$bill) jsonResponse(['error' => 'Bill not found'], 404);
                        jsonResponse([
                            'success' => true,
                            'paid_amount' => (float)$bill['paid_amount'],
                            'remaining' => (float)$bill['remaining_balance'],
                            'status' => $bill['payment_status'],
                        ]);
                    }
                }

                $db->beginTransaction();
                $stmt = $db->prepare('SELECT * FROM bills WHERE id=? FOR UPDATE');
                $stmt->execute([$billId]);
                $bill = $stmt->fetch();
                if (!$bill) { $db->rollBack(); jsonResponse(['error' => 'Bill not found'], 404); }

                $newPaid = (float)$bill['paid_amount'] + $amount;
                $remaining = max(0, (float)$bill['net_total'] - $newPaid);
                $status = $remaining <= 0 ? 'PAID' : 'PARTIAL';

                $db->prepare('UPDATE bills SET paid_amount=?, remaining_balance=?, payment_status=? WHERE id=?')
                   ->execute([$newPaid, $remaining, $status, $billId]);
                $db->prepare('INSERT INTO payment_history (bill_id, amount, note, offline_mutation_id) VALUES (?,?,?,?)')
                   ->execute([$billId, $amount, $note, $mutationId]);
                $db->commit();
                jsonResponse(['success' => true, 'paid_amount' => $newPaid, 'remaining' => $remaining, 'status' => $status]);
            }

            jsonResponse(['error' => 'Invalid action'], 400);
            break;

        case 'DELETE':
            $id = (int)($_GET['id'] ?? 0);
            if ($id <= 0) jsonResponse(['error' => 'Invalid ID'], 400);

            $db->beginTransaction();
            refundStockForBill($db, $id);
            $db->prepare('DELETE FROM bills WHERE id=?')->execute([$id]);
            $db->commit();
            jsonResponse(['success' => true]);
            break;

        default:
            jsonResponse(['error' => 'Method not allowed'], 405);
    }
} catch (Exception $e) {
    if ($db->inTransaction()) $db->rollBack();
    jsonResponse(['error' => $e->getMessage()], 500);
}

// ---------- Stock helpers ----------
/** Map CNC+Pipe labels like MS(Pipe)-MS-CNC → MS-CNC for stock only */
function normalizeSheetMaterial(string $mat): ?string {
    $mat = trim($mat);
    if ($mat === '' || stripos($mat, 'Write Own') !== false) return null;
    // Pure sheet materials (canonical names + legacy aliases)
    $bases = ['MS-CNC', 'SS-CNC', 'SG-CNC', 'GP', 'MS-BLACK', 'SS-SILVER', 'SS-GOLDEN'];
    foreach ($bases as $base) {
        if (strcasecmp($mat, $base) === 0) {
            // Normalize legacy names → new names for stock match
            if (strcasecmp($base, 'MS-BLACK') === 0) return 'MS-CNC';
            if (strcasecmp($base, 'SS-SILVER') === 0) return 'SS-CNC';
            if (strcasecmp($base, 'SS-GOLDEN') === 0) return 'SG-CNC';
            return $base;
        }
        // e.g. MS(Pipe)-MS-CNC or SS(Pipe)-SS-CNC
        if (preg_match('/' . preg_quote($base, '/') . '$/i', $mat)) {
            if (strcasecmp($base, 'MS-BLACK') === 0) return 'MS-CNC';
            if (strcasecmp($base, 'SS-SILVER') === 0) return 'SS-CNC';
            if (strcasecmp($base, 'SS-GOLDEN') === 0) return 'SG-CNC';
            return $base;
        }
    }
    // Pipe-only materials never consume sheet stock
    if (preg_match('/PIPE/i', $mat) && !preg_match('/MS-CNC|SS-CNC|SG-CNC|MS-BLACK|SS-SILVER|SS-GOLDEN/i', $mat)) {
        return null;
    }
    return null;
}

function consumeStockForBill(PDO $db, int $billId): void {
    $stmt = $db->prepare("SELECT * FROM bill_frames WHERE bill_id=? AND bill_category IN ('cnc_only','cnc_pipe','bending_sheet')");
    $stmt->execute([$billId]);
    $frames = $stmt->fetchAll();

    foreach ($frames as $f) {
        $raw = $f['cnc_material'] ?: $f['material'];
        $mat = normalizeSheetMaterial((string)$raw);
        if (!$mat) continue; // skip pipe-only / unknown

        $gauge = $f['cnc_gauge'] ?: $f['gauge'];
        $size = $f['sheet_size'] ?: '4x8';
        $area = (float)$f['area'];
        $sheetArea = SHEET_AREAS[$size] ?? 32.0;
        $sheetsNeeded = $area > 0 ? round($area / $sheetArea, 2) : 0;

        if ($sheetsNeeded <= 0) continue;

        // Match gauge flexibly: "12 Gauge" or "12"
        $gaugeNum = preg_replace('/[^0-9]/', '', (string)$gauge);
        $s = $db->prepare('SELECT * FROM sheet_stock WHERE material=? AND sheet_size=? AND (gauge=? OR gauge=? OR gauge LIKE ?)');
        $s->execute([$mat, $size, $gauge, $gaugeNum . ' Gauge', '%' . $gaugeNum . '%']);
        $stock = $s->fetch();

        if ($stock) {
            $newQty = max(0, (float)$stock['quantity'] - $sheetsNeeded);
            $db->prepare('UPDATE sheet_stock SET quantity=? WHERE id=?')->execute([$newQty, $stock['id']]);
            $db->prepare('INSERT INTO stock_log (stock_id, bill_id, change_qty, reason) VALUES (?,?,?,?)')
               ->execute([$stock['id'], $billId, -$sheetsNeeded, 'Bill consumption']);
        }
    }
}

function refundStockForBill(PDO $db, int $billId): void {
    // Get previous log entries for this bill and reverse them
    $logs = $db->prepare('SELECT * FROM stock_log WHERE bill_id=? AND change_qty < 0');
    $logs->execute([$billId]);
    foreach ($logs->fetchAll() as $log) {
        $db->prepare('UPDATE sheet_stock SET quantity = quantity + ? WHERE id=?')
           ->execute([abs($log['change_qty']), $log['stock_id']]);
        $db->prepare('INSERT INTO stock_log (stock_id, bill_id, change_qty, reason) VALUES (?,?,?,?)')
           ->execute([$log['stock_id'], $billId, abs($log['change_qty']), 'Refund on edit/delete']);
    }
}
