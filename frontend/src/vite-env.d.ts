/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_TOKEN?: string
  readonly VITE_POI_FALLBACK_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
