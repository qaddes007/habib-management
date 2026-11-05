<?php
require_once __DIR__ . '/../security/request_guard.php';
enforceTrustedRequest();

/**
 * /api/sync.php — Live Sync Change-Token Endpoint
 * S. HABIB STEEL & LASER CRAFT
 *
 * Returns a lightweight JSON with a monotonic token incremented after each data change.
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

    ensureDataChangeCounterTable($db);
    $version = (int)$db->query('SELECT version FROM data_change_counter WHERE id=1')->fetchColumn();
    $token = substr(sha1((string)$version), 0, 12);

    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache');
    echo json_encode([
        'ok'    => true,
        'token' => $token,
        'ts'    => $version
    ]);
} catch (Exception $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
