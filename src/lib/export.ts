function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Minimal CSV download — quoting the way the legacy exporter did. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const cell = (value: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
  download(filename, new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
}

export function downloadJson(filename: string, json: string): void {
  download(filename, new Blob([json], { type: 'application/json' }));
}

export function datedFilename(prefix: string): string {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
}
