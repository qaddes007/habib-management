<?php
require_once __DIR__ . '/../config/database.php';

set_exception_handler(function($e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $e->getMessage()]);
    exit;
});

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

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
                if ($type === 'personal') {
                    $db->prepare('UPDATE personal_expenses SET description=?, amount=?, expense_date=? WHERE id=?')
                       ->execute([$desc, $amount, $date, $id]);
                } else {
                    $db->prepare('UPDATE expenses SET description=?, amount=?, category=?, expense_date=? WHERE id=?')
                       ->execute([$desc, $amount, $cat, $date, $id]);
                }
                jsonResponse(['success' => true, 'id' => $id]);
            }

            if ($type === 'personal') {
                $db->prepare('INSERT INTO personal_expenses (description, amount, expense_date) VALUES (?,?,?)')
                   ->execute([$desc, $amount, $date]);
            } else {
                $db->prepare('INSERT INTO expenses (description, amount, category, expense_date) VALUES (?,?,?,?)')
                   ->execute([$desc, $amount, $cat, $date]);
            }
            jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);

        case 'DELETE':
            $id = (int)($_GET['id'] ?? 0);
            if ($id <= 0) jsonResponse(['error' => 'Invalid ID'], 400);
            $db->prepare("DELETE FROM $table WHERE id=?")->execute([$id]);
            jsonResponse(['success' => true]);

        default:
            jsonResponse(['error' => 'Method not allowed'], 405);
    }
} catch (Exception $e) {
    jsonResponse(['error' => $e->getMessage()], 500);
}
