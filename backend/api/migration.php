<?php
require_once __DIR__ . '/../security/request_guard.php';
enforceTrustedRequest();
require_once __DIR__ . '/../config/database.php';

function migrationBatchTable(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS data_migration_batches (
        source_id VARCHAR(64) NOT NULL,
        batch_key VARCHAR(128) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source_id, batch_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function migrationPage(PDO $db, string $table, int $cursor, int $limit = 10): array {
    $stmt = $db->prepare("SELECT * FROM `$table` WHERE id > ? ORDER BY id LIMIT " . ($limit + 1));
    $stmt->execute([$cursor]);
    $rows = $stmt->fetchAll();
    $hasMore = count($rows) > $limit;
    if ($hasMore) array_pop($rows);
    $next = $rows ? (int)end($rows)['id'] : $cursor;
    return ['records' => $rows, 'next_cursor' => $next, 'has_more' => $hasMore];
}

function insertMigratedRow(PDO $db, string $table, array $row, array $overrides = []): int {
    $columns = $db->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
    unset($row['id'], $row['offline_mutation_id']);
    $row = array_intersect_key($row, array_flip($columns));
    $row = array_merge($row, array_intersect_key($overrides, array_flip($columns)));
    $names = array_keys($row);
    if (!$names) throw new RuntimeException("No compatible columns found for `$table`.");
    $quotedNames = array_map(static fn($name) => "`$name`", $names);
    $placeholders = implode(',', array_fill(0, count($names), '?'));
    $stmt = $db->prepare(
        "INSERT INTO `$table` (" . implode(',', $quotedNames) . ") VALUES ($placeholders)"
    );
    $stmt->execute(array_values($row));
    return (int)$db->lastInsertId();
}

function importBill(PDO $db, array $bill): void {
    if (empty($bill['client_name']) || empty($bill['frames']) || !is_array($bill['frames'])) {
        throw new InvalidArgumentException('An imported bill is missing its client or frames.');
    }

    $originalSrNo = (int)($bill['sr_no'] ?? 0);
    $check = $db->prepare('SELECT id FROM bills WHERE sr_no=?');
    $check->execute([$originalSrNo]);
    if ($originalSrNo <= 0 || $check->fetch()) {
        $company = $db->query('SELECT next_sr_no FROM company WHERE id=1 FOR UPDATE')->fetch();
        $originalSrNo = max(1, (int)($company['next_sr_no'] ?? 1001));
        while (true) {
            $check->execute([$originalSrNo]);
            if (!$check->fetch()) break;
            $originalSrNo++;
        }
    }

    $billId = insertMigratedRow($db, 'bills', $bill, ['sr_no' => $originalSrNo]);
    $db->prepare('UPDATE company SET next_sr_no=GREATEST(next_sr_no, ?) WHERE id=1')
        ->execute([$originalSrNo + 1]);

    foreach ($bill['frames'] as $frame) {
        insertMigratedRow($db, 'bill_frames', $frame, ['bill_id' => $billId]);
    }
    foreach (($bill['payment_history'] ?? []) as $payment) {
        insertMigratedRow($db, 'payment_history', $payment, ['bill_id' => $billId]);
    }
    foreach (($bill['personal_expenses'] ?? []) as $expense) {
        insertMigratedRow($db, 'bill_personal_expenses', $expense, ['bill_id' => $billId]);
    }
}

function importStock(PDO $db, array $row): void {
    $material = trim((string)($row['material'] ?? ''));
    $gauge = trim((string)($row['gauge'] ?? ''));
    $size = trim((string)($row['sheet_size'] ?? ''));
    if ($material === '' || $gauge === '' || $size === '') {
        throw new InvalidArgumentException('An imported stock entry is missing its material, gauge, or size.');
    }
    $stmt = $db->prepare(
        'INSERT INTO sheet_stock (material, gauge, sheet_size, quantity, kg_per_sheet, notes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           quantity=quantity+VALUES(quantity),
           kg_per_sheet=IF(kg_per_sheet=0, VALUES(kg_per_sheet), kg_per_sheet),
           notes=IF(notes IS NULL OR notes="", VALUES(notes), notes)'
    );
    $stmt->execute([
        $material,
        $gauge,
        $size,
        (float)($row['quantity'] ?? 0),
        (float)($row['kg_per_sheet'] ?? 0),
        $row['notes'] ?? '',
    ]);
}

$db = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

try {
    if ($method === 'GET' && $action === 'export') {
        $kind = $_GET['kind'] ?? '';
        $cursor = max(0, (int)($_GET['cursor'] ?? 0));
        if ($kind === 'bill') {
            $page = migrationPage($db, 'bills', $cursor);
            foreach ($page['records'] as &$bill) {
                foreach ([
                    'frames' => 'bill_frames',
                    'payment_history' => 'payment_history',
                    'personal_expenses' => 'bill_personal_expenses',
                ] as $key => $table) {
                    $stmt = $db->prepare("SELECT * FROM `$table` WHERE bill_id=? ORDER BY id");
                    $stmt->execute([$bill['id']]);
                    $bill[$key] = $stmt->fetchAll();
                }
            }
            unset($bill);
        } elseif ($kind === 'expense') {
            $page = migrationPage($db, 'expenses', $cursor, 100);
        } elseif ($kind === 'personal_expense') {
            $page = migrationPage($db, 'personal_expenses', $cursor, 100);
        } elseif ($kind === 'stock') {
            $page = migrationPage($db, 'sheet_stock', $cursor, 100);
        } else {
            jsonResponse(['error' => 'Invalid migration export type.'], 400);
        }
        jsonResponse(['success' => true, 'kind' => $kind] + $page);
    }

    if ($method === 'POST' && $action === 'import') {
        $input = json_decode(file_get_contents('php://input'), true);
        $sourceId = (string)($input['source_id'] ?? '');
        $kind = (string)($input['kind'] ?? '');
        $cursor = max(0, (int)($input['cursor'] ?? 0));
        $records = $input['records'] ?? [];
        if (!preg_match('/^[A-Za-z0-9_-]{16,64}$/', $sourceId) || !is_array($records)) {
            jsonResponse(['error' => 'Invalid migration batch.'], 400);
        }

        migrationBatchTable($db);
        $batchKey = $kind . ':' . $cursor;
        $db->beginTransaction();
        $existing = $db->prepare('SELECT 1 FROM data_migration_batches WHERE source_id=? AND batch_key=?');
        $existing->execute([$sourceId, $batchKey]);
        if ($existing->fetchColumn()) {
            $db->commit();
            jsonResponse(['success' => true, 'already_imported' => true]);
        }

        if ($kind === 'complete') {
            $db->prepare('INSERT INTO data_migration_batches (source_id, batch_key) VALUES (?, ?)')
                ->execute([$sourceId, 'complete']);
        } elseif (!in_array($kind, ['bill', 'expense', 'personal_expense', 'stock'], true)) {
            $db->rollBack();
            jsonResponse(['error' => 'Invalid migration import type.'], 400);
        } else {
            foreach ($records as $record) {
                if (!is_array($record)) throw new InvalidArgumentException('An imported record is invalid.');
                if ($kind === 'bill') importBill($db, $record);
                elseif ($kind === 'expense') insertMigratedRow($db, 'expenses', $record);
                elseif ($kind === 'personal_expense') insertMigratedRow($db, 'personal_expenses', $record);
                else importStock($db, $record);
            }
            $db->prepare('INSERT INTO data_migration_batches (source_id, batch_key) VALUES (?, ?)')
                ->execute([$sourceId, $batchKey]);
        }
        $db->commit();
        jsonResponse(['success' => true]);
    }

    jsonResponse(['error' => 'Invalid migration request.'], 400);
} catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    jsonResponse(['error' => $e->getMessage()], 500);
}
