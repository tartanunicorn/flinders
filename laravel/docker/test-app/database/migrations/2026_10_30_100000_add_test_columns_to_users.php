<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('api_token')->nullable();
            $table->string('company_id')->nullable();
            $table->boolean('is_admin')->default(false);
            $table->boolean('offer_walkthroughs')->nullable();
        });
    }
};
