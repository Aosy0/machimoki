interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  testId?: string
  /** ラベルをスイッチの左（行頭）に置くか、右に置くか。 */
  labelFirst?: boolean
  /** 押せない理由などを書いた注記の id。読み上げ時にラベルへ続けて読ませる。 */
  describedBy?: string
}

/**
 * ネイティブの checkbox に switch 属性を付けたスイッチ。見た目は CSS が担う。
 * switch 属性は Safari のみ対応なので、role と appearance:none の装飾で全ブラウザ同じ形にする。
 */
export default function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  testId,
  labelFirst = false,
  describedBy,
}: SwitchProps) {
  const text = <span className="ui-switch__label">{label}</span>
  const input = (
    <input
      type="checkbox"
      className="ui-switch__input"
      role="switch"
      checked={checked}
      disabled={disabled}
      aria-describedby={describedBy}
      data-testid={testId}
      onChange={(e) => onChange(e.target.checked)}
      {...({ switch: '' } as Record<string, string>)}
    />
  )

  return (
    <label className={labelFirst ? 'ui-switch ui-switch--label-first' : 'ui-switch'}>
      {labelFirst ? (
        <>
          {text}
          {input}
        </>
      ) : (
        <>
          {input}
          {text}
        </>
      )}
    </label>
  )
}
