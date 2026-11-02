<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class TestSeeder extends Seeder
{
    public function run(): void
    {
        $users = [
            'admin' => [true, null],
            'person' => [false, null],
            'person2' => [false, null],
            'otherAdmin' => [true, 'another-owner'],
        ];
        foreach ($users as $token => [$admin, $company]) {
            User::forceCreate([
                'name' => $token,
                'email' => "$token@example.com",
                'password' => 'not-used',
                'api_token' => $token,
                'is_admin' => $admin,
                'company_id' => $company,
            ]);
        }
    }
}
