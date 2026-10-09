<?php
/** Sisipkan data awal halaman untuk JavaScript: <script type="application/json" id="page-data">. */
function page_data(string $page, array $data): string
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_PRESERVE_ZERO_FRACTION);
    return '<div id="app" data-page="' . e($page) . '"></div><script type="application/json" id="page-data">' . $json . '</script>';
}
