export type RuntimeConfigSupportedType = 'boolean' | 'number' | 'string' | 'object'

export type RuntimeConfigTypeMap = {
  [key: string]: RuntimeConfigSupportedType | RuntimeConfigTypeMap
}

export interface ConvertEnvOptions {
  key?: string
  dev?: boolean
  warn?: (message: string) => void
  expectedType?: RuntimeConfigSupportedType
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Enhanced, safe destr function:
 * Safely parses environment variable strings into JavaScript primitives and objects,
 * overcoming classic destr limitations:
 * 1. Context-aware: protects alphanumeric tokens / API keys (e.g. "4848e0") when default is a string.
 * 2. Leading zeros: protects zip codes and phone numbers (e.g. "01234").
 * 3. Safe integers: prevents 64-bit BigInt / Snowflake precision loss.
 * 4. Case-insensitive booleans and numeric booleans ("true", "false", "1", "0").
 * 5. Prototype pollution prevention on JSON objects/arrays.
 * 6. Non-crashing error handling and secret-masking warnings in dev mode.
 */
export function modifiedDestr<T = any>(
  val: unknown,
  expectedType?: RuntimeConfigSupportedType,
  options?: ConvertEnvOptions,
): T {
  if (typeof val !== 'string') {
    return val as T
  }

  const trimmed = val.trim()
  if (trimmed.length === 0) {
    if (expectedType === 'number') {
      if (options?.dev) {
        const keyInfo = options.key ? ` for \`${options.key}\`` : ''
        const warn = options.warn ?? console.warn
        warn(`[nuxt] Failed to cast environment variable${keyInfo} to number: empty string is not a valid number. Value preserved as string.`)
      }
    }
    return val as T
  }

  // 1. Explicit string expectation: NEVER cast (avoids destr 4848e0 token bug)
  if (expectedType === 'string') {
    return val as T
  }

  const lower = trimmed.toLowerCase()

  // 2. Boolean parsing
  if (lower === 'true' || (expectedType === 'boolean' && lower === '1')) {
    return true as unknown as T
  }
  if (lower === 'false' || (expectedType === 'boolean' && lower === '0')) {
    return false as unknown as T
  }
  if (expectedType === 'boolean') {
    if (options?.dev) {
      const keyInfo = options.key ? ` for \`${options.key}\`` : ''
      const warn = options.warn ?? console.warn
      warn(`[nuxt] Failed to cast environment variable${keyInfo} to boolean: expected "true", "false", "1", or "0". Value preserved as string.`)
    }
    return val as T
  }

  // 3. Null and undefined
  if (lower === 'null') return null as unknown as T
  if (lower === 'undefined') return undefined as unknown as T

  // 4. Number parsing & guards
  // Preserve strings with leading zeros (e.g., zip codes "01234", "007") unless it is just "0" or decimal "0.xxx"
  const hasLeadingZero = /^[-+]?0\d+/.test(trimmed)
  const isNumericFormat = /^[-+]?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)

  if (isNumericFormat && !hasLeadingZero) {
    const isScientific = /[eE]/.test(trimmed)
    // If it looks like scientific notation but target is not explicitly number, preserve as token
    if (isScientific && expectedType !== 'number') {
      return val as T
    }

    const num = Number(trimmed)
    if (Number.isFinite(num)) {
      // Guard against 64-bit integer precision loss
      if (Number.isInteger(num) && !Number.isSafeInteger(num)) {
        if (options?.dev) {
          const keyInfo = options.key ? ` for \`${options.key}\`` : ''
          const warn = options.warn ?? console.warn
          warn(`[nuxt] Large integer${keyInfo} exceeds Number.MAX_SAFE_INTEGER. Value preserved as string.`)
        }
        return val as T
      }
      return num as unknown as T
    }
  }

  if (expectedType === 'number') {
    if (options?.dev) {
      const keyInfo = options.key ? ` for \`${options.key}\`` : ''
      const warn = options.warn ?? console.warn
      warn(`[nuxt] Failed to cast environment variable${keyInfo} to number: value is not a finite number. Value preserved as string.`)
    }
    return val as T
  }

  // 5. JSON parsing with prototype pollution protection
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed, (key, value) => {
        if (FORBIDDEN_KEYS.has(key)) {
          return undefined
        }
        return value
      }) as T
    } catch {
      return val as T
    }
  }

  return val as T
}

/**
 * Alias for convertEnvValue for compatibility
 */
export function convertEnvValue (
  value: unknown,
  expectedType: RuntimeConfigSupportedType,
  options?: ConvertEnvOptions,
): unknown {
  return modifiedDestr(value, expectedType, options)
}

/**
 * Determine the supported leaf type for a given default value.
 */
export function inferSupportedType (value: unknown): RuntimeConfigSupportedType | undefined {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? 'number' : undefined
  }
  if (typeof value === 'string') {
    return 'string'
  }
  return undefined
}

/**
 * Recursively snapshots the types of resolved runtime configuration defaults.
 */
export function snapshotRuntimeConfigTypes (config: Record<string, unknown>): RuntimeConfigTypeMap {
  const result: RuntimeConfigTypeMap = {}
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return result
  }

  for (const key of Object.keys(config)) {
    if (FORBIDDEN_KEYS.has(key)) {
      continue
    }

    const value = config[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = snapshotRuntimeConfigTypes(value as Record<string, unknown>)
      if (Object.keys(nested).length > 0) {
        result[key] = nested
      }
    } else {
      const leafType = inferSupportedType(value)
      if (leafType) {
        result[key] = leafType
      }
    }
  }

  return result
}

/**
 * Apply type conversion to a runtime configuration object in-place using modifiedDestr.
 */
export function applyRuntimeConfigEnvTypes (
  config: Record<string, any>,
  types: RuntimeConfigTypeMap,
  options?: ConvertEnvOptions,
  parentKey = '',
): void {
  if (!config || typeof config !== 'object' || !types || typeof types !== 'object') {
    return
  }

  for (const key of Object.keys(types)) {
    if (FORBIDDEN_KEYS.has(key)) {
      continue
    }

    const expected = types[key]
    const currentVal = config[key]
    const keyPath = parentKey ? `${parentKey}.${key}` : key

    if (typeof expected === 'string') {
      if (typeof currentVal === 'string') {
        config[key] = modifiedDestr(currentVal, expected, {
          ...options,
          key: keyPath,
        })
      }
    } else if (expected && typeof expected === 'object' && currentVal && typeof currentVal === 'object' && !Array.isArray(currentVal)) {
      applyRuntimeConfigEnvTypes(currentVal, expected, options, keyPath)
    }
  }
}
