<?php

namespace Tests\Feature;

use App\Models\DocumentRegister;
use App\Models\Sale;
use Illuminate\Support\Str;
use Tests\TestCase;

class NumberingTest extends TestCase
{
    /** @return array<string, mixed> */
    private function reserve(string $token, $business, string $device, int $size = 5): array
    {
        return $this->postJson('/api/v1/devices/number-blocks', [
            'requests' => [['document_type' => 'sale', 'date' => now('Asia/Kolkata')->toDateString(), 'size' => $size]],
        ], $this->headers($token, $business, $device))->assertOk()->json('data.0');
    }

    public function test_devices_reserve_disjoint_blocks(): void
    {
        [, $business, $token] = $this->createOwner();
        $a = $this->registerDevice($token, $business);
        $b = $this->registerDevice($token, $business);

        $blockA = $this->reserve($token, $business, $a, 5);
        $blockB = $this->reserve($token, $business, $b, 5);

        $this->assertSame([1, 5], [$blockA['start_number'], $blockA['end_number']]);
        $this->assertSame([6, 10], [$blockB['start_number'], $blockB['end_number']]);
        $this->assertSame('INV-{YYYY}-{SEQ:6}', $blockA['format']);
    }

    public function test_offline_number_from_a_reserved_block_is_kept(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);
        $block = $this->reserve($token, $business, $device);
        $year = now('Asia/Kolkata')->year;

        $response = $this->push($token, $business, $device, [
            $this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 1, 100, [
                'invoice_number' => "INV-{$year}-000002",
                'number_status' => 'final',
                'number_block_id' => $block['id'],
                'number_sequence' => 2,
            ]), $owner->id),
        ]);

        $this->assertSame("INV-{$year}-000002", $response->json('accepted.0.result.invoice_number'));
        $this->assertFalse($response->json('accepted.0.result.reassigned'));
    }

    public function test_provisional_numbers_get_a_final_number_on_sync(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);

        $saleId = (string) Str::uuid();
        $response = $this->push($token, $business, $device, [
            $this->op('CREATE_SALE', 'sale', $saleId, $this->salePayload($business, $productId, 1, 100, [
                'invoice_number' => 'TMP-C1-00001',
                'number_status' => 'provisional',
            ]), $owner->id),
        ]);

        $final = $response->json('accepted.0.result.invoice_number');
        $this->assertMatchesRegularExpression('/^INV-\d{4}-\d{6}$/', $final);
        $this->assertTrue($response->json('accepted.0.result.reassigned'));
        $sale = $this->inTenant($business, fn () => Sale::query()->find($saleId));
        $this->assertSame('TMP-C1-00001', $sale->provisional_number);
        $this->assertSame('final', $sale->number_status);
    }

    public function test_forged_or_reused_numbers_are_reassigned_never_duplicated(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $a = $this->registerDevice($token, $business);
        $b = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $a, $owner->id, 10);
        $blockA = $this->reserve($token, $business, $a);
        $year = now('Asia/Kolkata')->year;
        $claim = ['invoice_number' => "INV-{$year}-000001", 'number_status' => 'final', 'number_block_id' => $blockA['id'], 'number_sequence' => 1];

        $first = $this->push($token, $business, $a, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 1, 100, $claim), $owner->id)]);
        // Device B claims a number from device A's block.
        $second = $this->push($token, $business, $b, [$this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 1, 100, $claim), $owner->id)]);

        $this->assertSame("INV-{$year}-000001", $first->json('accepted.0.result.invoice_number'));
        $this->assertNotSame("INV-{$year}-000001", $second->json('accepted.0.result.invoice_number'));
        $this->assertTrue($second->json('accepted.0.result.reassigned'));
        $numbers = $this->inTenant($business, fn () => DocumentRegister::query()->where('document_type', 'sale')->pluck('number')->all());
        $this->assertSame(count($numbers), count(array_unique($numbers)));
    }

    public function test_per_device_series_format(): void
    {
        [$owner, $business, $token] = $this->createOwner();
        $device = $this->registerDevice($token, $business);
        $productId = $this->createStockedProduct($token, $business, $device, $owner->id, 10);
        $this->push($token, $business, $device, [
            $this->op('UPDATE_SETTING', 'setting', (string) Str::uuid(), ['key' => 'invoice', 'changes' => ['formats' => ['sale' => '{DEVICE}/{FYY}/{SEQ:4}']]], $owner->id),
        ])->assertJsonCount(1, 'accepted');

        $response = $this->push($token, $business, $device, [
            $this->op('CREATE_SALE', 'sale', (string) Str::uuid(), $this->salePayload($business, $productId, 1), $owner->id),
        ]);
        $this->assertMatchesRegularExpression('#^C1/\d{4}/0001$#', $response->json('accepted.0.result.invoice_number'));
    }
}
