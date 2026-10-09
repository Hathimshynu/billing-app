<?php

namespace App\Domain\Business;

/**
 * Business type registry. Mirrors packages/shared/src/business.ts (defaults used at onboarding).
 */
final class BusinessTypes
{
    public const TYPES = [
        'supermarket', 'pharmacy', 'jewellery', 'mobile', 'electronics', 'clothing', 'hardware',
        'bakery', 'restaurant', 'general', 'wholesale', 'service', 'custom',
    ];

    public const MODULES = [
        'batches', 'expiry', 'serials', 'warranty', 'variants', 'weighing', 'jewellery', 'restaurant',
        'prescription', 'loyalty', 'wholesale_pricing', 'services',
    ];

    /** @var array<string, array{modules: list<string>, categories: list<string>, units: list<string>, taxes: list<float|int>, inclusive: bool}> */
    public const DEFAULTS = [
        'supermarket' => ['modules' => ['weighing', 'expiry', 'loyalty', 'variants'], 'categories' => ['Groceries', 'Fruits & Vegetables', 'Dairy', 'Beverages', 'Snacks', 'Personal Care', 'Household'], 'units' => ['pcs', 'kg', 'g', 'l', 'ml', 'pkt', 'box', 'dozen'], 'taxes' => [0, 5, 12, 18], 'inclusive' => true],
        'pharmacy' => ['modules' => ['batches', 'expiry', 'prescription'], 'categories' => ['Tablets', 'Capsules', 'Syrups', 'Injections', 'Ointments', 'Surgical', 'OTC', 'Personal Care'], 'units' => ['strip', 'pcs', 'bottle', 'box', 'tube', 'vial'], 'taxes' => [0, 5, 12, 18], 'inclusive' => true],
        'jewellery' => ['modules' => ['jewellery'], 'categories' => ['Gold Ornaments', 'Silver Ornaments', 'Diamond', 'Platinum', 'Coins & Bars'], 'units' => ['pcs', 'g'], 'taxes' => [3], 'inclusive' => false],
        'mobile' => ['modules' => ['serials', 'warranty', 'variants'], 'categories' => ['Smartphones', 'Feature Phones', 'Chargers', 'Cables', 'Cases', 'Screen Protectors', 'Earbuds', 'Power Banks'], 'units' => ['pcs'], 'taxes' => [18], 'inclusive' => true],
        'electronics' => ['modules' => ['serials', 'warranty', 'variants'], 'categories' => ['Televisions', 'Laptops', 'Appliances', 'Audio', 'Accessories'], 'units' => ['pcs'], 'taxes' => [18, 28], 'inclusive' => true],
        'clothing' => ['modules' => ['variants'], 'categories' => ['Men', 'Women', 'Kids', 'Footwear', 'Accessories'], 'units' => ['pcs'], 'taxes' => [5, 12], 'inclusive' => true],
        'hardware' => ['modules' => ['variants', 'wholesale_pricing'], 'categories' => ['Tools', 'Fasteners', 'Electrical', 'Plumbing', 'Paints', 'Building Material'], 'units' => ['pcs', 'kg', 'm', 'ft', 'box', 'bag', 'l'], 'taxes' => [18, 28], 'inclusive' => true],
        'bakery' => ['modules' => ['weighing', 'expiry'], 'categories' => ['Breads', 'Cakes', 'Pastries', 'Cookies', 'Snacks', 'Beverages'], 'units' => ['pcs', 'kg', 'g'], 'taxes' => [0, 5, 18], 'inclusive' => true],
        'restaurant' => ['modules' => ['restaurant'], 'categories' => ['Starters', 'Main Course', 'Breads', 'Rice', 'Desserts', 'Beverages'], 'units' => ['plate', 'pcs', 'glass'], 'taxes' => [5], 'inclusive' => false],
        'general' => ['modules' => ['variants'], 'categories' => ['General'], 'units' => ['pcs', 'kg', 'box'], 'taxes' => [0, 5, 12, 18, 28], 'inclusive' => true],
        'wholesale' => ['modules' => ['wholesale_pricing', 'variants'], 'categories' => ['General'], 'units' => ['pcs', 'box', 'case', 'kg', 'bag'], 'taxes' => [0, 5, 12, 18, 28], 'inclusive' => false],
        'service' => ['modules' => ['services'], 'categories' => ['Services'], 'units' => ['hr', 'job', 'pcs'], 'taxes' => [18], 'inclusive' => false],
        'custom' => ['modules' => [], 'categories' => ['General'], 'units' => ['pcs'], 'taxes' => [0, 18], 'inclusive' => true],
    ];

    /** @var array<string, array{name: string, decimal: bool}> */
    public const UNITS = [
        'pcs' => ['name' => 'Piece', 'decimal' => false],
        'kg' => ['name' => 'Kilogram', 'decimal' => true],
        'g' => ['name' => 'Gram', 'decimal' => true],
        'l' => ['name' => 'Litre', 'decimal' => true],
        'ml' => ['name' => 'Millilitre', 'decimal' => true],
        'm' => ['name' => 'Metre', 'decimal' => true],
        'ft' => ['name' => 'Feet', 'decimal' => true],
        'pkt' => ['name' => 'Packet', 'decimal' => false],
        'box' => ['name' => 'Box', 'decimal' => false],
        'case' => ['name' => 'Case', 'decimal' => false],
        'bag' => ['name' => 'Bag', 'decimal' => false],
        'dozen' => ['name' => 'Dozen', 'decimal' => true],
        'strip' => ['name' => 'Strip', 'decimal' => false],
        'bottle' => ['name' => 'Bottle', 'decimal' => false],
        'tube' => ['name' => 'Tube', 'decimal' => false],
        'vial' => ['name' => 'Vial', 'decimal' => false],
        'plate' => ['name' => 'Plate', 'decimal' => true],
        'glass' => ['name' => 'Glass', 'decimal' => false],
        'hr' => ['name' => 'Hour', 'decimal' => true],
        'job' => ['name' => 'Job', 'decimal' => false],
    ];

    public const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Salary', 'Transportation', 'Supplier Payment', 'Maintenance', 'Internet & Phone', 'Miscellaneous'];

    public const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer', 'wallet', 'credit', 'credit_note', 'old_gold', 'loyalty', 'other'];
}
