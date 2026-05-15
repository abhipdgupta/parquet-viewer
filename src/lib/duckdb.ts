import * as duckdb from "@duckdb/duckdb-wasm"
import duckdbWasmEh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url"
import duckdbWasmMvp from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url"

const ehWorker = "/duckdb-workers/duckdb-browser-eh.worker.js"
const mvpWorker = "/duckdb-workers/duckdb-browser-mvp.worker.js"

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdbWasmMvp,
    mainWorker: mvpWorker,
  },
  eh: {
    mainModule: duckdbWasmEh,
    mainWorker: ehWorker,
  },
}

let databasePromise: Promise<duckdb.AsyncDuckDB> | null = null

async function createDatabase() {
  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
  const worker = new Worker(bundle.mainWorker!)
  const database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker)

  await database.instantiate(bundle.mainModule, bundle.pthreadWorker)

  return database
}

export function getDuckDb() {
  if (!databasePromise) {
    databasePromise = createDatabase()
  }

  return databasePromise
}
