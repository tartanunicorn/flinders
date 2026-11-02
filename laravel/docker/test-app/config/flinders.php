<?php

// The published config, with this rig's connectors, guard and company attribute. The env names
// let a run prove renamed tables.
return [
    'routes' => ['enabled' => true, 'prefix' => 'flinders', 'middleware' => ['api']],
    'connection' => null,
    'tables' => [
        'versions' => env('RIG_VERSIONS_TABLE', 'walkthroughs'),
        'progress' => env('RIG_PROGRESS_TABLE', 'walkthroughs_progress'),
    ],
    'owner_column' => env('RIG_OWNER_COLUMN', 'owner_id'),
    'append_only_triggers' => true,
    'connectors' => App\Flinders\TestConnectors::class,
    'guard' => 'test',
    'owner_attribute' => 'company_id',
    'admin_ability' => 'manage-walkthroughs',
    'record_ability' => 'manage-walkthroughs',
    'anchors' => null,
    'pages' => null,
    'retired_words' => [],
    'recording' => ['secret' => env('FLINDERS_RECORDING_SECRET'), 'web_url' => env('FLINDERS_WEB_URL')],
];
