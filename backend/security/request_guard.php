<?php

function enforceTrustedRequest(): void
{
    static $checked = false;
    if ($checked) {
        return;
    }
    $checked = true;

    $allowedOrigins = [
        'http://127.0.0.1:8080',
        'http://localhost:8080',
        'http://127.0.0.1:5173',
        'http://localhost:5173',
    ];
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if ($origin !== '' && !in_array($origin, $allowedOrigins, true)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Untrusted request origin']);
        exit;
    }

    if ($origin !== '') {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-App-Token, X-Offline-Mutation-Id');
        http_response_code(204);
        exit;
    }

    $expectedToken = getenv('APP_API_TOKEN');
    if ($expectedToken !== false && $expectedToken !== '') {
        $providedToken = $_SERVER['HTTP_X_APP_TOKEN'] ?? '';
        if (!hash_equals($expectedToken, $providedToken)) {
            http_response_code(403);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['error' => 'Unauthorized API request']);
            exit;
        }
    }
}
