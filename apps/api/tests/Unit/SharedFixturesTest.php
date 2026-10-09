<?php

namespace Tests\Unit;

use App\Domain\Numbering\DocumentNumberFormatter;
use App\Domain\Pricing\JewelleryPricing;
use App\Domain\Pricing\Money;
use App\Domain\Pricing\PricingEngine;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Runs the cross-language vectors in packages/shared/fixtures/pricing-cases.json against the PHP
 * engine. The TypeScript engine runs the same file, so a device and the server always agree.
 */
class SharedFixturesTest extends TestCase
{
    /** @return array<string, mixed> */
    private static function fixtures(): array
    {
        $path = dirname(__DIR__, 4).'/packages/shared/fixtures/pricing-cases.json';

        return json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    }

    /** @return iterable<string, array{0: array<string, mixed>, 1: array<string, mixed>}> */
    public static function pricingCases(): iterable
    {
        foreach (self::fixtures()['cases'] as $case) {
            yield $case['name'] => [$case['input'], $case['expected']];
        }
    }

    /** @param array<string, mixed> $input @param array<string, mixed> $expected */
    #[DataProvider('pricingCases')]
    public function test_pricing_matches_shared_vectors(array $input, array $expected): void
    {
        $this->assertSubset($expected, PricingEngine::calculate($input));
    }

    public function test_jewellery_and_old_gold_vectors(): void
    {
        $fixtures = self::fixtures();
        foreach ($fixtures['jewellery'] as $case) {
            $this->assertSubset($case['expected'], JewelleryPricing::price($case['input']), $case['name']);
        }
        foreach ($fixtures['old_gold'] as $case) {
            $this->assertSubset($case['expected'], JewelleryPricing::oldGold($case['input']), $case['name']);
        }
    }

    public function test_numbering_vectors(): void
    {
        foreach (self::fixtures()['numbering'] as $case) {
            $number = DocumentNumberFormatter::format($case['format'], $case['sequence'], $case['date'], $case['device'] ?? null, $case['store'] ?? null);
            $this->assertSame($case['expected'], $number);
            $this->assertSame($case['period'], DocumentNumberFormatter::period($case['format'], $case['date']));
        }
    }

    public function test_arithmetic_vectors(): void
    {
        $fixtures = self::fixtures();
        foreach ($fixtures['allocation'] as $case) {
            $this->assertSame($case['expected'], Money::allocate($case['total'], $case['weights']));
        }
        foreach ($fixtures['scaled'] as $case) {
            $this->assertSame($case['expected'], Money::toScaled($case['value'], $case['scale']), json_encode($case) ?: '');
        }
        foreach ($fixtures['div_round'] as $case) {
            $this->assertSame($case['expected'], Money::divRound($case['a'], $case['b']));
        }
    }

    public function test_gstin_checksum(): void
    {
        $this->assertTrue(PricingEngine::isValidGstin('27AAPFU0939F1ZV'));
        $this->assertFalse(PricingEngine::isValidGstin('27AAPFU0939F1ZX'));
    }

    public function test_money_overflow_falls_back_to_bcmath(): void
    {
        $this->assertSame(9_000_000_000_000, Money::mulDivRound(9_000_000_000_000, 10_000, 10_000));
        // Overflowing products keep the correct sign (regression: xor precedence).
        $this->assertSame(-9_000_000_000_000, Money::mulDivRound(-9_000_000_000_000, 10_000_000, 10_000_000));
        $this->assertSame(-9_000_000_000_000, Money::mulDivRound(9_000_000_000_000, 10_000_000, -10_000_000));
        $this->assertSame(9_000_000_000_000, Money::mulDivRound(-9_000_000_000_000, -10_000_000, 10_000_000));
        $this->assertSame('123.45', Money::toDecimalString(12345, 2));
        $this->assertSame('-0.05', Money::toDecimalString(-5, 2));
    }

    private function assertSubset(mixed $expected, mixed $actual, string $path = '$'): void
    {
        if (is_array($expected)) {
            $this->assertIsArray($actual, "{$path} should be an array");
            if (array_is_list($expected)) {
                $this->assertCount(count($expected), $actual, "{$path} length");
            }
            foreach ($expected as $key => $value) {
                $this->assertArrayHasKey($key, $actual, "{$path}.{$key} missing");
                $this->assertSubset($value, $actual[$key], "{$path}.{$key}");
            }

            return;
        }
        if (is_int($expected) || is_float($expected)) {
            $this->assertTrue(is_int($actual) || is_float($actual), "{$path} should be numeric");
            $this->assertEqualsWithDelta((float) $expected, (float) $actual, 1e-9, $path);

            return;
        }
        $this->assertSame($expected, $actual, $path);
    }
}
