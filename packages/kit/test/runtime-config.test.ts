import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { snakeCase } from 'scule'
import * as context from '../src/context.ts'
import { updateRuntimeConfig, useRuntimeConfig } from '../src/runtime-config.ts'

const { mockKlona } = vi.hoisted(() => ({
  mockKlona: vi.fn(),
}))
vi.mock('klona', () => ({
  klona: mockKlona,
}))

const testCases = [
  {
    description:
      'should return runtime config with environment variables applied',
    runtimeConfig: {
      apiUrl: 'http://localhost',
      authUrl: 'http://auth.com',
    },
    envExpansion: true,
    env: {
      NITRO_API_URL: 'http://example.com',
    },
    expected: {
      apiUrl: 'http://example.com',
      authUrl: 'http://auth.com',
    },
  },
  {
    description: 'should expand environment variables in strings',
    runtimeConfig: {
      apiUrl: '{{BASE_URL}}/api',
      mail: '{{MAIL_SCHEME}}://{{MAIL_HOST}}:{{MAIL_PORT}}',
    },
    envExpansion: true,
    env: {
      BASE_URL: 'http://example.com',
      MAIL_SCHEME: 'http',
      MAIL_HOST: 'localhost',
      MAIL_PORT: '3366',
    },
    expected: {
      apiUrl: 'http://example.com/api',
      mail: 'http://localhost:3366',
    },
  },
  {
    description:
      'should not expand environment variables if envExpansion is false',
    runtimeConfig: {
      apiUrl: '{{BASE_URL}}/api',
      someUrl: '',
    },
    envExpansion: false,
    env: {
      BASE_URL: 'http://example1.com',
      NITRO_NOT_API_URL: 'http://example2.com',
      NUXT_SOME_URL: 'http://example3.com',
    },
    expected: {
      apiUrl: '{{BASE_URL}}/api',
      someUrl: 'http://example3.com',
    },
  },
]

const leaf = fc.oneof(fc.string(), fc.constantFrom('hello', '', 'http://x'))
const configKey = fc.constantFrom('apiUrl', 'auth', 'mail', 'port', 'a', 'nested')
const config = fc.letrec<{ value: unknown }>(tie => ({
  value: fc.oneof(
    { weight: 4, arbitrary: leaf },
    { weight: 1, arbitrary: fc.dictionary(configKey, tie('value'), { maxKeys: 3 }) },
  ),
})).value

function run (runtimeConfig: Record<string, unknown>, env: Record<string, string> = {}, envExpansion = false) {
  vi.unstubAllEnvs()
  vi.spyOn(context, 'useNuxt').mockReturnValue({ options: { nitro: { runtimeConfig, experimental: { envExpansion } } } } as any)
  mockKlona.mockReturnValue(structuredClone(runtimeConfig))
  for (const [key, value] of Object.entries(env)) { vi.stubEnv(key, value) }
  return useRuntimeConfig()
}

function leafPaths (value: unknown, path: string[] = []): string[][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { return [path] }
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...path, key]))
}

describe('useRuntimeConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(testCases)('$description', ({ runtimeConfig, envExpansion, env, expected }) => {
    vi.spyOn(context, 'useNuxt').mockReturnValue({ options: { nitro: { runtimeConfig, experimental: { envExpansion } } } } as any)
    mockKlona.mockReturnValue(runtimeConfig)
    Object.entries(env).forEach(([key, value]) => vi.stubEnv(key, value))

    expect(useRuntimeConfig()).toEqual(expected)
  })
})

// Tests for environment-variable overrides under Nitro 3 and the experimental
// runtimeConfigEnvTypes flag (Nuxt Issue #36846).
describe('useRuntimeConfig environment variable type compatibility (runtimeConfigEnvTypes)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('Test A — Flag OFF: environment-variable overrides remain strings', () => {
    const runtimeConfig = {
      enabled: true,
      identifier: '',
      retries: 0,
    }
    vi.spyOn(context, 'useNuxt').mockReturnValue({
      options: {
        dev: true,
        nitro: {
          runtimeConfig,
          experimental: { runtimeConfigEnvTypes: false },
        },
      },
    } as any)
    mockKlona.mockReturnValue(structuredClone(runtimeConfig))
    vi.stubEnv('NUXT_ENABLED', 'false')
    vi.stubEnv('NUXT_IDENTIFIER', '4848e0')
    vi.stubEnv('NUXT_RETRIES', '10')

    expect(useRuntimeConfig()).toEqual({
      enabled: 'false',
      identifier: '4848e0',
      retries: '10',
    })
  })

  it('Test B — Flag ON: environment-variable overrides follow default types', () => {
    const runtimeConfig = {
      enabled: true,
      identifier: '',
      retries: 0,
    }
    vi.spyOn(context, 'useNuxt').mockReturnValue({
      options: {
        dev: true,
        nitro: {
          runtimeConfig,
          experimental: { runtimeConfigEnvTypes: true },
        },
      },
    } as any)
    mockKlona.mockReturnValue(structuredClone(runtimeConfig))
    vi.stubEnv('NUXT_ENABLED', 'false')
    vi.stubEnv('NUXT_IDENTIFIER', '4848e0')
    vi.stubEnv('NUXT_RETRIES', '10')

    expect(useRuntimeConfig()).toEqual({
      enabled: false,
      identifier: '4848e0',
      retries: 10,
    })
  })

  it('Test C — Type depends on default (string default remains string)', () => {
    const runtimeConfig = {
      value: '',
    }
    vi.spyOn(context, 'useNuxt').mockReturnValue({
      options: {
        dev: true,
        nitro: {
          runtimeConfig,
          experimental: { runtimeConfigEnvTypes: true },
        },
      },
    } as any)
    mockKlona.mockReturnValue(structuredClone(runtimeConfig))
    vi.stubEnv('NUXT_VALUE', 'false')

    expect(useRuntimeConfig()).toEqual({
      value: 'false',
    })
  })

  it('Test D — Number default converts scientific notation / numeric string', () => {
    const runtimeConfig = {
      value: 0,
    }
    vi.spyOn(context, 'useNuxt').mockReturnValue({
      options: {
        dev: true,
        nitro: {
          runtimeConfig,
          experimental: { runtimeConfigEnvTypes: true },
        },
      },
    } as any)
    mockKlona.mockReturnValue(structuredClone(runtimeConfig))
    vi.stubEnv('NUXT_VALUE', '4848e0')

    expect(useRuntimeConfig()).toEqual({
      value: 4848,
    })
  })

  it('Test E — Invalid number preserves string, warns in dev, does not crash', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runtimeConfig = {
      value: 0,
    }
    vi.spyOn(context, 'useNuxt').mockReturnValue({
      options: {
        dev: true,
        nitro: {
          runtimeConfig,
          experimental: { runtimeConfigEnvTypes: true },
        },
      },
    } as any)
    mockKlona.mockReturnValue(structuredClone(runtimeConfig))
    vi.stubEnv('NUXT_VALUE', 'invalid')

    expect(useRuntimeConfig()).toEqual({
      value: 'invalid',
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[nuxt] Failed to cast environment variable for `value` to number'),
    )
    expect(warnSpy.mock.calls[0]?.[0]).not.toContain('invalid')
  })

  it('Test F — Missing variable retains default silently with no warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runtimeConfig = {
      value: 3000,
    }
    vi.spyOn(context, 'useNuxt').mockReturnValue({
      options: {
        dev: true,
        nitro: {
          runtimeConfig,
          experimental: { runtimeConfigEnvTypes: true },
        },
      },
    } as any)
    mockKlona.mockReturnValue(structuredClone(runtimeConfig))

    expect(useRuntimeConfig()).toEqual({
      value: 3000,
    })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('Test G — Invalid boolean preserves string, warns in dev, does not crash', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runtimeConfig = {
      enabled: true,
    }
    vi.spyOn(context, 'useNuxt').mockReturnValue({
      options: {
        dev: true,
        nitro: {
          runtimeConfig,
          experimental: { runtimeConfigEnvTypes: true },
        },
      },
    } as any)
    mockKlona.mockReturnValue(structuredClone(runtimeConfig))
    vi.stubEnv('NUXT_ENABLED', 'yes')

    expect(useRuntimeConfig()).toEqual({
      enabled: 'yes',
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[nuxt] Failed to cast environment variable for `enabled` to boolean'),
    )
    expect(warnSpy.mock.calls[0]?.[0]).not.toContain('yes')
  })

  it('Test H — Default behavior: casting is enabled by default without specifying flag', () => {
    const runtimeConfig = {
      port: 3000,
      enabled: false,
    }
    vi.spyOn(context, 'useNuxt').mockReturnValue({
      options: {
        dev: true,
        nitro: {
          runtimeConfig,
          experimental: {},
        },
      },
    } as any)
    mockKlona.mockReturnValue(structuredClone(runtimeConfig))
    vi.stubEnv('NUXT_PORT', '8080')
    vi.stubEnv('NUXT_ENABLED', 'true')

    expect(useRuntimeConfig()).toEqual({
      port: 8080,
      enabled: true,
    })
  })
})

describe('useRuntimeConfig env application', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('should expand an environment variable in a single pass', () => {
    expect(run({ a: '{{X}}' }, { X: '{{Y}}', Y: 'boom' }, true).a).toBe('{{Y}}')
  })

  it('should be the identity when no environment variable matches', () => {
    fc.assert(fc.property(fc.dictionary(configKey, config, { minKeys: 1, maxKeys: 3 }), (runtimeConfig) => {
      expect(run(runtimeConfig)).toEqual(runtimeConfig)
    }), { numRuns: 500 })
  })

  it('should override exactly the targeted leaf', () => {
    fc.assert(fc.property(fc.dictionary(configKey, config, { minKeys: 1, maxKeys: 3 }), fc.nat(), (runtimeConfig, index) => {
      const paths = leafPaths(runtimeConfig)
      fc.pre(paths.length > 0)
      const path = paths[index % paths.length]!
      const envKey = 'NITRO_' + snakeCase(path.join('_')).toUpperCase()

      const result = run(runtimeConfig, { [envKey]: 'sentinel-value' })

      let cursor: any = result
      for (const key of path.slice(0, -1)) { cursor = cursor[key] }
      expect(cursor[path.at(-1)!]).toBe('sentinel-value')

      for (const other of paths) {
        if (other.join('_') === path.join('_')) { continue }
        if (snakeCase(other.join('_')).toUpperCase() === snakeCase(path.join('_')).toUpperCase()) { continue }
        let expected: any = runtimeConfig
        let actual: any = result
        for (const key of other) {
          expected = expected?.[key]
          actual = actual?.[key]
        }
        expect(actual, `${other.join('.')} changed`).toEqual(expected)
      }
    }), { numRuns: 500 })
  })
})

describe('updateRuntimeConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function stubNuxt (nitro?: { options: Record<string, unknown>, updateConfig: (config: unknown) => void }) {
    const nuxt = { options: { nitro: { runtimeConfig: { existing: 'value' } } }, _nitro: nitro }
    vi.spyOn(context, 'useNuxt').mockReturnValue(nuxt as any)
    vi.spyOn(context, 'tryUseNuxt').mockReturnValue(nuxt as any)
    return nuxt
  }

  it('should merge into the nitro runtime config', () => {
    const nuxt = stubNuxt()

    updateRuntimeConfig({ example: { foo: 'bar' } })

    expect(nuxt.options.nitro.runtimeConfig).toEqual({ existing: 'value', example: { foo: 'bar' } })
  })

  it('should update the nitro instance when there is one', () => {
    const updateConfig = vi.fn()
    const routeRules = { '/**': { ssr: true } }
    stubNuxt({
      options: {
        routeRules,
        runtimeConfig: { existing: 'nitro', example: { baz: 'qux' }, nitro: { envPrefix: 'NUXT_', routeRules } },
      },
      updateConfig,
    })

    updateRuntimeConfig({ example: { foo: 'bar' } })

    expect(updateConfig).toHaveBeenCalledWith({
      runtimeConfig: { existing: 'nitro', example: { foo: 'bar', baz: 'qux' }, nitro: { envPrefix: 'NUXT_', routeRules } },
      routeRules,
    })
  })

  it('should not warn when nitro is not initialized yet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubNuxt()

    updateRuntimeConfig({ example: { foo: 'bar' } })

    expect(warn).not.toHaveBeenCalled()
  })
})
