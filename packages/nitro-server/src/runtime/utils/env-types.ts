export type RuntimeConfigSupportedType = 'boolean' | 'number' | 'string'

export type RuntimeConfigTypeMap = {
  [key: string]: RuntimeConfigSupportedType | RuntimeConfigTypeMap
}

export interface ConvertEnvOptions {
  key?: string
  dev?: boolean
  warn?: (message: string) => void
}

/**
 * Determine the supported leaf type for a given default value.
 * Returns undefined for null, undefined, arrays, functions, symbols, or non-finite numbers.
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
 * Preserves the nested structure and maps leaf properties to 'boolean' | 'number' | 'string'.
 * Arrays, null, undefined, and unsupported values are safely ignored.
 */
export function snapshotRuntimeConfigTypes (config: Record<string, unknown>): RuntimeConfigTypeMap {
  const result: RuntimeConfigTypeMap = {}
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return result
  }

  for (const key of Object.keys(config)) {
    // Avoid prototype pollution and unsafe keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
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
 * Convert a raw environment-variable string according to the expected type derived from the default value.
 * When conversion is invalid or unsafe:
 * - Preserves the original string
 * - Emits a development warning (without leaking sensitive values)
 * - Never crashes the application
 */
export function convertEnvValue (
  value: unknown,
  expectedType: RuntimeConfigSupportedType,
  options?: ConvertEnvOptions,
): unknown {
  if (typeof value !== 'string') {
    return value
  }

  if (expectedType === 'string') {
    return value
  }

  if (expectedType === 'boolean') {
    if (value === 'true' || value === '1') {
      return true
    }
    if (value === 'false' || value === '0') {
      return false
    }

    if (options?.dev) {
      const keyInfo = options.key ? ` for \`${options.key}\`` : ''
      const warn = options.warn ?? console.warn
      warn(`[nuxt] Failed to convert environment variable${keyInfo} to boolean: expected "true", "false", "1", or "0". Value preserved as string.`)
    }
    return value
  }

  if (expectedType === 'number') {
    const trimmed = value.trim()
    if (trimmed === '') {
      if (options?.dev) {
        const keyInfo = options.key ? ` for \`${options.key}\`` : ''
        const warn = options.warn ?? console.warn
        warn(`[nuxt] Failed to convert environment variable${keyInfo} to number: empty or whitespace string is not a valid number. Value preserved as string.`)
      }
      return value
    }

    const num = Number(trimmed)
    if (!Number.isFinite(num)) {
      if (options?.dev) {
        const keyInfo = options.key ? ` for \`${options.key}\`` : ''
        const warn = options.warn ?? console.warn
        warn(`[nuxt] Failed to convert environment variable${keyInfo} to number: value is not a finite number. Value preserved as string.`)
      }
      return value
    }

    // For integer-looking inputs, check safe integer range to avoid silent precision loss
    if (/^[+-]?\d+$/.test(trimmed)) {
      if (!Number.isSafeInteger(num)) {
        if (options?.dev) {
          const keyInfo = options.key ? ` for \`${options.key}\`` : ''
          const warn = options.warn ?? console.warn
          warn(`[nuxt] Failed to convert environment variable${keyInfo} to number: value exceeds safe integer range. Value preserved as string.`)
        }
        return value
      }
    }

    return num
  }

  return value
}

/**
 * Apply type conversion to a runtime configuration object in-place using a pre-computed type snapshot map.
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
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }

    const expected = types[key]
    const currentVal = config[key]
    const keyPath = parentKey ? `${parentKey}.${key}` : key

    if (typeof expected === 'string') {
      // Leaf conversion
      if (typeof currentVal === 'string') {
        config[key] = convertEnvValue(currentVal, expected, {
          ...options,
          key: keyPath,
        })
      }
    } else if (expected && typeof expected === 'object' && currentVal && typeof currentVal === 'object' && !Array.isArray(currentVal)) {
      applyRuntimeConfigEnvTypes(currentVal, expected, options, keyPath)
    }
  }
}

