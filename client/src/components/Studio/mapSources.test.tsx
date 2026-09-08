import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { resetAllStores } from '../../../tests/helpers/store'
import { useSettingsStore } from '../../store/settingsStore'
import { useMapSources } from './mapSources'

const frame = {} as import('@trek/shared').BookFrame
const points = [{ lat: 48.85, lng: 2.35 }]

function setProvider(provider: string | undefined) {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, map_provider: provider as never } })
}

describe('useMapSources — AMap mode (docs/amap/05)', () => {
  beforeEach(() => {
    resetAllStores()
  })

  it('offers relief and satellite alongside vector for non-AMap providers', () => {
    setProvider('mapbox-gl')
    const { result } = renderHook(() => useMapSources(frame, points))
    const ids = result.current.map(o => o.id)
    expect(ids).toContain('relief')
    expect(ids).toContain('satellite')
  })

  it('falls back to the vector outline only when the provider is amap', () => {
    setProvider('amap')
    const { result } = renderHook(() => useMapSources(frame, points))
    const ids = result.current.map(o => o.id)
    expect(ids).toEqual(['vector'])
  })

  it('keeps an already-placed TILES element reachable in amap mode (removal must not remove a page)', () => {
    setProvider('amap')
    const current = { source: 'tiles', tileUrl: 'https://example.com/{z}/{x}/{y}.png' }
    const { result } = renderHook(() => useMapSources(frame, points, current))
    const ids = result.current.map(o => o.id)
    // Vector is the offered fallback; the placed element's own source stays listed.
    expect(ids).toEqual(['vector', 'tiles'])
    expect(result.current[1].url).toBe(current.tileUrl)
  })
})
