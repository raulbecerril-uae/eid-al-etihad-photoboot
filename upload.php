<?php
// TEMPORARY local test endpoint: stores the posted photo in /photos and returns {"url":"photos/xxxx.jpg"}
header('Content-Type: application/json');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo '{"error":"POST only"}'; exit; }

$data = file_get_contents('php://input');
if ($data === false || strlen($data) < 100 || strlen($data) > 15 * 1024 * 1024) {
  http_response_code(400); echo '{"error":"bad size"}'; exit;
}
if (substr($data, 0, 3) === "\xFF\xD8\xFF")            $ext = 'jpg';
elseif (substr($data, 0, 8) === "\x89PNG\r\n\x1a\n")   $ext = 'png';
else { http_response_code(415); echo '{"error":"not a jpg/png"}'; exit; }

$dir = __DIR__ . '/photos';
if (!is_dir($dir) && !mkdir($dir, 0775, true)) { http_response_code(500); echo '{"error":"cannot create photos/"}'; exit; }

$name = date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
if (file_put_contents($dir . '/' . $name, $data) === false) { http_response_code(500); echo '{"error":"write failed"}'; exit; }

echo json_encode(['url' => 'photos/' . $name]);
