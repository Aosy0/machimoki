import type { Bounds, ExportOptions, ValidationResult } from '../types/api';

export async function exportModel(
  bounds: Bounds,
  options: ExportOptions
): Promise<void> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bounds, ...options }),
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `model.${options.format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function validateModel(file: File): Promise<ValidationResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/validate', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
