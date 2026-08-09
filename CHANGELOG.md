# Changelog

## 0.1.0

- Initial release of the Data Diff node.
- Compares two JSON objects (Old Data / New Data) and outputs `{ hasChanges, changeCount, changes[] }`.
- Supports optional per-array match keys for key-based array item matching, with automatic fallback to index-based comparison (plus an execution hint) on duplicate or missing keys.
- Supports a configurable Max Depth to bound comparison of deeply nested or malformed input.
