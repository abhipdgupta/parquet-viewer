import type { Table } from "apache-arrow"
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Database,
  Eye,
  FileUp,
  FileX,
  RefreshCw,
  SearchCheck,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { getDuckDb } from "@/lib/duckdb"

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const
const PARQUET_MAGIC = "PAR1"
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]
const ACTIVE_DB_NAME = "active_db"
const DEFAULT_QUERY_SQL = `SELECT * FROM ${ACTIVE_DB_NAME}`
const STRING_PREVIEW_LENGTH = 100

type RowData = Record<string, unknown>

type ColumnMeta = {
  name: string
  type: string
}

type FileMagicInfo = {
  headerAscii: string
  headerHex: string
  headerValid: boolean
  footerAscii: string
  footerHex: string
  footerValid: boolean
}

type ViewState = {
  columns: ColumnMeta[]
  rows: RowData[]
  totalRows: number
  page: number
  pageSize: number
  loading: boolean
  error: string | null
}

type UploadedParquet = {
  file: File
  sizeBytes: number
  magic: FileMagicInfo
}

const EMPTY_VIEW_STATE: ViewState = {
  columns: [],
  rows: [],
  totalRows: 0,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  loading: false,
  error: null,
}

function escapeSqlString(value: string) {
  return value.replaceAll("'", "''")
}

function formatBytes(size: number) {
  if (size === 0) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  )
  const normalized = size / 1024 ** exponent

  return `${normalized.toFixed(normalized >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function getMagicInfo(buffer: Uint8Array): FileMagicInfo {
  const decode = (bytes: Uint8Array) => new TextDecoder("ascii").decode(bytes)
  const toHex = (bytes: Uint8Array) =>
    Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
      .join(" ")

  const header = buffer.slice(0, 4)
  const footer = buffer.slice(Math.max(0, buffer.length - 4))
  const headerAscii = decode(header)
  const footerAscii = decode(footer)

  return {
    headerAscii,
    headerHex: toHex(header),
    headerValid: headerAscii === PARQUET_MAGIC,
    footerAscii,
    footerHex: toHex(footer),
    footerValid: footerAscii === PARQUET_MAGIC,
  }
}

function normalizeValue(value: unknown): unknown {
  if (value == null) {
    return null
  }

  if (typeof value === "bigint") {
    return value.toString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    )
  }

  if (typeof value === "object") {
    const maybeComplex = value as {
      toJSON?: () => unknown
      toArray?: () => unknown
    }

    if (typeof maybeComplex.toJSON === "function") {
      return normalizeValue(maybeComplex.toJSON())
    }

    if (typeof maybeComplex.toArray === "function") {
      return normalizeValue(maybeComplex.toArray())
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normalizeValue(nested),
      ]),
    )
  }

  return value
}

function tableToColumns(table: Table): ColumnMeta[] {
  return table.schema.fields.map((field) => ({
    name: field.name,
    type: field.type.toString(),
  }))
}

function tableToRows(table: Table): RowData[] {
  const columnNames = table.schema.fields.map((field) => field.name)

  return table
    .toArray()
    .map((row) =>
      Object.fromEntries(
        columnNames.map((columnName) => [
          columnName,
          normalizeValue(row[columnName]),
        ]),
      ),
    )
}

function isComplexValue(
  value: unknown,
): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || (!!value && typeof value === "object")
}

function summarizeComplexValue(value: Record<string, unknown> | unknown[]) {
  if (Array.isArray(value)) {
    return `{array ${value.length === 0 ? "empty" : `${value.length} item${value.length === 1 ? "" : "s"}`}}`
  }

  const keys = Object.keys(value)
  return `{struct ${keys.length === 0 ? "empty" : keys.slice(0, 2).join(", ")}${keys.length > 2 ? " ..." : ""}}`
}

function getPageCount(totalRows: number, pageSize: number) {
  return Math.max(1, Math.ceil(totalRows / pageSize))
}

function getStringPreview(value: string) {
  return `${value.slice(0, STRING_PREVIEW_LENGTH)}...`
}

function getTopLevelType(type: string) {
  const match = type.match(/^[^<([,\s]+/)
  return match?.[0] ?? type
}

function formatRowValue(value: unknown) {
  if (value == null) {
    return "null"
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  if (typeof value === "string") {
    return value
  }

  if (isComplexValue(value)) {
    return JSON.stringify(value, null, 2)
  }

  return String(value)
}

function ModalValue({ value }: { value: unknown }) {
  const isExpandable =
    isComplexValue(value) ||
    (typeof value === "string" && value.length > STRING_PREVIEW_LENGTH)
  const [expanded, setExpanded] = useState(false)

  if (!isExpandable) {
    return (
      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap wrap-break-word font-mono text-xs leading-6 text-foreground">
        {formatRowValue(value)}
      </pre>
    )
  }

  const label = isComplexValue(value)
    ? summarizeComplexValue(value)
    : getStringPreview(String(value))

  return (
    <div className="mt-4 space-y-3">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-muted/70 px-3 py-1 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <span className="truncate">{expanded ? "Hide full value" : label}</span>
        {expanded ? (
          <ChevronUp className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
      </button>

      {expanded ? (
        <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word font-mono text-xs leading-6 text-foreground">
          {formatRowValue(value)}
        </pre>
      ) : null}
    </div>
  )
}

function QueryInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-2 wrap-break-word font-mono text-sm text-foreground">
        {value}
      </p>
    </div>
  )
}

function DataCell({
  value,
  onOpenDetails,
}: {
  value: unknown
  onOpenDetails: () => void
}) {
  if (value == null) {
    return <span className="text-muted-foreground">null</span>
  }

  if (isComplexValue(value)) {
    return (
      <button
        type="button"
        onClick={onOpenDetails}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-muted/70 px-3 py-1 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <span className="truncate">{summarizeComplexValue(value)}</span>
        <ChevronRight className="size-3.5 shrink-0" />
      </button>
    )
  }

  if (typeof value === "string" && value.length > STRING_PREVIEW_LENGTH) {
    return (
      <button
        type="button"
        onClick={onOpenDetails}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-muted/70 px-3 py-1 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <span className="truncate">{getStringPreview(value)}</span>
        <ChevronRight className="size-3.5 shrink-0" />
      </button>
    )
  }

  if (typeof value === "boolean") {
    return <span>{value ? "true" : "false"}</span>
  }

  return (
    <span className="block max-w-full whitespace-pre-wrap wrap-break-word text-sm leading-6 text-foreground">
      {String(value)}
    </span>
  )
}

function SchemaPanel({
  title,
  columns,
}: {
  title: string
  columns: ColumnMeta[]
}) {
  return (
    <aside className="rounded-[1.5rem] border border-border/70 bg-background/80 p-4 lg:sticky lg:top-4 lg:max-h-[72vh] lg:overflow-auto">
      <div className="border-b border-border/70 pb-3">
        <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {title}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {columns.length} column{columns.length === 1 ? "" : "s"}
        </p>
      </div>

      {columns.length === 0 ? (
        <div className="py-6 text-sm text-muted-foreground">
          No schema details available.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {columns.map((column, index) => (
            <article
              key={column.name}
              className="rounded-2xl border border-border/70 bg-card px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {column.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {getTopLevelType(column.type)}
                  </p>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <p className="mt-3 wrap-break-word font-mono text-xs leading-5 text-muted-foreground">
                {column.type}
              </p>
            </article>
          ))}
        </div>
      )}
    </aside>
  )
}

function RowDetailsModal({
  row,
  columns,
  title,
  onClose,
}: {
  row: RowData | null
  columns: ColumnMeta[]
  title: string
  onClose: () => void
}) {
  useEffect(() => {
    if (!row) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose, row])

  if (!row) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-border/80 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Row Details
            </p>
            <h3 className="mt-1 text-xl font-semibold text-foreground">
              {title}
            </h3>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close row details"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="max-h-[calc(88vh-80px)] overflow-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            {columns.map((column) => (
              <article
                key={column.name}
                className="rounded-[1.25rem] border border-border/70 bg-card px-4 py-4"
              >
                <div className="border-b border-border/70 pb-3">
                  <p className="text-sm font-semibold text-foreground">
                    {column.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {getTopLevelType(column.type)}
                  </p>
                  <p className="mt-2 wrap-break-word font-mono text-[11px] leading-5 text-muted-foreground">
                    {column.type}
                  </p>
                </div>
                <ModalValue value={row[column.name]} />
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function DataTable({
  title,
  description,
  schemaTitle,
  schemaColumns,
  state,
  onPageChange,
  onPageSizeChange,
}: {
  title: string
  description: string
  schemaTitle: string
  schemaColumns: ColumnMeta[]
  state: ViewState
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)

  const pageCount = getPageCount(state.totalRows, state.pageSize)
  const startRow =
    state.totalRows === 0 ? 0 : (state.page - 1) * state.pageSize + 1
  const endRow = Math.min(state.page * state.pageSize, state.totalRows)
  const selectedRow =
    selectedRowIndex == null ? null : (state.rows[selectedRowIndex] ?? null)

  return (
    <>
      <section className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SchemaPanel title={schemaTitle} columns={schemaColumns} />

        <div className="rounded-[1.75rem] border border-border/70 bg-card shadow-sm">
          <div className="flex flex-col gap-4 border-b border-border/70 px-5 py-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-muted-foreground">
                Rows per page{" "}
                <select
                  value={state.pageSize}
                  onChange={(event) =>
                    onPageSizeChange(Number(event.target.value))
                  }
                  className="ml-2 rounded-lg border border-border bg-background px-2 py-1 text-foreground"
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-sm text-muted-foreground">
                {startRow}-{endRow} of {state.totalRows.toLocaleString()}
              </div>
            </div>
          </div>

          {state.error ? (
            <div className="px-5 py-5 text-sm text-destructive">
              {state.error}
            </div>
          ) : null}

          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-full table-fixed border-collapse">
              <thead className="bg-card">
                <tr>
                  <th className="sticky top-0 z-10 w-16 border-b border-border/70 bg-card px-4 py-3 text-left">
                    <span className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                      Row
                    </span>
                  </th>
                  {state.columns.map((column) => (
                    <th
                      key={column.name}
                      className="sticky top-0 z-10 w-64 border-b border-border/70 bg-card px-4 py-3 text-left align-bottom"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {column.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getTopLevelType(column.type)}
                        </p>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.loading ? (
                  <tr>
                    <td
                      colSpan={Math.max(2, state.columns.length + 1)}
                      className="px-4 py-10 text-center text-sm text-muted-foreground"
                    >
                      Loading rows...
                    </td>
                  </tr>
                ) : null}

                {!state.loading && state.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={Math.max(2, state.columns.length + 1)}
                      className="px-4 py-10 text-center text-sm text-muted-foreground"
                    >
                      No rows available for this result set.
                    </td>
                  </tr>
                ) : null}

                {!state.loading
                  ? state.rows.map((row, rowIndex) => (
                      <tr
                        key={`row-${state.page}-${rowIndex}`}
                        className="border-b border-border/60 align-top"
                      >
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setSelectedRowIndex(rowIndex)}
                            aria-label={`Open row ${startRow + rowIndex} details`}
                          >
                            <Eye className="size-4" />
                          </Button>
                        </td>
                        {state.columns.map((column) => (
                          <td key={column.name} className="px-4 py-3">
                            <DataCell
                              value={row[column.name]}
                              onOpenDetails={() =>
                                setSelectedRowIndex(rowIndex)
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Page {state.page} of {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => onPageChange(Math.max(1, state.page - 1))}
                disabled={state.loading || state.page <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  onPageChange(Math.min(pageCount, state.page + 1))
                }
                disabled={state.loading || state.page >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </section>

      <RowDetailsModal
        row={selectedRow}
        columns={state.columns}
        title={`${title} row ${selectedRowIndex == null ? "" : startRow + selectedRowIndex}`}
        onClose={() => setSelectedRowIndex(null)}
      />
    </>
  )
}

export function ParquetReaderPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const connectionRef = useRef<AsyncDuckDBConnection | null>(null)
  const registeredFileNameRef = useRef<string | null>(null)
  const previewRequestRef = useRef(0)
  const queryRequestRef = useRef(0)

  const [uploadedParquet, setUploadedParquet] =
    useState<UploadedParquet | null>(null)
  const [previewState, setPreviewState] = useState<ViewState>(EMPTY_VIEW_STATE)
  const [queryState, setQueryState] = useState<ViewState>(EMPTY_VIEW_STATE)
  const [querySql, setQuerySql] = useState("")
  const [queryError, setQueryError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isPreparingFile, setIsPreparingFile] = useState(false)
  const [activeView, setActiveView] = useState<"preview" | "query">("preview")

  const uploadedFileDetails = useMemo(
    () =>
      uploadedParquet
        ? [
            {
              label: "Uploaded file",
              value: uploadedParquet.file.name,
            },
            {
              label: "File size",
              value: `${formatBytes(uploadedParquet.sizeBytes)} (${uploadedParquet.sizeBytes.toLocaleString()} bytes)`,
            },
            {
              label: "Header magic",
              value: `${uploadedParquet.magic.headerAscii || "n/a"} | ${uploadedParquet.magic.headerHex}`,
            },
            {
              label: "Footer magic",
              value: `${uploadedParquet.magic.footerAscii || "n/a"} | ${uploadedParquet.magic.footerHex}`,
            },
          ]
        : [],
    [uploadedParquet],
  )

  useEffect(() => {
    return () => {
      const closeConnection = async () => {
        if (connectionRef.current) {
          await clearActiveDb(connectionRef.current)
          await connectionRef.current.close()
        }

        const db = await getDuckDb()
        if (registeredFileNameRef.current) {
          await db.dropFile(registeredFileNameRef.current)
        }
      }

      void closeConnection()
    }
  }, [])

  async function getConnection() {
    if (connectionRef.current) {
      return connectionRef.current
    }

    const db = await getDuckDb()
    const connection = await db.connect()
    connectionRef.current = connection
    return connection
  }

  async function setActiveDb(
    connection: AsyncDuckDBConnection,
    sqlPath: string,
  ) {
    await connection.query(
      `CREATE OR REPLACE VIEW ${ACTIVE_DB_NAME} AS SELECT * FROM read_parquet('${sqlPath}')`,
    )
  }

  async function clearActiveDb(connection: AsyncDuckDBConnection) {
    await connection.query(`DROP VIEW IF EXISTS ${ACTIVE_DB_NAME}`)
  }

  async function loadPreviewPage(page: number, pageSize: number) {
    const requestId = ++previewRequestRef.current

    setPreviewState((current) => ({
      ...current,
      page,
      pageSize,
      loading: true,
      error: null,
    }))

    try {
      const connection = await getConnection()
      const offset = (page - 1) * pageSize
      const previewQuery = `SELECT * FROM ${ACTIVE_DB_NAME} LIMIT ${pageSize} OFFSET ${offset}`
      const [rowsTable, countTable] = await Promise.all([
        connection.query(previewQuery),
        connection.query(
          `SELECT COUNT(*) AS total_rows FROM ${ACTIVE_DB_NAME}`,
        ),
      ])

      if (requestId !== previewRequestRef.current) {
        return
      }

      const countRows = tableToRows(countTable)
      const totalRows = Number(countRows[0]?.total_rows ?? 0)

      setPreviewState({
        columns: tableToColumns(rowsTable),
        rows: tableToRows(rowsTable),
        totalRows,
        page,
        pageSize,
        loading: false,
        error: null,
      })
    } catch (error) {
      if (requestId !== previewRequestRef.current) {
        return
      }

      setPreviewState((current) => ({
        ...current,
        page,
        pageSize,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load parquet rows.",
      }))
    }
  }

  async function loadQueryPage(page: number, pageSize: number, sql: string) {
    const trimmedSql = sql.trim()
    if (!trimmedSql) {
      setQueryError("Enter a DuckDB SQL query before running it.")
      return
    }

    const requestId = ++queryRequestRef.current
    setQueryError(null)
    setQueryState((current) => ({
      ...current,
      page,
      pageSize,
      loading: true,
      error: null,
    }))

    try {
      const connection = await getConnection()
      const offset = (page - 1) * pageSize
      const paginatedQuery = `SELECT * FROM (${trimmedSql}) AS parquet_query_result LIMIT ${pageSize} OFFSET ${offset}`
      const countQuery = `SELECT COUNT(*) AS total_rows FROM (${trimmedSql}) AS parquet_query_count`
      const [rowsTable, countTable] = await Promise.all([
        connection.query(paginatedQuery),
        connection.query(countQuery),
      ])

      if (requestId !== queryRequestRef.current) {
        return
      }

      const countRows = tableToRows(countTable)
      const totalRows = Number(countRows[0]?.total_rows ?? 0)

      setQueryState({
        columns: tableToColumns(rowsTable),
        rows: tableToRows(rowsTable),
        totalRows,
        page,
        pageSize,
        loading: false,
        error: null,
      })
      setActiveView("query")
    } catch (error) {
      if (requestId !== queryRequestRef.current) {
        return
      }

      const message =
        error instanceof Error
          ? error.message
          : "DuckDB could not execute the query."
      setQueryError(message)
      setQueryState((current) => ({
        ...current,
        page,
        pageSize,
        loading: false,
        error: message,
      }))
    }
  }

  async function registerParquetFile(file: File) {
    setIsPreparingFile(true)
    setUploadError(null)
    setQueryError(null)
    setActiveView("preview")

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const magic = getMagicInfo(bytes)
      const nextFileName = `upload-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`
      const sqlPath = escapeSqlString(nextFileName)
      const connection = await getConnection()

      const db = await getDuckDb()
      if (registeredFileNameRef.current) {
        await db.dropFile(registeredFileNameRef.current)
        registeredFileNameRef.current = null
      }

      setUploadedParquet({
        file,
        sizeBytes: bytes.byteLength,
        magic,
      })

      if (!magic.headerValid) {
        await clearActiveDb(connection)
        setUploadError(
          `The file header is not valid parquet magic. Expected "${PARQUET_MAGIC}" and received "${magic.headerAscii || "n/a"}".`,
        )
        setPreviewState(EMPTY_VIEW_STATE)
        setQueryState(EMPTY_VIEW_STATE)
        setQuerySql("")
        return
      }

      await db.registerFileBuffer(nextFileName, bytes)
      registeredFileNameRef.current = nextFileName
      await setActiveDb(connection, sqlPath)

      setQuerySql(DEFAULT_QUERY_SQL)
      setQueryState((current) => ({
        ...current,
        page: 1,
        pageSize: current.pageSize,
        columns: [],
        rows: [],
        totalRows: 0,
        loading: false,
        error: null,
      }))

      await loadPreviewPage(1, previewState.pageSize)

      if (!magic.footerValid) {
        setUploadError(
          `Header magic is valid, but the footer magic is "${magic.footerAscii || "n/a"}" instead of "${PARQUET_MAGIC}".`,
        )
      }
    } catch (error) {
      if (connectionRef.current) {
        await clearActiveDb(connectionRef.current)
      }
      setUploadError(
        error instanceof Error
          ? error.message
          : "Unable to prepare the parquet file.",
      )
      setPreviewState(EMPTY_VIEW_STATE)
      setQueryState(EMPTY_VIEW_STATE)
    } finally {
      setIsPreparingFile(false)
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-border/70 bg-card/95 px-6 py-6 shadow-sm lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <span aria-hidden="true">&larr;</span>
              Back to home
            </Link>
            <div>
              <p className="text-xs font-semibold tracking-[0.22em] text-primary uppercase">
                Parquet Reader
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
                Upload, validate, browse, and query parquet in memory.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                Parquet is a columnar storage format built for analytics. This
                reader keeps the full workflow in the browser: file bytes stay
                in memory, DuckDB WASM runs the queries locally, and no backend
                is required.
              </p>
            </div>
          </div>
          <div className="grid gap-3 rounded-[1.5rem] border border-border/70 bg-background/80 p-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <SearchCheck className="size-4 text-primary" />
              Header and footer magic inspection
            </div>
            <div className="flex items-center gap-2">
              <Database className="size-4 text-primary" />
              DuckDB SQL editor with browser execution
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[1.75rem] border border-dashed border-primary/35 bg-card/90 p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  <FileUp className="size-3.5" />
                  Local upload
                </div>
                <h2 className="text-xl font-semibold tracking-tight">
                  Pick a parquet file to inspect
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  The file is read into browser memory, checked for the parquet
                  magic bytes, then registered with DuckDB WASM for querying.
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".parquet,.parq"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    void registerParquetFile(file)
                  }
                  event.currentTarget.value = ""
                }}
              />
              <div className="inline-flex">
                <Button
                  type="button"
                  disabled={isPreparingFile}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isPreparingFile ? "Preparing..." : "Choose parquet file"}
                </Button>
              </div>
            </div>

            {uploadError ? (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>{uploadError}</p>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 rounded-[1.75rem] border border-border/70 bg-card/95 p-5 shadow-sm">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Upload details
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                File size, parquet magic bytes, and immediate validation status.
              </p>
            </div>

            {uploadedParquet ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {uploadedFileDetails.map((detail) => (
                  <QueryInfo
                    key={detail.label}
                    label={detail.label}
                    value={detail.value}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center rounded-[1.5rem] border border-border/70 bg-background/60 px-4 text-center text-sm text-muted-foreground">
                No parquet file uploaded yet.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-border/70 bg-card/95 shadow-sm">
          <div className="grid gap-6 border-b border-border/70 px-5 py-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">
                  DuckDB SQL editor
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Current editor support: DuckDB dialect SQL over the uploaded
                  parquet file. The uploaded dataset is exposed as
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                    {ACTIVE_DB_NAME}
                  </code>
                  for previewing and ad-hoc queries.
                </p>
              </div>
              <textarea
                value={querySql}
                onChange={(event) => setQuerySql(event.target.value)}
                spellCheck={false}
                placeholder={`SELECT * FROM ${ACTIVE_DB_NAME} LIMIT 50`}
                className="min-h-52 w-full rounded-[1.25rem] border border-border bg-background px-4 py-4 font-mono text-sm leading-6 outline-none transition-colors focus:border-primary"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() =>
                    void loadQueryPage(1, queryState.pageSize, querySql)
                  }
                  disabled={!uploadedParquet || isPreparingFile}
                >
                  Run query
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!uploadedParquet) {
                      return
                    }
                    setQuerySql(DEFAULT_QUERY_SQL)
                  }}
                  disabled={!uploadedParquet}
                >
                  Reset query
                </Button>
                {queryError ? (
                  <p className="text-sm text-destructive">{queryError}</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
                <p className="text-sm font-semibold text-foreground">
                  Reader behavior
                </p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                  <li>Primitive values render directly in the grid.</li>
                  <li>
                    Long strings and complex values open in a row details modal.
                  </li>
                  <li>
                    The first table column opens a full row view at any time.
                  </li>
                  <li>Headers stay pinned while the table body scrolls.</li>
                  <li>
                    Pagination keeps large parquet files navigable in-browser.
                  </li>
                </ul>
              </div>
              <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
                <p className="text-sm font-semibold text-foreground">
                  Validation snapshot
                </p>
                <div className="mt-3 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 px-3 py-2">
                    <span className="text-muted-foreground">Header magic</span>
                    <span
                      className={
                        uploadedParquet?.magic.headerValid
                          ? "text-primary"
                          : "text-destructive"
                      }
                    >
                      {uploadedParquet
                        ? uploadedParquet.magic.headerValid
                          ? "Valid"
                          : "Invalid"
                        : "Pending"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 px-3 py-2">
                    <span className="text-muted-foreground">Footer magic</span>
                    <span
                      className={
                        uploadedParquet?.magic.footerValid
                          ? "text-primary"
                          : "text-destructive"
                      }
                    >
                      {uploadedParquet
                        ? uploadedParquet.magic.footerValid
                          ? "Valid"
                          : "Invalid"
                        : "Pending"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 px-5 py-4">
            <Button
              variant={activeView === "preview" ? "default" : "outline"}
              onClick={() => setActiveView("preview")}
              disabled={!uploadedParquet}
            >
              Full parquet view
            </Button>
            <Button
              variant={activeView === "query" ? "default" : "outline"}
              onClick={() => setActiveView("query")}
              disabled={!queryState.columns.length && !queryState.loading}
            >
              Query result
            </Button>
          </div>
        </section>

        {activeView === "preview" ? (
          <DataTable
            key={`preview-${previewState.page}-${previewState.pageSize}-${previewState.totalRows}-${previewState.columns.map((column) => column.name).join(",")}`}
            title="Full parquet view"
            description="Paginated browse of the uploaded parquet file."
            schemaTitle={`${ACTIVE_DB_NAME} columns`}
            schemaColumns={previewState.columns}
            state={previewState}
            onPageChange={(page) => {
              if (!uploadedParquet) {
                return
              }
              void loadPreviewPage(page, previewState.pageSize)
            }}
            onPageSizeChange={(pageSize) => {
              if (!uploadedParquet) {
                return
              }
              void loadPreviewPage(1, pageSize)
            }}
          />
        ) : (
          <DataTable
            key={`query-${queryState.page}-${queryState.pageSize}-${queryState.totalRows}-${queryState.columns.map((column) => column.name).join(",")}`}
            title="Query result"
            description="Paginated result set for the current DuckDB SQL query."
            schemaTitle={`${ACTIVE_DB_NAME} columns`}
            schemaColumns={previewState.columns}
            state={queryState}
            onPageChange={(page) =>
              void loadQueryPage(page, queryState.pageSize, querySql)
            }
            onPageSizeChange={(pageSize) =>
              void loadQueryPage(1, pageSize, querySql)
            }
          />
        )}

        {!uploadedParquet ? (
          <section className="flex min-h-48 items-center justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/80 px-6 text-center text-sm leading-6 text-muted-foreground">
            <div className="max-w-xl">
              <FileX className="mx-auto mb-3 size-5 text-muted-foreground" />
              Upload a parquet file to unlock header validation, DuckDB SQL
              execution, and the paginated data table.
            </div>
          </section>
        ) : null}

        <footer className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-border/70 bg-card/85 px-5 py-4 text-sm text-muted-foreground">
          <p>Everything runs locally in the browser memory space.</p>
          <Button
            variant="ghost"
            onClick={() => {
              if (!uploadedParquet) {
                return
              }
              void loadPreviewPage(previewState.page, previewState.pageSize)
            }}
            disabled={!uploadedParquet || previewState.loading}
          >
            <RefreshCw className="size-4" />
            Refresh preview
          </Button>
        </footer>
      </div>
    </main>
  )
}
