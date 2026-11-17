/** Redondea a 2 decimales eliminando el ruido de punto flotante (1.005 -> 1.01). */
export function redondear2(n: number): number {
  if (!isFinite(n)) return 0;
  const signo = n < 0 ? -1 : 1;
  // Se limpia el ruido de flotante también después de multiplicar por 100 (1.005 * 100 = 100.49999999999999).
  const centavos = Number((Math.abs(n) * 100).toPrecision(12));
  return (signo * Math.round(centavos)) / 100;
}

/** Monto de la guía = peso_kg × precio_por_kg, a 2 decimales. */
export function calcularMonto(pesoKg: number, precioPorKg: number): number {
  return redondear2(pesoKg * precioPorKg);
}

const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function fmtMXN(n: number | null | undefined): string {
  return fmt.format(redondear2(Number(n ?? 0)));
}

const fmtNum = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
export function fmtNum3(n: number | null | undefined): string {
  return fmtNum.format(Number(n ?? 0));
}

/** Acepta "12,5" o "12.5". Devuelve null si no es un número válido. */
export function parseNumero(s: string): number | null {
  const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}

/** Número con 2 decimales para CSV (sin símbolo de moneda). */
export function num2(n: number | null | undefined): string {
  return redondear2(Number(n ?? 0)).toFixed(2);
}
