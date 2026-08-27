import type { Bounds, ExportFormat, ExportOptions, ValidationResult } from '../types/api';

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch {
    // not JSON — fall through to raw text
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : `HTTP ${res.status}`;
}

export async function exportModel(
  bounds: Bounds,
  options: ExportOptions
): Promise<void> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bounds, ...options }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadFilename(res, options.format);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadFilename(res: Response, format: ExportFormat): string {
  const disposition = res.headers.get('Content-Disposition');
  const match = disposition?.match(/filename="?([^";]+)"?/);
  if (match) return match[1];
  return `model.${format}`;
}

export async function validateModel(file: File): Promise<ValidationResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/validate', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}
