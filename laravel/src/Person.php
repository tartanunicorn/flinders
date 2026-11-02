<?php

namespace Flinders\Laravel;

/** Who's asking. `owner` is the company they belong to: null = the product's own. `user` is yours to carry. */
final class Person
{
    public function __construct(
        public readonly string $id,
        public readonly bool $admin = false,
        public readonly ?string $owner = null,
        public readonly mixed $user = null,
    ) {
    }
}
