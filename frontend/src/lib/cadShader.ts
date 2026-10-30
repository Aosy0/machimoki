/**
 * CAD調の明るさ計算。地形・最終形状・建物で共通利用する。
 *
 * 面法線をスクリーン空間の微分から求め、環境光0.61＋直射光で陰影を付ける。
 * positionEC は視線座標系の位置。
 */
export const CAD_LIGHTING_GLSL = `
float cadLightFactor(vec3 positionEC)
{
    vec3 flatNormal = normalize(cross(dFdx(positionEC), dFdy(positionEC)));
    float light = max(dot(flatNormal, normalize(czm_lightDirectionEC)), 0.0);
    return clamp(0.61 + 0.95 * light, 0.0, 1.0);
}
`

export const CAD_VERTEX_SHADER = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec4 color;
in float batchId;

out vec3 v_positionEC;
out vec4 v_color;

void main()
{
    vec4 p = czm_computePosition();

    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_color = color;

    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`

export const CAD_FRAGMENT_SHADER = `
in vec3 v_positionEC;
in vec4 v_color;

${CAD_LIGHTING_GLSL}

void main()
{
    // 地形・最終形状・建物で同じ明るさ式を使う（建物はカスタムシェーダーから利用）。
    float lightFactor = cadLightFactor(v_positionEC);

    out_FragColor = czm_gammaCorrect(vec4(v_color.rgb * lightFactor, v_color.a));
}
`
