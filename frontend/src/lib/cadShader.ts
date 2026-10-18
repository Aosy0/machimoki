/**
 * CAD調のフラットシェーディング用シェーダー。
 *
 * 面法線をスクリーン空間の微分から求め、環境光0.61＋直射光で陰影を付ける。
 * 地形プレビュー(solidTerrain)と最終形状プレビューで共通利用する。
 * 既定のPBRライティングだと白模型の上面が白飛びし、スムーズ法線だと
 * 壁面に不要なハイライトが出るため、この質感に統一する。
 */
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

void main()
{
    // Flat normal from screen-space derivatives — CAD-style per-face shading
    vec3 flatNormal = normalize(cross(dFdx(v_positionEC), dFdy(v_positionEC)));

    // 建物と同じ光源方向で照らす。明るさバランスは建物(フラットな環境光≈0.61 +
    // 直射光)に合わせ、影側の面でも建物の環境光面と同じ明度(≈156/255)になるようにする。
    float light = max(dot(flatNormal, normalize(czm_lightDirectionEC)), 0.0);
    float lightFactor = clamp(0.61 + 0.95 * light, 0.0, 1.0);

    out_FragColor = czm_gammaCorrect(vec4(v_color.rgb * lightFactor, v_color.a));
}
`
