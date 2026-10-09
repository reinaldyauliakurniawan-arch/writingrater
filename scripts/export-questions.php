<?php
declare(strict_types=1);

// Tulis ulang soal bawaan (htdocs/app/data/questions) dari isi database soal, supaya soal yang
// ditambahkan lewat app ikut terpasang di hosting lain lewat halaman /install.
// Jalankan dari folder proyek: php scripts/export-questions.php  (memakai htdocs/config.php)

define('REQUEST_START', microtime(true));
require dirname(__DIR__) . '/htdocs/app/bootstrap.php';
require_once APP_DIR . '/lib/storage.php';

$dir = APP_DIR . '/data/questions';
$imgDir = "$dir/images";

$rows = db_all('SELECT * FROM `question`');
usort($rows, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));

foreach (glob("$imgDir/*") ?: [] as $f) unlink($f);
if (!is_dir($imgDir)) mkdir($imgDir, 0775, true);

$items = [];
foreach ($rows as $q) {
    $image = null;
    if ($q['imagePath']) {
        $img = read_image($q['imagePath']);
        if (!$img) {
            fwrite(STDERR, "Lewati gambar yang hilang: {$q['name']}\n");
        } else {
            $slug = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($q['name'])), '-');
            $image = $slug . '.' . pathinfo($q['imagePath'], PATHINFO_EXTENSION);
            file_put_contents("$imgDir/$image", $img['data']);
        }
    }
    $items[] = [
        'name' => $q['name'],
        'task_type' => $q['taskType'],
        'prompt_text' => $q['promptText'],
        'image_file' => $image,
        'extracted_data' => json_decode_or_null($q['extractedData']),
    ];
}

file_put_contents("$dir/questions.json", json_encode($items, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
echo 'Ekspor selesai: ' . count($items) . " soal ke htdocs/app/data/questions.\n";
