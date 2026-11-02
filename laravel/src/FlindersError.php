<?php

namespace Flinders\Laravel;

use RuntimeException;

/** A refusal: the status and code for the response, the message in plain words. */
final class FlindersError extends RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $errorCode, string $message)
    {
        parent::__construct($message);
    }

    public static function invalid(string $message): self
    {
        return new self(400, 'validation_failed', $message);
    }

    public static function notFound(string $message = 'Walkthrough not found.'): self
    {
        return new self(404, 'not_found', $message);
    }

    public static function featureOff(string $what): self
    {
        return new self(501, 'feature_off', "$what isn’t set up on this server.");
    }
}
