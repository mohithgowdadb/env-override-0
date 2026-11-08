import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetRuntimeConfigCache, useRuntimeConfig } from '../src/runtime/runtime-config.ts'
import { useRuntimeConfig as useCompatRuntimeConfig } from '../src/runtime/compat/runtime-config.ts'
import { convertEnvValue, inferSupportedType, snapshotRuntimeConfigTypes } from '../src/runtime/utils/env-types.ts'

const mockNitroRuntimeConfig = vi.fn()
vi.mock('nitro/runtime-config', () => ({
  useRuntimeConfig: () => mockNitroRuntimeConfig(),
}))

let mockVirtualNitroConfig: {
  NUXT_DEV: boolean
  NUXT_RUNTIME_CONFIG_ENV_TYPES: boolean
  NUXT_RUNTIME_CONFIG_TYPES: Record<string, any>
} = {
  NUXT_DEV: true,
  NUXT_RUNTIME_CONFIG_ENV_TYPES: false,
  NUXT_RUNTIME_CONFIG_TYPES: {},
}

vi.mock('#internal/nuxt/nitro-config.mjs', () => ({
  get NUXT_DEV () {
    return mockVirtualNitroConfig.NUXT_DEV
  },
  get NUXT_RUNTIME_CONFIG_ENV_TYPES () {
    return mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_ENV_TYPES
  },
  get NUXT_RUNTIME_CONFIG_TYPES () {
    return mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_TYPES
  },
}))

describe('nitro-server runtime-config type compatibility (Nuxt Issue #36846)', () => {
  beforeEach(() => {
    _resetRuntimeConfigCache()
    mockVirtualNitroConfig = {
      NUXT_DEV: true,
      NUXT_RUNTIME_CONFIG_ENV_TYPES: false,
      NUXT_RUNTIME_CONFIG_TYPES: {},
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _resetRuntimeConfigCache()
  })

  describe('Flag OFF (Default Nitro 3 behavior)', () => {
    it('preserves string environment overrides when flag is disabled', () => {
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_ENV_TYPES = false
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_TYPES = {
        session: {
          cookie: {
            secure: 'boolean',
          },
        },
      }

      mockNitroRuntimeConfig.mockReturnValue({
        session: {
          cookie: {
            secure: 'false',
          },
        },
      })

      const config = useRuntimeConfig()
      expect(config.session.cookie.secure).toBe('false')
    })
  })

  describe('Flag ON (Type-aware conversion)', () => {
    it('converts boolean environment overrides based on default snapshot', () => {
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_ENV_TYPES = true
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_TYPES = {
        session: {
          cookie: {
            secure: 'boolean',
          },
        },
        featureFlag: 'boolean',
        disabledFlag: 'boolean',
      }

      mockNitroRuntimeConfig.mockReturnValue({
        session: {
          cookie: {
            secure: 'false',
          },
        },
        featureFlag: '1',
        disabledFlag: '0',
      })

      const config = useRuntimeConfig()
      expect(config.session.cookie.secure).toBe(false)
      expect(config.featureFlag).toBe(true)
      expect(config.disabledFlag).toBe(false)
    })

    it('converts number environment overrides based on default snapshot', () => {
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_ENV_TYPES = true
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_TYPES = {
        database: {
          port: 'number',
        },
        scale: 'number',
        factor: 'number',
      }

      mockNitroRuntimeConfig.mockReturnValue({
        database: {
          port: '3000',
        },
        scale: '4848e0',
        factor: '1.5e3',
      })

      const config = useRuntimeConfig()
      expect(config.database.port).toBe(3000)
      expect(config.scale).toBe(4848)
      expect(config.factor).toBe(1500)
    })

    it('preserves strings when default is string', () => {
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_ENV_TYPES = true
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_TYPES = {
        apiKey: 'string',
        version: 'string',
      }

      mockNitroRuntimeConfig.mockReturnValue({
        apiKey: '4848e0',
        version: 'false',
      })

      const config = useRuntimeConfig()
      expect(config.apiKey).toBe('4848e0')
      expect(config.version).toBe('false')
    })

    it('warns in dev mode on invalid number without crashing or leaking value', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_ENV_TYPES = true
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_TYPES = {
        secretPort: 'number',
      }

      mockNitroRuntimeConfig.mockReturnValue({
        secretPort: 'super-secret-invalid-token',
      })

      const config = useRuntimeConfig()
      expect(config.secretPort).toBe('super-secret-invalid-token')
      expect(warnSpy).toHaveBeenCalled()
      // Ensure the secret value was not leaked into the warning message
      for (const call of warnSpy.mock.calls) {
        expect(call[0]).not.toContain('super-secret-invalid-token')
      }
    })

    it('preserves unsafe large integers as strings to avoid precision loss', () => {
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_ENV_TYPES = true
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_TYPES = {
        largeId: 'number',
      }

      mockNitroRuntimeConfig.mockReturnValue({
        largeId: '9007199254740993',
      })

      const config = useRuntimeConfig()
      expect(config.largeId).toBe('9007199254740993')
    })

    it('works identically via compat useRuntimeConfig', () => {
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_ENV_TYPES = true
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_TYPES = {
        session: {
          cookie: {
            secure: 'boolean',
          },
        },
      }

      mockNitroRuntimeConfig.mockReturnValue({
        session: {
          cookie: {
            secure: 'false',
          },
        },
      })

      const config = useCompatRuntimeConfig()
      expect(config.session.cookie.secure).toBe(false)

      const perRequest = useCompatRuntimeConfig({ context: {} } as any)
      expect(perRequest.session.cookie.secure).toBe(false)
    })

    it('memoizes the cast config so conversion runs only once', () => {
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_ENV_TYPES = true
      mockVirtualNitroConfig.NUXT_RUNTIME_CONFIG_TYPES = {
        port: 'number',
      }

      const instance = { port: '3000' }
      mockNitroRuntimeConfig.mockReturnValue(instance)

      const config1 = useRuntimeConfig()
      const config2 = useRuntimeConfig()
      expect(config1).toBe(config2)
      expect(config1.port).toBe(3000)
    })
  })

  describe('Type snapshot generation (snapshotRuntimeConfigTypes)', () => {
    it('captures supported leaf types from default config', () => {
      const defaults = {
        database: {
          port: 5432,
          host: 'localhost',
        },
        session: {
          secure: true,
        },
        tags: ['a', 'b'],
        emptyVal: null,
        unsetVal: undefined,
      }

      const snapshot = snapshotRuntimeConfigTypes(defaults)
      expect(snapshot).toEqual({
        database: {
          port: 'number',
          host: 'string',
        },
        session: {
          secure: 'boolean',
        },
      })
    })

    it('safely ignores unsafe prototype keys', () => {
      const dirty = JSON.parse('{"__proto__": "polluted", "safe": 123}')
      const snapshot = snapshotRuntimeConfigTypes(dirty)
      expect(snapshot).toEqual({
        safe: 'number',
      })
    })
  })

  describe('Direct value conversion helper (convertEnvValue)', () => {
    it('converts booleans strictly', () => {
      expect(convertEnvValue('true', 'boolean')).toBe(true)
      expect(convertEnvValue('1', 'boolean')).toBe(true)
      expect(convertEnvValue('false', 'boolean')).toBe(false)
      expect(convertEnvValue('0', 'boolean')).toBe(false)
      expect(convertEnvValue('yes', 'boolean')).toBe('yes')
      expect(convertEnvValue('no', 'boolean')).toBe('no')
    })

    it('converts numbers strictly and handles edge cases', () => {
      expect(convertEnvValue('3000', 'number')).toBe(3000)
      expect(convertEnvValue('12.5', 'number')).toBe(12.5)
      expect(convertEnvValue('-10', 'number')).toBe(-10)
      expect(convertEnvValue('0', 'number')).toBe(0)
      expect(convertEnvValue('4848e0', 'number')).toBe(4848)
      expect(convertEnvValue('1.5e3', 'number')).toBe(1500)
      expect(convertEnvValue('', 'number')).toBe('')
      expect(convertEnvValue('   ', 'number')).toBe('   ')
      expect(convertEnvValue('NaN', 'number')).toBe('NaN')
      expect(convertEnvValue('Infinity', 'number')).toBe('Infinity')
    })

    it('preserves strings unchanged', () => {
      expect(convertEnvValue('4848e0', 'string')).toBe('4848e0')
      expect(convertEnvValue('false', 'string')).toBe('false')
      expect(convertEnvValue('null', 'string')).toBe('null')
    })
  })
})
