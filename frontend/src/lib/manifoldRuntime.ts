// メインスレッドで manifold を使うための WASM URL 設定（副作用インポート）。
// 未設定のままだと WASM 取得先が SPA フォールバックの HTML になり、
// WebAssembly.instantiate が magic word エラーで失敗する
// （断面表示 sectionMesh などが無言で機能しなくなる）。
import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'

setWasmUrl(wasmUrl)
