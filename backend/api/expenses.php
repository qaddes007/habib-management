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
$type = $_GET['type'] ?? 'business'; // business | personal

$table = $type === 'personal' ? 'personal_expenses' : 'expenses';

try {
    switch ($method) {
        case 'GET':
            $dateFrom = $_GET['from'] ?? date('Y-m-d');
            $dateTo   = $_GET['to'] ?? date('Y-m-d');

            $stmt = $db->prepare("SELECT * FROM $table WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date DESC, id DESC");
            $stmt->execute([$dateFrom, $dateTo]);
            $rows = $stmt->fetchAll();

            $sumStmt = $db->prepare("SELECT COALESCE(SUM(amount),0) FROM $table WHERE expense_date BETWEEN ? AND ?");
            $sumStmt->execute([$dateFrom, $dateTo]);
            $total = (float)$sumStmt->fetchColumn();

            jsonResponse(['success' => true, 'data' => $rows, 'total' => $total]);

        case 'POST':
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input) jsonResponse(['error' => 'Invalid JSON'], 400);

            $desc = trim($input['description'] ?? '');
            $amount = (float)($input['amount'] ?? 0);
            $date = $input['expense_date'] ?? date('Y-m-d');
            $cat = $input['category'] ?? 'General';

            if ($desc === '' || $amount <= 0) jsonResponse(['error' => 'Description and amount required'], 400);

            // Update existing expense
            if ($action === 'update') {
                $id = (int)($input['id'] ?? 0);
                if ($id <= 0) jsonResponse(['error' => 'Invalid ID'], 400);
                $mutationId = getOfflineMutationId();
                if ($mutationId !== null) {
                    ensureOfflineMutationColumn($db, $table);
                    $existing = $db->prepare("SELECT id FROM `$table` WHERE offline_mutation_id=?");
                    $existing->execute([$mutationId]);
                    $saved = $existing->fetch();
                    if ($saved) jsonResponse(['success' => true, 'id' => (int)$saved['id']]);
                }
                $record = $db->prepare("SELECT id FROM `$table` WHERE id=?");
                $record->execute([$id]);
                if (!$record->fetch()) jsonResponse(['error' => 'Expense not found'], 404);
                if ($type === 'personal') {
                    $sql = 'UPDATE personal_expenses SET description=?, amount=?, expense_date=?';
                    $params = [$desc, $amount, $date];
                } else {
                    $sql = 'UPDATE expenses SET description=?, amount=?, category=?, expense_date=?';
                    $params = [$desc, $amount, $cat, $date];
                }
                if ($mutationId !== null) {
                    $sql .= ', offline_mutation_id=?';
                    $params[] = $mutationId;
                }
                $sql .= ' WHERE id=?';
                $params[] = $id;
                ensureDataChangeCounterTable($db);
                $db->beginTransaction();
                $db->prepare($sql)->execute($params);
                bumpDataChangeToken($db);
                $db->commit();
                jsonResponse(['success' => true, 'id' => $id]);
            }

            $mutationId = getOfflineMutationId();
            ensureOfflineMutationColumn($db, $table);
            if ($mutationId !== null) {
                $existing = $db->prepare("SELECT id FROM `$table` WHERE offline_mutation_id=?");
                $existing->execute([$mutationId]);
                $saved = $existing->fetch();
                if ($saved) jsonResponse(['success' => true, 'id' => (int)$saved['id']]);
            }

            ensureDataChangeCounterTable($db);
            $db->beginTransaction();
            if ($type === 'personal') {
                $db->prepare('INSERT INTO personal_expenses (description, amount, expense_date, offline_mutation_id) VALUES (?,?,?,?)')
                   ->execute([$desc, $amount, $date, $mutationId]);
            } else {
                $db->prepare('INSERT INTO expenses (description, amount, category, expense_date, offline_mutation_id) VALUES (?,?,?,?,?)')
                   ->execute([$desc, $amount, $cat, $date, $mutationId]);
            }
            bumpDataChangeToken($db);
            $newId = (int)$db->lastInsertId();
            $db->commit();
            jsonResponse(['success' => true, 'id' => $newId]);

        case 'DELETE':
            $id = (int)($_GET['id'] ?? 0);
            if ($id <= 0) jsonResponse(['error' => 'Invalid ID'], 400);
            ensureDataChangeCounterTable($db);
            $db->beginTransaction();
            $delete = $db->prepare("DELETE FROM $table WHERE id=?");
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
