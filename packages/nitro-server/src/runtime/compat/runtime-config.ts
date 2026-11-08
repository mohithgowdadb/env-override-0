import { klona } from 'klona'
import { useRuntimeConfig as useNuxtRuntimeConfig } from '../runtime-config.ts'
import type { H3Event } from 'nitro/h3'

/**
 * v2 `useRuntimeConfig`, which accepted an event and returned a per-request
 * copy of the runtime config cached on `event.context.nitro.runtimeConfig`.
 * Nitro v3 exposes a single shared, env-applied object; without an event this
 * defers to it directly.
 */
export function useRuntimeConfig(event?: H3Event): Record<string, any> {
  const shared = useNuxtRuntimeConfig() as Record<string, any>
  if (!event) {
    return shared
  }
  const context = ((event.context as Record<string, any>).nitro ||= {})
  return (context.runtimeConfig ||= klona(shared))
}