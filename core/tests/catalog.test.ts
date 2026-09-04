import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

describe('catalog', () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolveMuniCode returns muniCd from GSI reverse geocoder', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: { muniCd: '13101', lv01Nm: '千代田区' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { resolveMuniCode } = await import('../src/catalog');
    const result = await resolveMuniCode(35.6895, 139.6917);

    expect(result).toBe('13101');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=35.6895&lon=139.6917',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('resolveMuniCode throws when muniCd is missing', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: { lv01Nm: '千代田区' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { resolveMuniCode } = await import('../src/catalog');
    await expect(resolveMuniCode(35.6895, 139.6917)).rejects.toThrow('市区町村コード');
  });

  it('resolveMuniCode throws on HTTP error', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('error', { status: 500 }));

    const { resolveMuniCode } = await import('../src/catalog');
    await expect(resolveMuniCode(35.6895, 139.6917)).rejects.toThrow('逆ジオコーディング失敗');
  });

  it('resolveMuniCode aborts the fetch signal and throws a timeout error', async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchSpy.mockImplementationOnce((_input, init) => {
      capturedSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        });
      });
    });

    const { resolveMuniCode } = await import('../src/catalog');
    const promise = resolveMuniCode(35.6895, 139.6917, 50);

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    await expect(promise).rejects.toThrow('逆ジオコーディングがタイムアウト');
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('findTilesetUrl returns the URL for a matching dataset', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          datasets: [
            {
              id: '1',
              name: '東京都千代田区建築物モデル',
              pref: '東京都',
              pref_code: '13',
              city: '千代田区',
              city_code: '13101',
              ward: null,
              ward_code: null,
              type: '建築物モデル',
              type_en: 'building',
              url: 'https://example.com/tileset.json',
              format: '3D Tiles',
              lod: '1',
              texture: false,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { findTilesetUrl } = await import('../src/catalog');
    const url = await findTilesetUrl('13101', 'lod1');

    expect(url).toBe('https://example.com/tileset.json');
  });

  it('findTilesetUrl memoizes catalog datasets', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          datasets: [
            {
              id: '1',
              name: '東京都千代田区建築物モデル',
              pref: '東京都',
              pref_code: '13',
              city: '千代田区',
              city_code: '13101',
              ward: null,
              ward_code: null,
              type: '建築物モデル',
              type_en: 'building',
              url: 'https://example.com/tileset.json',
              format: '3D Tiles',
              lod: '1',
              texture: false,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { findTilesetUrl } = await import('../src/catalog');
    await findTilesetUrl('13101', 'lod1');
    await findTilesetUrl('13101', 'lod1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('findTilesetUrl throws when no matching dataset', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ datasets: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { findTilesetUrl } = await import('../src/catalog');
    await expect(findTilesetUrl('99999', 'lod1')).rejects.toThrow(
      '該当する3D Tilesデータセットが見つかりません',
    );
  });

  it('resolveMuniCodes returns unique codes from 5 sample points across municipalities', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: { muniCd: '13101', lv01Nm: '千代田区' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: { muniCd: '13102', lv01Nm: '中央区' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: { muniCd: '13101', lv01Nm: '千代田区' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: { muniCd: '13102', lv01Nm: '中央区' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: { muniCd: '13102', lv01Nm: '中央区' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const { resolveMuniCodes } = await import('../src/catalog');
    const result = await resolveMuniCodes({
      west: 139.6903,
      south: 35.6997,
      east: 139.6906,
      north: 35.7000,
    });

    expect(result).toEqual(['13101', '13102']);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('resolveMuniCodes returns codes from successful points even when some fail', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: { muniCd: '13102', lv01Nm: '中央区' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: { muniCd: '13102', lv01Nm: '中央区' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: { muniCd: '13101', lv01Nm: '千代田区' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const { resolveMuniCodes } = await import('../src/catalog');
    const result = await resolveMuniCodes({
      west: 139.6903,
      south: 35.6997,
      east: 139.6906,
      north: 35.7000,
    });

    expect(result).toEqual(['13102', '13101']);
  });

  it('normalizeN03Code pads codes to 5 digits', async () => {
    const { normalizeN03Code } = await import('../src/catalog');
    expect(normalizeN03Code(13101)).toBe('13101');
    expect(normalizeN03Code(1101)).toBe('01101');
    expect(normalizeN03Code('13103')).toBe('13103');
    expect(normalizeN03Code('abc')).toBeNull();
    expect(normalizeN03Code(123456)).toBeNull();
  });

  it('featureContainsPoint detects points in polygons with holes', async () => {
    const { featureContainsPoint } = await import('../src/catalog');
    const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ];
    const withHole = {
      properties: { N03_007: '13101' },
      geometry: { type: 'Polygon', coordinates: [square(0, 0, 10, 10), square(3, 3, 5, 5)] },
    };
    expect(featureContainsPoint(1, 1, withHole)).toBe(true);
    expect(featureContainsPoint(4, 4, withHole)).toBe(false);
    expect(featureContainsPoint(20, 20, withHole)).toBe(false);
    const multi = {
      properties: { N03_007: '13102' },
      geometry: { type: 'MultiPolygon', coordinates: [[square(20, 20, 30, 30)]] },
    };
    expect(featureContainsPoint(25, 25, multi)).toBe(true);
    expect(featureContainsPoint(1, 1, multi)).toBe(false);
  });

  it('resolveMuniCodes falls back to N03 lookup when GSI fails', async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error('gsi down 1'))
      .mockRejectedValueOnce(new Error('gsi down 2'))
      .mockRejectedValueOnce(new Error('gsi down 3'))
      .mockRejectedValueOnce(new Error('gsi down 4'))
      .mockRejectedValueOnce(new Error('gsi down 5'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                properties: { N03_007: '13108' },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [139.7, 35.7],
                      [139.8, 35.7],
                      [139.8, 35.73],
                      [139.7, 35.73],
                      [139.7, 35.7],
                    ],
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const { resolveMuniCodes } = await import('../src/catalog');
    const result = await resolveMuniCodes({
      west: 139.7756,
      south: 35.7057,
      east: 139.7948,
      north: 35.7221,
    });

    expect(result).toEqual(['13108']);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('resolveMuniCodes throws when all points fail', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('error', { status: 500 }));

    const { resolveMuniCodes } = await import('../src/catalog');
    await expect(
      resolveMuniCodes({
        west: 139.6903,
        south: 35.6997,
        east: 139.6906,
        north: 35.7000,
      }),
    ).rejects.toThrow('選択範囲の自治体コードが取得できません');
  });

  it('findTilesetUrl prefers texture:false over texture:true', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          datasets: [
            {
              id: '1',
              name: '東京都千代田区建築物モデル',
              pref: '東京都',
              pref_code: '13',
              city: '千代田区',
              city_code: '13101',
              ward: null,
              ward_code: null,
              type: '建築物モデル',
              type_en: 'building',
              url: 'https://example.com/tileset-textured.json',
              format: '3D Tiles',
              lod: '2',
              texture: true,
            },
            {
              id: '2',
              name: '東京都千代田区建築物モデル',
              pref: '東京都',
              pref_code: '13',
              city: '千代田区',
              city_code: '13101',
              ward: null,
              ward_code: null,
              type: '建築物モデル',
              type_en: 'building',
              url: 'https://example.com/tileset-notextured.json',
              format: '3D Tiles',
              lod: '2',
              texture: false,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { findTilesetUrl } = await import('../src/catalog');
    const url = await findTilesetUrl('13101', 'lod2');

    expect(url).toBe('https://example.com/tileset-notextured.json');
  });

  it('findTilesetUrl falls back to texture:true for lod3 when texture:false is absent', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          datasets: [
            {
              id: '1',
              name: '東京都港区建築物モデル LOD3',
              pref: '東京都',
              pref_code: '13',
              city: '港区',
              city_code: '13103',
              ward: null,
              ward_code: null,
              type: '建築物モデル',
              type_en: 'building',
              url: 'https://example.com/tileset-lod3.json',
              format: '3D Tiles',
              lod: '3',
              texture: true,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { findTilesetUrl } = await import('../src/catalog');
    const url = await findTilesetUrl('13103', 'lod3');

    expect(url).toBe('https://example.com/tileset-lod3.json');
  });
});
