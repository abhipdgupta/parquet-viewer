# File Format DB Viewer

Browser-based parquet inspection with DuckDB WASM, React, and Vite.

## What It Does

- Uploads a local parquet file without sending data to a backend
- Validates parquet header and footer magic bytes
- Registers the uploaded file as `active_db` for DuckDB SQL queries
- Browses rows with pagination
- Opens full row details in a modal for long strings, arrays, and structs
- Shows a schema sidebar for the active parquet dataset
- Supports light and dark themes

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- DuckDB WASM
- Apache Arrow
- Husky
- Prettier

## Query Model

After upload, the parquet file is exposed in DuckDB as:

```sql
SELECT * FROM active_db
```

This keeps the SQL editor stable instead of referencing a generated upload filename.

## Development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

## Scripts

- `npm run dev` starts Vite in development mode
- `npm run build` creates a production build in `build/`
- `npm run preview` previews the production build
- `npm run lint` runs ESLint
- `npm run format` runs Prettier with `--write`
- `npm run format:check` checks formatting without writing changes

## Git Hooks

Husky is configured with:

- `pre-commit`: `npm run format`
- `post-commit`: `npm run build`

## Build Output

Production output is written to:

```text
build/
```

The main entry file for static hosting is:

```text
build/index.html
```

## Notes

- DuckDB worker files are served from `public/duckdb-workers`
- Generated assets and worker bundles are ignored by Prettier via `.prettierignore`
