<?php
require_once __DIR__ . '/../security/request_guard.php';
enforceTrustedRequest();

/**
 * /api/sync.php — Live Sync Change-Token Endpoint
 * S. HABIB STEEL & LASER CRAFT
 *
 * Returns a lightweight JSON with a "token" (SHA1 of latest updated_at timestamps).
 * Frontend polls this every 3s. If token changes, data was modified on any machine
 * connected to the same MySQL server — all clients auto-refresh their views.
 */
require dirname(__DIR__) . '/config/database.php';

try {
    $db = getDB();
    $db->exec("CREATE TABLE IF NOT EXISTS data_migration_batches (
        source_id VARCHAR(64) NOT NULL,
        batch_key VARCHAR(128) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source_id, batch_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Get the latest modification timestamp from all key tables
    // NOTE: column names must match the actual schema in database.sql
    $sql = "SELECT MAX(ts) AS latest FROM (
        SELECT MAX(updated_at) AS ts FROM bills
        UNION ALL
        SELECT MAX(updated_at) AS ts FROM sheet_stock
        UNION ALL
        SELECT MAX(created_at) AS ts FROM expenses
        UNION ALL
        SELECT MAX(created_at) AS ts FROM personal_expenses
        UNION ALL
        SELECT MAX(paid_at)    AS ts FROM payment_history
        UNION ALL
        SELECT MAX(created_at) AS ts FROM data_migration_batches
    ) combined";

    $row = $db->query($sql)->fetch(PDO::FETCH_ASSOC);
    $latest = $row['latest'] ?? date('Y-m-d H:i:s');

    // Token is a short hash of the timestamp — cheap to compare on the client
    $token = substr(sha1($latest), 0, 12);

    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache');
    echo json_encode([
        'ok'    => true,
        'token' => $token,
        'ts'    => $latest
    ]);
} catch (Exception $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
