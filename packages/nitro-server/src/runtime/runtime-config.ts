import { useRuntimeConfig as useNitroRuntimeConfig } from 'nitro/runtime-config'
import type { NitroRuntimeConfig } from 'nitro/types'
// @ts-expect-error virtual module
import * as nitroConfig from '#internal/nuxt/nitro-config.mjs'
import { applyRuntimeConfigEnvTypes } from './utils/env-types.ts'

let _cachedConfig: NitroRuntimeConfig | undefined

export function useRuntimeConfig (): NitroRuntimeConfig {
  if (_cachedConfig) {
    return _cachedConfig
  }

  const config = useNitroRuntimeConfig()
  const enabled = nitroConfig?.NUXT_RUNTIME_CONFIG_ENV_TYPES
  const types = nitroConfig?.NUXT_RUNTIME_CONFIG_TYPES
  const isDev = nitroConfig?.NUXT_DEV ?? Boolean(import.meta.dev)
  if (enabled && types) {
    applyRuntimeConfigEnvTypes(config as Record<string, any>, types, {
      dev: isDev,
    })
  }

  return (_cachedConfig = config)
}

/** Reset cached config (used in tests) */
export function _resetRuntimeConfigCache (): void {
  _cachedConfig = undefined
}
