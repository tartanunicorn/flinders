# A fresh Laravel app with the package installed from this folder, as a product would.
FROM php:8.4-cli-alpine
ARG LARAVEL_VERSION=^13
RUN apk add --no-cache unzip && docker-php-ext-install pdo_mysql
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
ENV COMPOSER_ALLOW_SUPERUSER=1
WORKDIR /srv
RUN composer create-project "laravel/laravel:${LARAVEL_VERSION}" app --no-interaction --prefer-dist
WORKDIR /srv/app

COPY . /package
RUN composer config repositories.flinders path /package \
 && composer require "flinders/laravel:*@dev" --no-interaction \
 && php artisan vendor:publish --tag=flinders-config

COPY docker/test-app/ ./
RUN sed -i 's/^];$/    App\\Providers\\TestProvider::class,\n];/' bootstrap/providers.php
