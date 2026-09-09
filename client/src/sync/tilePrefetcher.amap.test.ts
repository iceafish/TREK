/**
 * The AMap-mode guard inside the tile prefetcher itself — the tripSyncManager
 * entry gate (FE-COMP set in tripSyncManager.prepare.test.ts) is the first
 * line; this is the defensive second line, plus the SyncMeta cleanup
 * (docs/amap/05: AMap's terms forbid storing its service data).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prefetchTilesForTrip } from './tilePrefetcher'
import { useSettingsStore } from '../store/settingsStore'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    // Rest signatures: the wrappers below forward a spread unknown[] and a
    // zero-arg vi.fn() tuple would refuse it.
    upsertSyncMeta: vi.fn(async (..._a: unknown[]) => {}),
    syncMetaGet: vi.fn(async (..._a: unknown[]) => undefined),
  },
}))

vi.mock('../db/offlineDb', () => ({
  offlineDb: { syncMeta: { get: (...a: unknown[]) => mocks.syncMetaGet(...a) } },
  upsertSyncMeta: (...a: unknown[]) => mocks.upsertSyncMeta(...a),
}))

vi.mock('./glPrefetcher', () => ({
  prefetchVectorForPlaces: vi.fn(async () => ({ tiles: 0 })),
  clearVectorCache: vi.fn(),
}))

vi.mock('./authGate', () => ({ isAuthed: () => true }))

function setProvider(provider: string | undefined) {
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, map_provider: provider as never },
  })
}

const tripId = 42
const places = [
  { id: 1, trip_id: tripId, lat: 39.9087, lng: 116.3912 },
  { id: 2, trip_id: tripId, lat: 39.9163, lng: 116.3972 },
] as never

describe('prefetchTilesForTrip — AMap guard (docs/amap/05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setProvider('amap')
  })

  it('AMAP-PREF-001: does not fetch tiles when the provider is amap', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await prefetchTilesForTrip(tripId, places)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('AMAP-PREF-002: clears a recorded tilesBbox so the offline UI stops claiming tiles', async () => {
    mocks.syncMetaGet.mockResolvedValue({ tripId, tilesBbox: [116, 39, 117, 40] })
    await prefetchTilesForTrip(tripId, places)
    expect(mocks.upsertSyncMeta).toHaveBeenCalledWith(
      expect.objectContaining({ tripId, tilesBbox: null }),
    )
  })

  it('AMAP-PREF-003: a trip with no SyncMeta row is left alone', async () => {
    mocks.syncMetaGet.mockResolvedValue(undefined)
    await prefetchTilesForTrip(tripId, places)
    expect(mocks.upsertSyncMeta).not.toHaveBeenCalled()
  })

  it('AMAP-PREF-004: a non-amap provider still records its tilesBbox (guard is amap-scoped)', async () => {
    mocks.syncMetaGet.mockResolvedValue({ tripId, tilesBbox: null })
    setProvider('mapbox-gl')
    // No serviceWorker in jsdom → prefetchTiles returns 0 after bookkeeping,
    // but the trip's bbox still gets recorded: only the AMap path skips outright.
    await prefetchTilesForTrip(tripId, places)
    expect(mocks.upsertSyncMeta).toHaveBeenCalledWith(
      expect.objectContaining({ tripId, tilesBbox: expect.any(Array) }),
    )
  })
})
