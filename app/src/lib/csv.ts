/** Exportación CSV compatible con Excel (BOM UTF-8, CRLF, comillas escapadas). */
export interface Columna<T> { titulo: string; valor: (fila: T) => string | number | boolean | null | undefined }

function celda(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Evita inyección de fórmulas al abrir en Excel.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function aCSV<T>(filas: T[], columnas: Columna<T>[]): string {
  const enc = columnas.map((c) => celda(c.titulo)).join(',');
  const cuerpo = filas.map((f) => columnas.map((c) => celda(c.valor(f))).join(','));
  return '﻿' + [enc, ...cuerpo].join('\r\n') + '\r\n';
}

export function descargarCSV(nombre: string, texto: string): void {
  const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre.endsWith('.csv') ? nombre : nombre + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
