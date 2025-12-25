# indexdb-helper-ts

A lightweight, type-safe TypeScript helper for IndexedDB operations with optional index support and configurable transaction durability.

## Features

- Type-safe with generics for read/write operations
- Supports basic IndexedDB actions: `READ`, `WRITE`, `UPDATE`, `DELETE`, `CLEAR`
- Optional index hints for optimized reads
- Configurable transaction durability: `"strict"` or `"relaxed"`
- Minimal abstraction over native IndexedDB

## Installation

```bash
npm install indexdb-helper-ts
```
