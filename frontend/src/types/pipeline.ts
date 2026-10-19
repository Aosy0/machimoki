export type PipelinePhase =
  | 'idle'
  | 'identifying'
  | 'acquiring'
  | 'composing'
  | 'cropping'
  | 'displaying'
  | 'complete'
  | 'error'

export interface PipelineState {
  phase: PipelinePhase
  progress: number
  message: string
  error: string | null
  /**
   * バックグラウンド更新（パラメータ変更による最終形状の自動再生成）。
   * true のとき App は画面を覆うローディングを出さず、隅の小さな表示にとどめる。
   */
  background?: boolean
}

export interface PipelineProgress {
  phase: PipelinePhase
  progress: number
  detail?: string
}
