<?php

use Illuminate\Support\Facades\Route;

// app é API pura — a SPA vive em web/ (health real em /up e /api/health)
Route::get('/', fn () => response()->json(['app' => 'xiax-agenda api']));
