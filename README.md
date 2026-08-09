# n8n-nodes-data-diff

This is an n8n community node. It lets you use **Data Diff** in your n8n workflows.

Data Diff compares two JSON objects and tells you exactly what changed between them — nothing more, nothing less. The output is clean, structured JSON, so you can plug it straight into an `IF`, `Switch`, `Split Out`, or `Set` node without writing any parsing logic yourself.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[What this node does](#what-this-node-does)
[Is this the right node for you?](#is-this-the-right-node-for-you)
[Node parameters](#node-parameters)
[Output format](#output-format)
[Examples](#examples)
[Type change detection](#4-type-change-detection)
[Removed item in a matched array](#5-removed-item-in-a-matched-array)
[Array match keys, in depth](#array-match-keys-in-depth)
[Edge cases and how they're handled](#edge-cases-and-how-theyre-handled)
[Compatibility](#compatibility)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, and search for `n8n-nodes-data-diff`.

No credentials are required — this node doesn't call any external API, it only transforms data that's already inside your workflow.

## What this node does

Imagine you have two versions of the same record — say, a customer profile before and after someone edited it — and you want to know precisely what was changed. Reading through both objects by eye is slow and error-prone, especially once you're dealing with nested fields or lists of items.

Data Diff takes two pieces of data, an "Old Data" and a "New Data", and produces a list of every difference between them: what was added, what was removed, and what was modified. If a field's data type itself changed (say, a price that used to be `19.99` is now the text `"19.99"`), it's flagged separately as a `typeChanged` entry, because that's usually a sign of a data quality problem rather than an intentional edit.

You can then feed that list of changes into an `IF` node to branch a workflow only when something specific changed, into a `Switch` node to route different types of changes differently, or into `Split Out` to process each change one at a time.

## Is this the right node for you?

**Data Diff is not a replacement for n8n's built-in [Compare Datasets](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.comparedatasets/) node.** They solve different problems:

- **Compare Datasets** matches items *across two lists* by a key field — e.g. "which rows in this spreadsheet were added or removed compared to that spreadsheet." It works on two *arrays/datasets*.
- **Data Diff** compares two *single JSON objects* (e.g. two versions of one API response, one database record, one webhook payload) and reports the field-level differences *within* that one object — including differences buried inside nested objects and arrays.

If you're comparing two lists of records to find which rows were added/removed/changed, use Compare Datasets. If you're comparing "this one object before" vs. "this one object after," use Data Diff.

## Node parameters

| Parameter | Type | Description |
|---|---|---|
| **Old Data** | JSON | The baseline/previous version of the data. |
| **New Data** | JSON | The updated/current version of the data. |
| **Array Match Keys** | Multi-row list | Optional. For any array field, tells the node which property uniquely identifies each item in that array (e.g. array path `contacts`, match key `name`), so items are compared by identity instead of by position. Any array you don't configure here is compared by index. Nothing is auto-detected — this is entirely explicit and under your control. |
| **Max Depth** | Number (default `20`) | How many levels of nested objects/arrays the node will expand when comparing. This exists to keep the output readable (and the comparison bounded) on very deeply nested or malformed input. Content beyond this depth is treated as a single unit rather than expanded field by field. |

## Output format

The node outputs a single item per input item, shaped like this:

```json
{
  "hasChanges": true,
  "changeCount": 2,
  "changes": [
    {
      "path": "address.pincode",
      "type": "modified",
      "oldValue": "411001",
      "newValue": "411045"
    },
    {
      "path": "contacts[Priya].phone",
      "type": "added",
      "newValue": "9998887777"
    }
  ]
}
```

Every entry in `changes` has:

- **`path`** — where the change happened, in dot notation for nested objects (`address.pincode`) and bracket notation for array items (`contacts[1].phone` for index-based arrays, or `contacts[Priya].phone` when an array match key is configured for that array).
- **`type`** — one of:
  - `"modified"` — the value changed, but stayed the same data type.
  - `"added"` — the field/item exists in New Data but not in Old Data. `oldValue` is omitted.
  - `"removed"` — the field/item exists in Old Data but not in New Data. `newValue` is omitted.
  - `"typeChanged"` — the field's data type itself changed (e.g. a number became a string), regardless of whether the underlying value is "similar." Flagged separately from `modified` because it's often a data quality issue rather than a real business change.
- **`oldValue`** / **`newValue`** — the raw values before/after. No formatting, no human-readable summary — just data, so downstream nodes can use it directly.

If nothing changed, you get `{ "hasChanges": false, "changeCount": 0, "changes": [] }`.

## Examples

### 1. Flat diff

**Old Data**
```json
{ "name": "Acme Corp", "employees": 50, "active": true }
```

**New Data**
```json
{ "name": "Acme Corp", "employees": 62, "region": "APAC" }
```

**Output**
```json
{
  "hasChanges": true,
  "changeCount": 3,
  "changes": [
    { "path": "employees", "type": "modified", "oldValue": 50, "newValue": 62 },
    { "path": "region", "type": "added", "newValue": "APAC" },
    { "path": "active", "type": "removed", "oldValue": true }
  ]
}
```

### 2. Nested diff

**Old Data**
```json
{ "user": { "name": "Divya", "address": { "city": "Pune", "pincode": "411001" } } }
```

**New Data**
```json
{ "user": { "name": "Divya", "address": { "city": "Mumbai", "pincode": "411001" } } }
```

**Output**
```json
{
  "hasChanges": true,
  "changeCount": 1,
  "changes": [
    { "path": "user.address.city", "type": "modified", "oldValue": "Pune", "newValue": "Mumbai" }
  ]
}
```

### 3. Key-matched array diff

Without a match key, if an item just moves from index 1 to index 3, it would look like one item was removed and a different one was added. Configuring an **Array Match Key** (array path `contacts`, match key `name`) fixes that: items are matched by identity, so only the fields that actually changed are reported.

**Old Data**
```json
{
  "contacts": [
    { "name": "Amit", "phone": "111" },
    { "name": "Priya", "phone": "222" }
  ]
}
```

**New Data**
```json
{
  "contacts": [
    { "name": "Priya", "phone": "222" },
    { "name": "Amit", "phone": "999" }
  ]
}
```

**Output**
```json
{
  "hasChanges": true,
  "changeCount": 1,
  "changes": [
    { "path": "contacts[Amit].phone", "type": "modified", "oldValue": "111", "newValue": "999" }
  ]
}
```

Without the match key configured, this same input would incorrectly report `contacts[0]` and `contacts[1]` as both "modified" (or, if the objects were different enough, as an add+remove pair), even though nothing about Amit or Priya's data actually changed besides Amit's phone number.

### 4. Type change detection

**Old Data**
```json
{ "employees": 50 }
```

**New Data**
```json
{ "employees": "50" }
```

**Output**
```json
{
  "hasChanges": true,
  "changeCount": 1,
  "changes": [
    { "path": "employees", "type": "typeChanged", "oldValue": 50, "newValue": "50" }
  ]
}
```

### 5. Removed item in a matched array

With an **Array Match Key** configured (array path `contacts`, match key `name`), an item that disappears from New Data is reported as `removed` at its identity-based path, with the full old item as `oldValue` — not broken down field by field.

**Old Data**
```json
{
  "contacts": [
    { "name": "Raj", "phone": "111" },
    { "name": "Priya", "phone": "222" }
  ]
}
```

**New Data**
```json
{
  "contacts": [
    { "name": "Raj", "phone": "111" }
  ]
}
```

**Output**
```json
{
  "hasChanges": true,
  "changeCount": 1,
  "changes": [
    {
      "path": "contacts[Priya]",
      "type": "removed",
      "oldValue": { "name": "Priya", "phone": "222" }
    }
  ]
}
```

### 6. No changes

**Old Data**
```json
{ "name": "Acme Corp", "employees": 50 }
```

**New Data**
```json
{ "name": "Acme Corp", "employees": 50 }
```

**Output**
```json
{ "hasChanges": false, "changeCount": 0, "changes": [] }
```

## Array match keys, in depth

The **Array Match Keys** parameter is a list of rows, each with:

- **Array Path** — a dot-notation path to the array field, relative to the root of the data (e.g. `contacts`, or `address.contacts` for an array nested inside another object).
- **Match Key** — the property name that uniquely identifies each item in that array (e.g. `id`, `email`, `name`).

You can add as many rows as you have arrays that need key-based matching — each array path can have its own, independent match key. Any array field you *don't* add a row for falls back to plain index-based comparison (`array[0]`, `array[1]`, ...).

Nothing is guessed automatically. If you don't tell the node which field identifies an item, it will never try to infer one — this keeps behavior predictable and avoids silently-wrong diffs from an accidental "smart" match.

Internally, this node uses [`json-diff-ts`](https://www.npmjs.com/package/json-diff-ts) to perform the underlying comparison, and array match keys map directly onto its key-based array diffing feature.

### Arrays of primitive values

Arrays of primitives (e.g. `["red", "blue"]`) don't have a "match key" to configure — there's no property to key on. These are compared **by index**, which is `json-diff-ts`'s default behavior for arrays without a configured key. For example:

**Old Data:** `{ "colors": ["red", "blue"] }`
**New Data:** `{ "colors": ["blue", "green"] }`

**Output:**
```json
{
  "hasChanges": true,
  "changeCount": 2,
  "changes": [
    { "path": "colors[0]", "type": "modified", "oldValue": "red", "newValue": "blue" },
    { "path": "colors[1]", "type": "modified", "oldValue": "blue", "newValue": "green" }
  ]
}
```

Even though intuitively "blue" just moved from index 1 to index 0 and "red" was replaced by "green", index-based comparison reports this as two positional modifications rather than a move — there's no identity to match a primitive value by. If you need move-aware comparison, this is only possible for arrays of *objects* with a configured match key.

## Edge cases and how they're handled

- **Duplicate key values in a matched array** (e.g. two contacts both named `"Raj"`): the node does **not** crash and does **not** silently produce a wrong match. It falls back to index-based comparison for that specific array only (other arrays with valid, unique keys are unaffected), and adds an execution hint (visible on the node in the n8n editor, not mixed into the JSON output) explaining what happened and why.

  **Old Data** (Array Match Key: `contacts` → `name`)
  ```json
  {
    "contacts": [
      { "name": "Raj", "phone": "1111111111" },
      { "name": "Raj", "phone": "2222222222" }
    ]
  }
  ```

  **New Data**
  ```json
  {
    "contacts": [
      { "name": "Raj", "phone": "1111111111" },
      { "name": "Raj", "phone": "9999999999" }
    ]
  }
  ```

  **Execution hint shown on the node:**
  ```
  Array match key ignored for "contacts": duplicate value "Raj" found for key "name". Falling back to index-based comparison for this array.
  ```

  **Output** (falls back to index-based comparison for `contacts`)
  ```json
  {
    "hasChanges": true,
    "changeCount": 1,
    "changes": [
      { "path": "contacts[1].phone", "type": "modified", "oldValue": "2222222222", "newValue": "9999999999" }
    ]
  }
  ```

- **Missing key field on some array items** (e.g. some contacts don't have a `name` field): same fallback — index-based comparison for that array, plus an execution hint. No crash.

  **Old Data** (Array Match Key: `contacts` → `name`)
  ```json
  {
    "contacts": [
      { "name": "Raj", "phone": "111" },
      { "phone": "222" }
    ]
  }
  ```

  **New Data**
  ```json
  {
    "contacts": [
      { "name": "Raj", "phone": "111" },
      { "phone": "333" }
    ]
  }
  ```

  **Execution hint shown on the node:**
  ```
  Array match key ignored for "contacts": some item(s) are missing the "name" field. Falling back to index-based comparison for this array.
  ```

  **Output**
  ```json
  {
    "hasChanges": true,
    "changeCount": 1,
    "changes": [
      { "path": "contacts[1].phone", "type": "modified", "oldValue": "222", "newValue": "333" }
    ]
  }
  ```
- **One side missing (`null`/`undefined`)**: treated as an empty object, so every field on the other side is reported as `added` or `removed` as appropriate.
- **Deeply nested or malformed input**: bounded by **Max Depth** (default 20 levels). Content nested deeper than this is still compared — nothing is silently dropped — but it's compared as a single opaque unit rather than expanded field-by-field: if the two sides differ anywhere beyond that depth, you get one `modified` change at the boundary path with the full old/new subtrees as `oldValue`/`newValue`, instead of a change per individual deep field. This keeps output readable and comparison work bounded, without losing the fact that something changed.

## Compatibility

Requires n8n's programmatic node API (`n8nNodesApiVersion` 1) and n8n v1.x or later.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [json-diff-ts on npm](https://www.npmjs.com/package/json-diff-ts)
* [n8n Compare Datasets node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.comparedatasets/)
