// Small request validators standing in for M6's zod schemas. Collect field errors, then fail with
// 422 validation_failed and details.fields (§6.4.1).
import { Fail } from './route'

export class Fields {
  readonly errors: Record<string, string> = {}
  readonly body: Record<string, unknown>
  constructor(body: Record<string, unknown>) {
    this.body = body
  }

  add(field: string, message: string) {
    this.errors[field] ??= message
  }
  /** Rejects keys outside `allowed` (strict, like zod .strict()). */
  only(allowed: readonly string[]) {
    for (const k of Object.keys(this.body)) if (!allowed.includes(k)) this.add(k, 'Unknown field')
    return this
  }
  done(code: 'validation_failed' | 'action_invalid' = 'validation_failed', message = 'Invalid request') {
    if (Object.keys(this.errors).length) throw new Fail(422, code, message, { fields: this.errors })
  }
}

export function object(body: unknown): Fields {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Fail(422, 'validation_failed', 'Expected a JSON object', { fields: { _: 'Expected an object' } })
  }
  return new Fields(body as Record<string, unknown>)
}

export const isStr = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
export const isOptStr = (v: unknown, max: number) => v === null || isStr(v, max)
export const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
export const isDateTime = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))
export const isEmail = (v: unknown) => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
export const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max

/** Comma-separated query values, each from `allowed` (OR within a parameter). 400 on unknown values. */
export function csv<T extends string>(url: URL, name: string, allowed: readonly T[]): T[] | null {
  const raw = url.searchParams.get(name)
  if (raw === null || raw === '') return null
  const values = raw.split(',').map((v) => v.trim())
  const bad = values.find((v) => !allowed.includes(v as T))
  if (bad !== undefined) throw new Fail(400, 'bad_request', `Unknown ${name} value: ${bad}`)
  return values as T[]
}
