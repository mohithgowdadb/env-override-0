import process from 'node:process'
import { snakeCase } from 'scule'
import { klona } from 'klona'
import type { NitroConfig } from '@nuxt/schema'

import { defu } from 'defu'
import { useNuxt } from './context.ts'
import { tryUseNitro } from './nitro.ts'
import { convertEnvValue, inferSupportedType } from './internal/env-types.ts'

/**
 * Access 'resolved' Nuxt runtime configuration, with values updated from environment.
 *
 * This mirrors the runtime behavior of Nitro.
 */
export function useRuntimeConfig (): Record<string, any> {
  const nuxt = useNuxt()
  return applyEnv(klona((nuxt.options.nitro as NitroConfig).runtimeConfig!), {
    prefix: 'NITRO_',
    altPrefix: 'NUXT_',
    envExpansion: nuxt.options.nitro.experimental?.envExpansion ?? !!process.env.NITRO_ENV_EXPANSION,
    envTypes: (nuxt.options.experimental?.runtimeConfigEnvTypes ?? nuxt.options.nitro?.experimental?.runtimeConfigEnvTypes) !== false,
    dev: nuxt.options.dev,
  })
}

/**
 * Update Nuxt runtime configuration.
 */
export function updateRuntimeConfig (runtimeConfig: Record<string, unknown>): void | Promise<void> {
  const nuxt = useNuxt()
  const nitroConfig: NitroConfig = nuxt.options.nitro
  Object.assign(nitroConfig.runtimeConfig as Record<string, unknown>, defu(runtimeConfig, nitroConfig.runtimeConfig))

  const nitro = tryUseNitro()
  if (!nitro) {
    return
  }
  return nitro.updateConfig({
    // nitro coerces `undefined` to `''`, which would shadow derived keys such as `nitro.envExpansion`
    runtimeConfig: withoutUndefined(defu(runtimeConfig, nitro.options.runtimeConfig)) as any,
    // TODO: drop once `nitro.updateConfig({ runtimeConfig })` stops resetting `runtimeConfig.nitro.routeRules` from `config.routeRules`
    routeRules: (nitro.options as Record<string, any>).routeRules,
  })
}

function withoutUndefined<T> (value: T): T {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return value
  }
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      result[key] = withoutUndefined(child)
    }
  }
  return result as T
}

/**
 * https://github.com/nitrojs/nitro/blob/v2/src/runtime/internal/utils.env.ts.
*
 * These utils will be replaced by util exposed from nitropack. See https://github.com/nitrojs/nitro/pull/2404
 * for more context and future plans.)
 *
 * @internal
 */

type EnvOptions = {
  prefix?: string
  altPrefix?: string
  envExpansion?: boolean
  envTypes?: boolean
  dev?: boolean
}

function getRawEnv (key: string, opts: EnvOptions, env = process.env) {
  const envKey = snakeCase(key).toUpperCase()
  return env[opts.prefix + envKey] ?? env[opts.altPrefix + envKey]
}

function _isObject (input: unknown) {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function applyEnv (
  obj: Record<string, any>,
  opts: EnvOptions,
  parentKey = '',
) {
  for (const key in obj) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }

    const subKey = parentKey ? `${parentKey}_${key}` : key
    const rawEnvValue = getRawEnv(subKey, opts)
    const defaultValue = obj[key]

    if (_isObject(defaultValue)) {
      if (rawEnvValue === undefined) {
        applyEnv(defaultValue, opts, subKey)
      } else {
        obj[key] = rawEnvValue
      }
    } else if (rawEnvValue !== undefined) {
      if (opts.envTypes) {
        const expectedType = inferSupportedType(defaultValue)
        obj[key] = convertEnvValue(rawEnvValue, expectedType, {
          key: subKey,
          dev: opts.dev,
        })
      } else {
        // Flag OFF: raw string (Nitro 3 behavior)
        obj[key] = rawEnvValue
      }
    }

    // Experimental env expansion
    if (opts.envExpansion && typeof obj[key] === 'string') {
      obj[key] = _expandFromEnv(obj[key])
    }
  }
  return obj
}

const envExpandRx = /\{\{([^{}]*)\}\}/g

function _expandFromEnv (value: string, env: Record<string, any> = process.env) {
  return value.replace(envExpandRx, (match, key) => {
    return env[key] || match
  })
}
