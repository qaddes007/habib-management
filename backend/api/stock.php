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
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

try {
    switch ($method) {
        case 'GET':
            if ($action === 'list') {
                $stmt = $db->query('SELECT * FROM sheet_stock ORDER BY material, gauge, sheet_size');
                $rows = $stmt->fetchAll();
                jsonResponse(['success' => true, 'data' => $rows]);
            }
            if ($action === 'summary') {
                // Usage summary from bills
                $stmt = $db->query("
                    SELECT bf.material, bf.cnc_material, bf.gauge, bf.cnc_gauge, bf.sheet_size,
                           SUM(CASE
                               WHEN bf.bill_category IN ('bending_sheet','only_cutting')
                                   THEN CAST(SUBSTRING_INDEX(LOWER(bf.sheet_size), 'x', 1) AS DECIMAL(10,2))
                                       * CAST(SUBSTRING_INDEX(LOWER(bf.sheet_size), 'x', -1) AS DECIMAL(10,2))
                               WHEN bf.bill_category = 'sheet_sale'
                                   THEN CAST(SUBSTRING_INDEX(LOWER(bf.sheet_size), 'x', 1) AS DECIMAL(10,2))
                                       * CAST(SUBSTRING_INDEX(LOWER(bf.sheet_size), 'x', -1) AS DECIMAL(10,2)) * bf.pcs
                               ELSE bf.area
                           END) as total_area, COUNT(*) as item_count
                    FROM bill_frames bf
                    JOIN bills b ON b.id = bf.bill_id
                    WHERE bf.bill_category IN ('cnc_only','cnc_pipe','bending_sheet','bending_only','sheet_sale','only_cutting')
                    GROUP BY bf.material, bf.cnc_material, bf.gauge, bf.cnc_gauge, bf.sheet_size
                ");
                jsonResponse(['success' => true, 'usage' => $stmt->fetchAll()]);
            }
            jsonResponse(['error' => 'Invalid action'], 400);

        case 'POST':
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input) jsonResponse(['error' => 'Invalid JSON'], 400);

            if ($action === 'add' || $action === 'update') {
                $mutationId = getOfflineMutationId();
                ensureOfflineMutationColumn($db, 'stock_log');
                if ($mutationId !== null) {
                    $existing = $db->prepare('SELECT stock_id FROM stock_log WHERE offline_mutation_id=?');
                    $existing->execute([$mutationId]);
                    $saved = $existing->fetch();
                    if ($saved) jsonResponse(['success' => true, 'id' => (int)$saved['stock_id']]);
                }

                $id = (int)($input['id'] ?? 0);
                $mat = trim($input['material'] ?? '');
                $gauge = trim($input['gauge'] ?? '');
                $size = trim($input['sheet_size'] ?? '4x8');
                $qty = (float)($input['quantity'] ?? 0);
                $kg = (float)($input['kg_per_sheet'] ?? 0);
                $notes = $input['notes'] ?? '';

                if (!$mat || !$gauge) jsonResponse(['error' => 'Material and gauge required'], 400);

                ensureDataChangeCounterTable($db);
                $db->beginTransaction();
                if ($id > 0) {
                    // Explicit row edit — set absolute quantity
                    $db->prepare('UPDATE sheet_stock SET material=?, gauge=?, sheet_size=?, quantity=?, kg_per_sheet=?, notes=? WHERE id=?')
                       ->execute([$mat, $gauge, $size, $qty, $kg, $notes, $id]);
                } else {
                    // Same material + gauge + size → ADD to existing qty (not replace)
                    $stmt = $db->prepare('SELECT id, quantity FROM sheet_stock WHERE material=? AND gauge=? AND sheet_size=? FOR UPDATE');
                    $stmt->execute([$mat, $gauge, $size]);
                    $exist = $stmt->fetch();
                    if ($exist) {
                        $newQty = (float)$exist['quantity'] + $qty;
                        if ($kg > 0) {
                            $db->prepare('UPDATE sheet_stock SET quantity=?, kg_per_sheet=?, notes=? WHERE id=?')
                               ->execute([$newQty, $kg, $notes, $exist['id']]);
                        } else {
                            $db->prepare('UPDATE sheet_stock SET quantity=?, notes=? WHERE id=?')
                               ->execute([$newQty, $notes, $exist['id']]);
                        }
                        $db->prepare('INSERT INTO stock_log (stock_id, bill_id, change_qty, reason, offline_mutation_id) VALUES (?,?,?,?,?)')
                           ->execute([$exist['id'], null, $qty, 'Stock add', $mutationId]);
                        $id = (int)$exist['id'];
                    } else {
                        $db->prepare('INSERT INTO sheet_stock (material, gauge, sheet_size, quantity, kg_per_sheet, notes) VALUES (?,?,?,?,?,?)')
                           ->execute([$mat, $gauge, $size, $qty, $kg, $notes]);
                        $id = (int)$db->lastInsertId();
                        $db->prepare('INSERT INTO stock_log (stock_id, bill_id, change_qty, reason, offline_mutation_id) VALUES (?,?,?,?,?)')
                           ->execute([$id, null, $qty, 'Stock add (new)', $mutationId]);
                    }
                }
                bumpDataChangeToken($db);
                $db->commit();
                jsonResponse(['success' => true, 'id' => $id]);
            }

            if ($action === 'adjust') {
                $mutationId = getOfflineMutationId();
                ensureOfflineMutationColumn($db, 'stock_log');
                $id = (int)($input['id'] ?? 0);
                $delta = (float)($input['delta'] ?? 0);
                $reason = $input['reason'] ?? 'Manual adjust';
                if ($id <= 0) jsonResponse(['error' => 'Invalid ID'], 400);
                if ($mutationId !== null) {
                    $existing = $db->prepare('SELECT stock_id FROM stock_log WHERE offline_mutation_id=?');
                    $existing->execute([$mutationId]);
                    $saved = $existing->fetch();
                    if ($saved) {
                        $quantity = $db->prepare('SELECT quantity FROM sheet_stock WHERE id=?');
                        $quantity->execute([$saved['stock_id']]);
                        jsonResponse(['success' => true, 'quantity' => (float)$quantity->fetchColumn()]);
                    }
                }

                ensureDataChangeCounterTable($db);
                $db->beginTransaction();
                $stmt = $db->prepare('SELECT * FROM sheet_stock WHERE id=? FOR UPDATE');
                $stmt->execute([$id]);
                $row = $stmt->fetch();
                if (!$row) { $db->rollBack(); jsonResponse(['error' => 'Not found'], 404); }

                $newQty = max(0, (float)$row['quantity'] + $delta);
                $db->prepare('UPDATE sheet_stock SET quantity=? WHERE id=?')->execute([$newQty, $id]);
                $db->prepare('INSERT INTO stock_log (stock_id, bill_id, change_qty, reason, offline_mutation_id) VALUES (?,?,?,?,?)')
                   ->execute([$id, null, $delta, $reason, $mutationId]);
                bumpDataChangeToken($db);
                $db->commit();
                jsonResponse(['success' => true, 'quantity' => $newQty]);
            }

            jsonResponse(['error' => 'Invalid action'], 400);

        case 'DELETE':
            $id = (int)($_GET['id'] ?? 0);
            if ($id <= 0) jsonResponse(['error' => 'Invalid ID'], 400);
            ensureDataChangeCounterTable($db);
            $db->beginTransaction();
            $delete = $db->prepare('DELETE FROM sheet_stock WHERE id=?');
            $delete->execute([$id]);
            if ($delete->rowCount() > 0) bumpDataChangeToken($db);
            $db->commit();
            jsonResponse(['success' => true]);

        default:
            jsonResponse(['error' => 'Method not allowed'], 405);
    }
} catch (Exception $e) {
    if ($db->inTransaction()) $db->rollBack();
    jsonResponse(['error' => $e->getMessage()], 500);
}
