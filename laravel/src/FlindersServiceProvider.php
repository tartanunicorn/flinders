<?php

namespace Flinders\Laravel;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

class FlindersServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/flinders.php', 'flinders');

        // A product's own binding of Connectors wins; otherwise the class named in config.
        $this->app->bindIf(Connectors::class, fn ($app) => $app->build(config('flinders.connectors')));
        $this->app->singleton(Flinders::class);
    }

    public function boot(): void
    {
        $this->loadMigrationsFrom(__DIR__.'/../database/migrations');
        $this->publishes([__DIR__.'/../config/flinders.php' => config_path('flinders.php')], 'flinders-config');

        if (config('flinders.routes.enabled')) {
            Route::prefix(config('flinders.routes.prefix'))
                ->middleware(config('flinders.routes.middleware'))
                ->group(__DIR__.'/../routes/flinders.php');
        }
    }
}
