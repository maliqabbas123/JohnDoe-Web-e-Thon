'use client'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { serverNow } from '../../context/MockStoreContext'
export function Button({
  children,
  to,
  onClick,
  secondary = false,
  disabled = false,
  type = 'button',
}: {
  children: ReactNode
  to?: string
  onClick?: () => void
  secondary?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const cls = 'button ' + (secondary ? 'secondary' : '')
  return to && !disabled ? (
    <Link className={cls} href={to}>
      {children}
    </Link>
  ) : (
    <button className={cls} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}
export function Badge({ children }: { children: string }) {
  return (
    <span
      className={
        'badge ' +
        (/active|verified|graded|resolved|ongoing|passed|completed|online|available/i.test(
          children,
        ) && !/inactive|ungraded/i.test(children)
          ? 'green'
          : /pending|unstable|escalated|upcoming|review/i.test(children)
            ? 'amber'
            : /offline|failed|revoked/i.test(children)
              ? 'red'
              : '')
      }
    >
      {children}
    </span>
  )
}
export function Heading({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  )
}
export function Panel({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <section className="panel">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  )
}
export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
export function Tabs({
  labels,
  children,
}: {
  labels: string[]
  children: (index: number) => ReactNode
}) {
  const [selected, set] = useState(0)
  const id = useId()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  return (
    <>
      <div className="tabs" role="tablist">
        {labels.map((label, i) => (
          <button
            type="button"
            role="tab"
            id={id + '-tab-' + i}
            aria-controls={id + '-panel'}
            aria-selected={i === selected}
            tabIndex={i === selected ? 0 : -1}
            ref={(button) => {
              buttons.current[i] = button
            }}
            key={label}
            onClick={() => set(i)}
            onKeyDown={(event) => {
              const next = {
                ArrowRight: (i + 1) % labels.length,
                ArrowLeft: (i + labels.length - 1) % labels.length,
                Home: 0,
                End: labels.length - 1,
              }[event.key]
              if (next === undefined) return
              event.preventDefault()
              set(next)
              buttons.current[next]?.focus()
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={id + '-panel'}
        aria-labelledby={id + '-tab-' + selected}
        tabIndex={0}
      >
        {children(selected)}
      </div>
    </>
  )
}

export function Modal({
  title,
  close,
  children,
  drawer = false,
}: {
  title: string
  close: () => void
  children: ReactNode
  drawer?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className={drawer ? 'drawer' : ''}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon" aria-label="Close" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
export function SlideOverDrawer(
  props: Omit<Parameters<typeof Modal>[0], 'drawer'>,
) {
  return <Modal {...props} drawer />
}
export interface TableRow {
  key: string
  cells: ReactNode[]
  search: string
  filters?: Record<string, string>
}
export function DataTable({
  columns,
  rows,
  filters = {},
  placeholder = 'Search records…',
}: {
  columns: string[]
  rows: TableRow[]
  filters?: Record<string, string[]>
  placeholder?: string
}) {
  const [query, setQuery] = useState(''),
    [values, setValues] = useState<Record<string, string>>({}),
    [page, setPage] = useState(0)
  const filtered = rows.filter(
      (row) =>
        row.search.toLowerCase().includes(query.toLowerCase()) &&
        Object.entries(values).every(([k, v]) => !v || row.filters?.[k] === v),
    ),
    size = 7,
    last = Math.max(0, Math.ceil(filtered.length / size) - 1),
    current = Math.min(page, last)
  return (
    <>
      <div className="table-tools">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search records"
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
          />
        </label>
        {Object.entries(filters).map(([k, opts]) => (
          <select
            aria-label={k}
            key={k}
            value={values[k] ?? ''}
            onChange={(e) => {
              setValues({ ...values, [k]: e.target.value })
              setPage(0)
            }}
          >
            <option value="">All {k.toLowerCase()}</option>
            {opts.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice(current * size, current * size + size)
              .map((row) => (
                <tr key={row.key}>
                  {row.cells.map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
            {!filtered.length && (
              <tr>
                <td colSpan={columns.length}>No matching records.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>
          {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
        </span>
        <div className="actions">
          <button
            className="icon"
            aria-label="Previous page"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            Page {current + 1} of {last + 1}
          </span>
          <button
            className="icon"
            aria-label="Next page"
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </>
  )
}
export function Stats({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="stats">
      {items.map(([label, value]) => (
        <div className="stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}
export function ToastNotification({ message }: { message: string }) {
  return message ? (
    <div role="status" className="toast">
      <CheckCircle2 size={19} />
      {message}
    </div>
  ) : null
}
export function useClock() {
  const [now, set] = useState(serverNow)
  useEffect(() => {
    const handle = setInterval(() => set(serverNow()), 500)
    return () => clearInterval(handle)
  }, [])
  return now
}
export function ServerSyncedTimer({ end }: { end: number }) {
  const now = useClock(),
    remaining = Math.max(0, Math.ceil((end - now) / 1000))
  return (
    <span className={'timer ' + (remaining < 300 ? 'danger' : '')}>
      <Clock size={17} />
      {Math.floor(remaining / 60)
        .toString()
        .padStart(2, '0')}
      :{(remaining % 60).toString().padStart(2, '0')}
    </span>
  )
}
export function NetworkStatusPill({
  status,
  pending,
}: {
  status: string
  pending: boolean
}) {
  return (
    <span className="network">
      <Badge>{status}</Badge>
      {status === 'Offline' ? <WifiOff size={16} /> : <Wifi size={16} />}{' '}
      {pending ? 'Saved locally' : 'Synced'}
    </span>
  )
}
export function VerifiableQRCode({ code }: { code: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    QRCode.toString(
      new URL('/verify/' + encodeURIComponent(code), location.origin).href,
      { type: 'svg', margin: 2 },
    ).then((value) => {
      if (live) setSvg('data:image/svg+xml,' + encodeURIComponent(value))
    })
    return () => {
      live = false
    }
  }, [code])
  return (
    <div className="qr">
      {svg && (
        <img
          width="124"
          height="124"
          src={svg}
          alt={'Verification QR for ' + code}
        />
      )}
      <Link href={'/verify/' + code}>{code}</Link>
    </div>
  )
}
export function Timeline({
  events,
}: {
  events: { at: number; type: string; message: string }[]
}) {
  return (
    <div className="timeline">
      {events.length ? (
        events.map((event, i) => (
          <article key={i}>
            <Badge>{event.type}</Badge>
            <p>{event.message}</p>
            <small>{new Date(event.at).toLocaleString()}</small>
          </article>
        ))
      ) : (
        <p>No events recorded.</p>
      )}
    </div>
  )
}
function csv(text: string) {
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(field)
      field = ''
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++
        rows.push(row)
        row = []
      }
    } else field += c
  }
  if (quoted) throw Error('Unclosed CSV quote')
  if (field || row.length) rows.push([...row, field])
  const head = rows.shift()?.map((x) => x.trim().replace(/^\uFEFF/, '')) ?? []
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]?.trim() ?? ''])))
}
export function ImportModal<T>({
  title,
  close,
  limit,
  fields,
  parse,
  save,
}: {
  title: string
  close: () => void
  limit: number
  fields: string
  parse: (value: Record<string, unknown>) => T
  save: (rows: T[]) => void
}) {
  const [rows, set] = useState<{ raw: unknown; value?: T; error?: string }[]>(
      [],
    ),
    [error, setError] = useState('')
  return (
    <Modal title={title} close={close}>
      <p>Upload a CSV or JSON array. Fields: {fields}.</p>
      <Field label="Import file">
        <input
          type="file"
          accept=".csv,.json"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setError('')
            set([])
            try {
              const raw = await f.text()
              const records: unknown = f.name.toLowerCase().endsWith('.json')
                ? JSON.parse(raw)
                : csv(raw)
              if (
                !Array.isArray(records) ||
                !records.length ||
                records.length > limit
              )
                throw Error('Upload between 1 and ' + limit + ' records.')
              set(
                records.map((raw) => {
                  try {
                    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                      throw Error('Expected a record')
                    return { raw, value: parse(raw) }
                  } catch (err) {
                    return { raw, error: (err as Error).message }
                  }
                }),
              )
            } catch (err) {
              setError((err as Error).message)
            }
          }}
        />
      </Field>
      {error && (
        <p role="alert" className="danger">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <DataTable
          columns={['Row', 'Preview', 'Validation']}
          rows={rows.map((r, i) => ({
            key: String(i),
            search: JSON.stringify(r.raw),
            cells: [
              i + 1,
              <code>{JSON.stringify(r.raw)}</code>,
              r.error ?? <Badge>Valid</Badge>,
            ],
          }))}
        />
      )}
      <div className="actions">
        <Button secondary onClick={close}>
          Cancel
        </Button>
        <Button
          disabled={!rows.length || rows.some((r) => r.error)}
          onClick={() => {
            try {
              save(rows.map((r) => r.value as T))
              close()
            } catch (err) {
              setError((err as Error).message)
            }
          }}
        >
          Import {rows.length || ''} records
        </Button>
      </div>
    </Modal>
  )
}
