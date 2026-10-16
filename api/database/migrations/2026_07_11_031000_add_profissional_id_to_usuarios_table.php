<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Vínculo usuário↔profissional (§5/§12), adiado das fundações para esta change.
// unique: um profissional tem no máximo UM usuário (design D4).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('usuarios', function (Blueprint $table) {
            $table->foreignId('profissional_id')->nullable()->unique()
                ->constrained('profissionais')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('usuarios', function (Blueprint $table) {
            $table->dropConstrainedForeignId('profissional_id');
        });
    }
};
