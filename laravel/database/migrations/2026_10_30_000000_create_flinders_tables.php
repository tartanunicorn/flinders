<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// sql/001_walkthroughs.sql for MySQL 8. No down(): a version is never deleted.
return new class extends Migration
{
    public function getConnection(): ?string
    {
        return config('flinders.connection');
    }

    public function up(): void
    {
        $versions = config('flinders.tables.versions');
        $progress = config('flinders.tables.progress');
        $owner = config('flinders.owner_column');
        // Ids from a product are compared as Postgres compares text: exactly.
        $exact = 'utf8mb4_0900_bin';
        // MySQL names stop at 64 characters, and a table name can be most of that.
        $name = fn (string $table, string $what) => 'flinders_'.substr(md5($table), 0, 8)."_$what";
        $db = DB::connection($this->getConnection());
        $schema = Schema::connection($this->getConnection());

        $schema->create($versions, function (Blueprint $table) use ($versions, $owner, $exact, $name) {
            $table->uuid('id')->primary();
            $table->uuid('walkthrough_id');
            $table->string($owner, 191)->collation($exact)->nullable();
            $table->unsignedInteger('number');
            $table->unsignedInteger('version');
            $table->json('definition');
            $table->string('created_by', 191)->collation($exact)->nullable();
            $table->dateTime('created_at', 6);
            // A number belongs to one walkthrough per owner. NULLs repeat in a MySQL unique index, so
            // this is null on later versions and marks the product's own apart from any text value.
            $table->string('number_key', 210)->collation($exact)->nullable()
                ->virtualAs("IF(id = walkthrough_id, CONCAT(IF(`$owner` IS NULL, '-', '+'), number, ':', COALESCE(`$owner`, '')), NULL)");
            $table->unique(['walkthrough_id', 'version'], $name($versions, 'version'));
            $table->unique('number_key', $name($versions, 'number'));
            $table->index([$owner, 'number'], $name($versions, 'owner'));
            $table->foreign('walkthrough_id', $name($versions, 'original'))->references('id')->on($versions);
        });

        $schema->create($progress, function (Blueprint $table) use ($versions, $progress, $exact, $name) {
            $table->uuid('id')->primary();
            $table->string('user_id', 191)->collation($exact);
            $table->uuid('walkthrough_id');
            $table->unsignedInteger('seen_version');
            $table->string('status', 20);
            $table->unsignedInteger('last_step')->default(0);
            $table->unsignedInteger('furthest_step')->default(0);
            $table->unsignedInteger('actions_done')->default(0);
            $table->dateTime('updated_at', 6);
            $table->unique(['user_id', 'walkthrough_id'], $name($progress, 'person'));
            $table->foreign('walkthrough_id', $name($progress, 'walkthrough'))->references('id')->on($versions);
        });

        $db->statement("ALTER TABLE `$versions` ADD CONSTRAINT `{$name($versions, 'check')}` CHECK (number >= 1 AND version >= 1 AND JSON_TYPE(definition) = 'OBJECT' AND definition->>'$.status' IN ('draft', 'live', 'inactive'))");
        $db->statement("ALTER TABLE `$progress` ADD CONSTRAINT `{$name($progress, 'check')}` CHECK (seen_version >= 1 AND status IN ('started', 'paused', 'completed', 'dismissed'))");

        if (config('flinders.append_only_triggers')) {
            foreach (['UPDATE', 'DELETE'] as $action) {
                $db->unprepared("CREATE TRIGGER `{$name($versions, 'no_'.strtolower($action))}` BEFORE $action ON `$versions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This table is append-only: save the next version'");
            }
        }
    }
};
