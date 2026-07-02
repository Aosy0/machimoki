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
}

export interface PipelineProgress {
  phase: PipelinePhase
  progress: number
  detail?: string
}
