---
name: product-topography
description: "Use these rules ONLY when modifying, creating, querying, or structuring apparel product variant data in Vendure — sizes, colors, fits, or any option matrix work"
---

# Strict Normalized Product-Variant Topography

This skill activates exclusively for tasks involving Vendure product and variant data modeling. Do not apply these rules to UI components, Mastra tools, or seeding scripts (use `csv-ingestion` for seeding).

---

## Rule 1: The Vendure Option-Matrix Pattern (DATA-FIRST)

You are **strictly prohibited** from treating apparel variants (e.g., sizes, colors, fits) as flat, top-level object keys or speculative schema fields.

### Required Approach

1. Explicitly query the generated GraphQL schema types (`ProductVariantFragment` or equivalent) to map through a `ProductVariant` entity's `options` array matrix.
2. To resolve an active variant based on a user interface selection, traverse and match options back to their parent group `code` dynamically — never use hardcoded index positions.

```ts
// ✅ Correct: traverse the options matrix dynamically
const selectedVariant = variants.find(variant =>
  variant.options.find(opt => opt.group.code === 'size')?.code === selectedSize &&
  variant.options.find(opt => opt.group.code === 'color')?.code === selectedColor
);

// ❌ Forbidden: flat key access
const selectedVariant = variants.find(v => v.size === selectedSize);
```

### Structural Blueprint

```ts
// Resolving a single option from a variant
variant.options.find(opt => opt.group.code === 'size')?.code === selectedSize
```

---

## Rule 2: Strict Normalized Product-Variant Topography

You are **strictly prohibited** from creating multiple standalone parent `Product` entries or duplicate database rows to represent size, color, or material variations of the same product blueprint. Doing so corrupts the Admin UI data tables and breaks the Vendure option-matrix model.

### Required Execution Protocol

Follow this exact sequence for any product creation:

#### Step 1 — Initialize one root parent shell

```graphql
mutation {
  createProduct(input: {
    # EXACTLY ONE parent product shell (e.g. "AURA Boxy Sweatshirt")
    translations: [{ languageCode: en, name: "AURA Boxy Sweatshirt", slug: "aura-boxy-sweatshirt", description: "" }]
    enabled: true
  }) { id }
}
```

#### Step 2 — Query, verify, or create `ProductOptionGroup` and child `ProductOption` nodes

```graphql
query {
  productOptionGroups {
    id
    code
    options { id code }
  }
}
```

#### Step 3 — Attach valid `ProductOptionGroup` IDs to the single parent `Product`

```graphql
mutation {
  addOptionGroupToProduct(productId: $productId, optionGroupId: $groupId) { id }
}
```

#### Step 4 — Invoke a singular `createProductVariants` mutation

Pass the flat array of intersecting option IDs to spin up the variation matrix cleanly underneath the single parent shell.

```graphql
mutation {
  createProductVariants(input: [
    { productId: $productId, sku: "AURA-BS-S-NAV", price: 8900, optionIds: [$sizeSmallId, $colorNavyId] },
    { productId: $productId, sku: "AURA-BS-M-NAV", price: 8900, optionIds: [$sizeMediumId, $colorNavyId] }
    # ... all intersections in a single mutation call
  ]) { id sku }
}
```

### Forbidden Patterns

| Pattern | Why Forbidden |
| ------- | ------------- |
| Creating a `Product` per size | Corrupts Admin UI, breaks option-matrix |
| Using `variant.size` as a direct field | Violates the options-array traversal contract |
| Hardcoded option index (`options[0]`) | Breaks when option order changes |
| Multiple `createProductVariants` calls per product | Violates single-mutation protocol |
