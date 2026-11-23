/**
 * CAD調の明るさ計算。最終形状・建物で共通利用する（地形は下の地形用を使う）。
 *
 * 面ごとに一定の頂点法線を持つジオメトリでは、その法線をそのまま使う。位置の
 * スクリーン空間微分から法線を作ると、微分が2x2クアッド単位の値しか取れない
 * ため、表示スケールが整数でない（解像度スケール・ブラウザのズーム・DPR）
 * 環境では平坦面に網目状のモアレとして現れる。頂点法線が無い（未設定なら0に
 * なる）、または面内で補間されているジオメトリだけ微分で補う。
 */
export const CAD_LIGHTING_GLSL = `
// 面ごとに一定の頂点法線なら1、面内で補間されている（または法線が無い）なら0。
float cadUsesVertexNormal(vec3 normalEC)
{
    vec3 normalDeltaX = dFdx(normalEC);
    vec3 normalDeltaY = dFdy(normalEC);
    float normalSpread = dot(normalDeltaX, normalDeltaX) + dot(normalDeltaY, normalDeltaY);
    return length(normalEC) > 0.5 && normalSpread < 1e-6 ? 1.0 : 0.0;
}

float cadLightFactor(vec3 positionEC, vec3 normalEC)
{
    vec3 derivativeNormal = normalize(cross(dFdx(positionEC), dFdy(positionEC)));
    vec3 normal = cadUsesVertexNormal(normalEC) > 0.5
        ? normalEC / length(normalEC)
        : derivativeNormal;
    float light = max(dot(normal, normalize(czm_lightDirectionEC)), 0.0);
    return clamp(0.61 + 0.95 * light, 0.0, 1.0);
}
`

/**
 * 地形（高さ場メッシュ）と完成形状（印刷プレビュー）で共通の明るさ計算。
 *
 * 地形の頂点法線は面の中で補間されるため、そのまま使うと三角形の稜線が消えて
 * 全体がぼやける。CAD調にポリゴンの向きが読めるよう、位置のスクリーン空間微分から
 * 三角形ごとに一定な法線を作る。位置は視点相対座標（czm_modelViewRelativeToEye）
 * なので微分の値はカメラ距離のオーダーに収まり、ECEFの絶対座標のように
 * float精度で潰れて筋状ノイズになることはない。
 *
 * 建物用の式 (0.61 + 0.95 * light) は dot >= 0.41 で1に飽和する。起伏の大きい
 * 地形では日照面のほぼ全面が純白に飛んで起伏が読めなくなるため、太陽高度45°の
 * 平坦面（light = 0.707）が飽和しないレンジにする。
 */
export const FACET_LIGHT_BASE = 0.34
export const FACET_LIGHT_GAIN = 0.66

export const CAD_FACET_LIGHTING_GLSL = `
float cadFacetLightFactor(vec3 positionEC)
{
    vec3 normal = normalize(cross(dFdx(positionEC), dFdy(positionEC)));
    float light = max(dot(normal, normalize(czm_lightDirectionEC)), 0.0);
    return ${FACET_LIGHT_BASE.toFixed(2)} + ${FACET_LIGHT_GAIN.toFixed(2)} * light;
}
`

/** 太陽高度45°の平坦面での明るさ。1に張り付くと起伏が飛ぶ。 */
export const FLAT_FACET_LIGHT_FACTOR = FACET_LIGHT_BASE + FACET_LIGHT_GAIN * Math.SQRT1_2

export const CAD_TERRAIN_FRAGMENT_SHADER = `
in vec3 v_positionEC;
in vec4 v_color;

${CAD_FACET_LIGHTING_GLSL}

void main()
{
    out_FragColor = czm_gammaCorrect(vec4(v_color.rgb * cadFacetLightFactor(v_positionEC), v_color.a));
}
`

export const CAD_VERTEX_SHADER = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec4 color;
in float batchId;

out vec3 v_positionEC;
out vec3 v_cadNormalEC;
out vec4 v_color;

void main()
{
    vec4 p = czm_computePosition();

    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_cadNormalEC = czm_normal * normal;
    v_color = color;

    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`

export const CAD_FRAGMENT_SHADER = `
in vec3 v_positionEC;
in vec4 v_color;

${CAD_FACET_LIGHTING_GLSL}

void main()
{
    // 完成形状は地形と同じ面単位の陰影で描く。建物プレビュー用の式
    // (0.61 + 0.95 * light) は日照面が飽和し、地形が白飛びするため使わない。
    out_FragColor = czm_gammaCorrect(vec4(v_color.rgb * cadFacetLightFactor(v_positionEC), v_color.a));
}
`
