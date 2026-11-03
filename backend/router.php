<?php
// S. HABIB STEEL & LASER CRAFT — Unified Server Router
// Handles /api/* calls and serves the React frontend (frontend/dist) with SPA fallback

// Allow CORS for dev server support
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// 1. API Routes
if (preg_match('#^/api/(bills|stock|expenses|reports|sync)\.php#', $uri, $m)) {
    require __DIR__ . '/api/' . $m[1] . '.php';
    return true;
}

// Health check
if ($uri === '/api/health') {
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'app' => 'S. HABIB Management API']);
    return true;
}

// Unknown API routes
if (str_starts_with($uri, '/api/')) {
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'API endpoint not found']);
    return true;
}

// 2. Static files from frontend/dist
$envDist = getenv('FRONTEND_DIST');
if ($envDist && is_dir($envDist)) {
    $distDir = rtrim($envDist, '/\\');
} elseif (is_dir(dirname(__DIR__) . '/frontend/dist')) {
    $distDir = dirname(__DIR__) . '/frontend/dist';
} else {
    $distDir = __DIR__ . '/../frontend/dist';
}
$filePath = $distDir . $uri;


// Prevent browser/Electron caching so updates are 100% instant
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if ($uri !== '/' && file_exists($filePath) && is_file($filePath)) {
    $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
    $mimes = [
        'js'    => 'application/javascript; charset=utf-8',
        'mjs'   => 'application/javascript; charset=utf-8',
        'css'   => 'text/css; charset=utf-8',
        'html'  => 'text/html; charset=utf-8',
        'json'  => 'application/json; charset=utf-8',
        'png'   => 'image/png',
        'jpg'   => 'image/jpeg',
        'jpeg'  => 'image/jpeg',
        'gif'   => 'image/gif',
        'svg'   => 'image/svg+xml',
        'ico'   => 'image/x-icon',
        'webp'  => 'image/webp',
        'woff'  => 'font/woff',
        'woff2' => 'font/woff2',
        'ttf'   => 'font/ttf',
    ];
    $contentType = $mimes[$ext] ?? 'application/octet-stream';
    header('Content-Type: ' . $contentType);
    readfile($filePath);
    return true;
}

// 3. SPA Fallback: serve index.html for all other routes
$indexHtml = $distDir . '/index.html';
if (file_exists($indexHtml)) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($indexHtml);
    return true;
}

return false;
