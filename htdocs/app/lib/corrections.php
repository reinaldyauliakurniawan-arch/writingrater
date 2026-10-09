<?php
declare(strict_types=1);

// Menempatkan koreksi (kutipan dari esai) di esai asli, lalu memotong esai jadi segmen untuk ditampilkan.
// Posisi dihitung dalam byte (UTF-8) di server; browser hanya menerima segmen teks jadi.

function loose_regex(string $quote): string
{
    $body = preg_quote(trim($quote), '/');
    $body = preg_replace('/\s+/u', '\\s+', $body);
    $body = preg_replace("/['‘’]/u", "['‘’]", $body);
    $body = preg_replace('/["“”]/u', '["“”]', $body);
    return '/' . $body . '/iu';
}

/** Daftar mark [start, end, type, issue, correction] (byte offset), urut dan tidak bertumpuk. */
function locate_corrections(string $essay, array $items): array
{
    $placed = [];
    $cursor = 0;
    foreach ($items as $item) {
        $quote = trim((string) ($item['quote'] ?? ''));
        if ($quote === '') continue;
        $hits = [];
        if (@preg_match_all(loose_regex($quote), $essay, $m, PREG_OFFSET_CAPTURE)) {
            foreach ($m[0] as [$text, $start]) $hits[] = ['start' => $start, 'end' => $start + strlen($text)];
        }
        $free = array_values(array_filter($hits, function ($h) use ($placed) {
            foreach ($placed as $p) if ($h['start'] < $p['end'] && $p['start'] < $h['end']) return false;
            return true;
        }));
        $exact = array_values(array_filter($free, fn($h) => substr($essay, $h['start'], $h['end'] - $h['start']) === $quote));
        $after = fn(array $list) => array_values(array_filter($list, fn($h) => $h['start'] >= $cursor))[0] ?? null;
        $hit = $after($exact) ?? ($exact[0] ?? null) ?? $after($free) ?? ($free[0] ?? null);
        if (!$hit) continue;
        $placed[] = $hit + ['type' => $item['type'], 'issue' => $item['issue'], 'correction' => $item['correction']];
        $cursor = $hit['end'];
    }
    usort($placed, fn($a, $b) => $a['start'] <=> $b['start']);
    return $placed;
}

/** Segmen [{text, mark|null}] dari teks dan mark. */
function to_segments(string $text, array $marks): array
{
    $out = [];
    $pos = 0;
    foreach ($marks as $m) {
        if ($m['start'] < $pos || $m['end'] > strlen($text)) continue;
        if ($m['start'] > $pos) $out[] = ['text' => substr($text, $pos, $m['start'] - $pos), 'mark' => null];
        $out[] = [
            'text' => substr($text, $m['start'], $m['end'] - $m['start']),
            'mark' => ['type' => $m['type'], 'issue' => $m['issue'], 'correction' => $m['correction']],
        ];
        $pos = $m['end'];
    }
    if ($pos < strlen($text)) $out[] = ['text' => substr($text, $pos), 'mark' => null];
    return $out;
}
