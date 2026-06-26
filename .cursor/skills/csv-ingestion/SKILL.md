---
name: csv-ingestion
description: "Use these rules ONLY when writing seeders, parsing raw CSV files, importing spreadsheets, or running data ingestion mutations into Vendure"
---

# Relational CSV Data Ingestion Protocol

This skill activates exclusively for seeding scripts, CSV importers, and bulk data mutation tasks. Do not apply these rules to UI components, routes, or Mastra tools.

---

## Step 1: Schema Pre-flight Sanitization

Run **all** CSV string records through a strict Zod schema validation block before touching the database.

- Force all monetary decimals or string prices to transform into un-fractioned, absolute integers.
  - Example: `"45.00"` → `4500` (multiply by 100, parse as integer, never use floats for money)
- Validate SKU strings are non-empty and match the expected format.
- Validate option labels (e.g. `"Small"`, `"Navy"`) are non-empty strings.

```ts
// ponytail: zod validates the entire row shape before any mutation fires
const CsvRowSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1).max(255),
  priceInCents: z.string().regex(/^\d+(\.\d{1,2})?$/).transform(v => Math.round(parseFloat(v) * 100)),
  size: z.string().min(1),
  color: z.string().min(1),
});
```

---

## Step 2: Relational Reconstruction Step

Accumulate and loop through CSV rows **locally** to group variant definitions by their core product identifier **before** executing any mutations.

- Group rows by `productName` (or equivalent root key) into a `Map<string, CsvRow[]>`.
- Each group represents exactly one parent `Product` shell and its full variant matrix.
- Do not fire mutations inside the accumulation loop.

```ts
const productGroups = new Map<string, CsvRow[]>();
for (const row of validatedRows) {
  const group = productGroups.get(row.name) ?? [];
  group.push(row);
  productGroups.set(row.name, group);
}
```

---

## Step 3: ID Resolution Lock

Translate raw option text strings from the CSV (e.g. `"Small"`, `"Navy"`) into verified Vendure database option IDs **before** building the variant payload array.

1. Query `ProductOptionGroup` and `ProductOption` nodes via the Vendure GraphQL client.
2. Build a resolution map: `Map<"size:Small", optionId>`.
3. If any label does not resolve, **abort immediately** (see Step 4).

```ts
// ponytail: pre-resolves all option IDs in one pass to avoid N+1 mutation calls
const optionIdMap = new Map<string, string>();
for (const option of fetchedOptions) {
  optionIdMap.set(`${option.group.code}:${option.code}`, option.id);
}
```

---

## Step 4: Enforcement Gate

**Instantly abort** the initialization script execution if any of the following conditions are true for any CSV row:

| Condition | Action |
| --------- | ------ |
| SKU is an empty string | `throw new Error(\`Row ${i}: empty SKU\`)` |
| Price string contains non-numeric characters | `throw new Error(\`Row ${i}: invalid price "${row.price}"\`)` |
| Option label does not resolve to a database ID | `throw new Error(\`Row ${i}: unmapped option "${label}"\`)` |

Do not silently skip invalid rows. Fail loudly and halt the entire script so data corruption is impossible.
