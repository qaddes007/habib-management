<?php
// Generates desktop app icons (PNG & multi-size Windows ICO) from the logo
$srcPath = __DIR__ . '/frontend/public/logo.png.jpeg';
$outDir = __DIR__ . '/assets';

if (!is_dir($outDir)) {
    mkdir($outDir, 0777, true);
}

if (!file_exists($srcPath)) {
    echo "Source image not found: $srcPath\n";
    exit(1);
}

// Load source image
$imgInfo = getimagesize($srcPath);
if (!$imgInfo) {
    echo "Failed to read image info\n";
    exit(1);
}

$srcWidth = $imgInfo[0];
$srcHeight = $imgInfo[1];
$mime = $imgInfo['mime'];

if ($mime === 'image/jpeg') {
    $srcImg = imagecreatefromjpeg($srcPath);
} elseif ($mime === 'image/png') {
    $srcImg = imagecreatefrompng($srcPath);
} else {
    echo "Unsupported mime: $mime\n";
    exit(1);
}

function createSquareIcon($srcImg, $srcWidth, $srcHeight, $size) {
    $dst = imagecreatetruecolor($size, $size);
    // Dark navy theme matching S. Habib Steel (#1a1f2e)
    $bg = imagecolorallocate($dst, 26, 31, 46);
    imagefill($dst, 0, 0, $bg);
    
    // Scale and center preserving aspect ratio with slight padding
    $pad = (int)($size * 0.06);
    $availSize = $size - ($pad * 2);
    $ratio = min($availSize / $srcWidth, $availSize / $srcHeight);
    $w = (int)($srcWidth * $ratio);
    $h = (int)($srcHeight * $ratio);
    $x = (int)(($size - $w) / 2);
    $y = (int)(($size - $h) / 2);
    
    imagecopyresampled($dst, $srcImg, $x, $y, 0, 0, $w, $h, $srcWidth, $srcHeight);
    
    ob_start();
    imagepng($dst, null, 9);
    $pngData = ob_get_clean();
    imagedestroy($dst);
    
    return $pngData;
}

// Generate PNGs
$png256 = createSquareIcon($srcImg, $srcWidth, $srcHeight, 256);
file_put_contents($outDir . '/app-icon.png', $png256);
file_put_contents(__DIR__ . '/frontend/public/app-icon.png', $png256);

// Build multi-size Windows .ICO file (256, 128, 64, 48, 32, 16)
$sizes = [256, 128, 64, 48, 32, 16];
$images = [];

foreach ($sizes as $sz) {
    $pngBytes = createSquareIcon($srcImg, $srcWidth, $srcHeight, $sz);
    $images[] = [
        'size' => $sz,
        'data' => $pngBytes,
        'len'  => strlen($pngBytes)
    ];
}

// Windows ICO format:
// Header: 6 bytes (idReserved=0, idType=1, idCount)
// Directory entries: 16 bytes each
// Image data: raw PNG bytes
$numImages = count($images);
$header = pack('vvv', 0, 1, $numImages);
$dirEntries = '';
$dataOffset = 6 + (16 * $numImages);
$allData = '';

foreach ($images as $img) {
    $bWidth = ($img['size'] >= 256) ? 0 : $img['size'];
    $bHeight = ($img['size'] >= 256) ? 0 : $img['size'];
    
    $dirEntries .= pack('CCCCvvVV',
        $bWidth,         // width
        $bHeight,        // height
        0,               // color count
        0,               // reserved
        1,               // color planes
        32,              // bits per pixel
        $img['len'],     // image size
        $dataOffset      // offset
    );
    
    $allData .= $img['data'];
    $dataOffset += $img['len'];
}

$icoContent = $header . $dirEntries . $allData;
file_put_contents($outDir . '/app-icon.ico', $icoContent);
file_put_contents(__DIR__ . '/frontend/public/favicon.ico', $icoContent);

imagedestroy($srcImg);
echo "Successfully generated app-icon.png and app-icon.ico (" . strlen($icoContent) . " bytes)\n";
