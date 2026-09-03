/// <reference path="../worker-configuration.d.ts" />
import { describe, it, expect, vi } from 'vitest'
import app from '../src/index.js'

type MockR2Object = {
  key: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

function makeBucket(objects: Record<string, ArrayBuffer>) {
  return {
    get: vi.fn(async (key: string): Promise<MockR2Object | null> => {
      const data = objects[key]
      if (!data) return null
      return { key, arrayBuffer: async () => data }
    }),
  }
}

function makeEnv(bucket: ReturnType<typeof makeBucket>): Env {
  return {
    KV: {} as KVNamespace,
    ORIGIN_URL: '',
    COVERAGE_BUCKET: bucket as unknown as R2Bucket,
  }
}

const coverageJson = JSON.stringify({
  '13101': {
    muniCode: '13101',
    name: '千代田区',
    prefecture: '東京都',
    covered: true,
    lods: [1],
  },
})

const tilePbf = new Uint8Array([0x1a, 0x03, 0x08, 0x01, 0x10, 0x02]).buffer

describe('GET /api/coverage', () => {
  it('R2 の coverage.json を JSON で返し Cache-Control を付与する', async () => {
    const bucket = makeBucket({
      'coverage.json': new TextEncoder().encode(coverageJson).buffer,
    })
    const res = await app.request('/api/coverage', {}, makeEnv(bucket))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400')
    expect(await res.json()).toEqual(JSON.parse(coverageJson))
  })

  it('coverage.json が存在しない場合は 404 を返す', async () => {
    const bucket = makeBucket({})
    const res = await app.request('/api/coverage', {}, makeEnv(bucket))

    expect(res.status).toBe(404)
  })
})

describe('GET /api/coverage/tiles/:z/:x/:y', () => {
  it('R2 の MVT タイルを返し Cache-Control を付与する', async () => {
    const bucket = makeBucket({ 'tiles/4/5/6.pbf': tilePbf })
    const res = await app.request('/api/coverage/tiles/4/5/6', {}, makeEnv(bucket))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/vnd.mapbox-vector-tile')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400')
    expect(res.headers.get('Content-Encoding')).toBe('gzip')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(tilePbf))
  })

  it('タイルが存在しない場合は 404 を返す', async () => {
    const bucket = makeBucket({})
    const res = await app.request('/api/coverage/tiles/4/5/6', {}, makeEnv(bucket))

    expect(res.status).toBe(404)
  })

  it('数値以外のパスは 400 を返す', async () => {
    const bucket = makeBucket({})
    const res = await app.request('/api/coverage/tiles/abc/5/6', {}, makeEnv(bucket))

    expect(res.status).toBe(400)
  })
})