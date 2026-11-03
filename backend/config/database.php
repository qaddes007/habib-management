<?php
date_default_timezone_set('Asia/Karachi');

// ============================================================
// Database Configuration - S. HABIB Management System
// ============================================================

define('DB_HOST', '127.0.0.1');
define('DB_NAME', 'habib_management');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_CHARSET', 'utf8mb4');

// App constants matching original
define('APP_NAME', 'S. HABIB STEEL & LASER CRAFT');
define('APP_TAGLINE', 'WE DEAL IN : HRC , CRC, GP ,GI, STAINLESS STEEL SHEETS,&ALSO LASER CUTTING');

define('STANDARD_SHEET_SIZES', [
    'MS-BLACK'  => ['4x8', '5x8', '4x10', '5x10'],
    'SS-SILVER' => ['4x8'],
    'SS-GOLDEN' => ['4x8'],
]);

define('SHEET_AREAS', [
    '4x8'  => 32.0,
    '5x8'  => 40.0,
    '4x10' => 40.0,
    '5x10' => 50.0,
]);

define('MS_GAUGES', [5,6,7,8,9,10,12,14,16,18,20,22,24,26,28,30]);
define('SS_GAUGES', [5,6,7,8,9,10,12,14,16,18,20,22,24,26,28,30]);
define('CNC_GAUGES', [5,6,7,8,9,10,12,14,16,18,20,22,24,26,28,30]);
define('PIPE_GAUGES', [5,6,7,8,9,10,12,14,16,18,20,22,24,26,28,30]);

define('STANDARD_MATERIALS', ['MS-BLACK', 'SS-SILVER', 'SS-GOLDEN']);
define('CNC_PIPE_MATERIALS', [
    'MS(Pipe)-MS-BLACK',
    'MS(Pipe)-SS-SILVER',
    'SS(Pipe)-SS-SILVER',
    'SS(Pipe)-MS-BLACK',
]);
define('PIPE_GRILL_MATERIALS', ['MS-PIPE', 'SS-PIPE']);

function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
            try { $pdo->exec("SET time_zone = '+05:00'"); } catch (Exception $e) {}
        } catch (PDOException $e) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            $msg = $e->getMessage();
            if (strpos($msg, 'Unknown database') !== false) {
                echo json_encode(['error' => 'Database not found. Import database.sql in phpMyAdmin first.']);
            } elseif (strpos($msg, 'Connection refused') !== false || strpos($msg, '2002') !== false) {
                echo json_encode(['error' => 'MySQL not running. Start MySQL in XAMPP.']);
            } else {
                echo json_encode(['error' => 'Database error: ' . $msg]);
            }
            exit;
        }
    }
    return $pdo;
}

function jsonResponse($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function getCompany(): array {
    $db = getDB();
    $stmt = $db->query('SELECT * FROM company WHERE id = 1');
    $row = $stmt->fetch();
    return $row ?: [];
}
