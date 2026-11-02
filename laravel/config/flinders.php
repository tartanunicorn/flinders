<?php

return [
    // Where the contract's routes live, and what wraps them. Leave `auth` out of the middleware: a
    // route answers its own 401 in the contract's error shape.
    'routes' => [
        'enabled' => true,
        'prefix' => env('FLINDERS_PREFIX', 'flinders'),
        'middleware' => ['api'],
    ],

    // Null = the app's default connection.
    'connection' => env('FLINDERS_DB_CONNECTION'),

    // The two tables, named as you like, and the column saying who owns a walkthrough.
    'tables' => [
        'versions' => 'knowledge_base_walkthroughs',
        'progress' => 'knowledge_base_walkthroughs_progress',
    ],
    'owner_column' => 'owner_id',

    // Triggers that refuse an UPDATE or DELETE on the versions table. See the README if your host
    // won't let you create them.
    'append_only_triggers' => env('FLINDERS_APPEND_ONLY_TRIGGERS', true),

    // Who's signed in, what they may do, and what's in the app. Extend Connectors and name your
    // class here, or bind Connectors::class in a service provider.
    'connectors' => Flinders\Laravel\Connectors::class,

    // What the default Connectors reads.
    'guard' => null,
    'owner_attribute' => null,           // The user's company, as `company_id`. Null = no companies.
    'admin_ability' => 'manage-walkthroughs',
    'record_ability' => 'manage-walkthroughs',
    'anchors' => null,                   // A JSON file listing the app's elements. Null = not checked.
    'pages' => null,                     // A JSON file listing the app's route patterns. Null = not checked.
    'retired_words' => [],

    // Recording links. Without both, those routes answer feature_off.
    'recording' => [
        'secret' => env('FLINDERS_RECORDING_SECRET'),
        'web_url' => env('FLINDERS_WEB_URL'),
    ],
];
