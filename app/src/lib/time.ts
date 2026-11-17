/** Todo el negocio opera en hora de la Ciudad de México. */
export const TZ = 'America/Mexico_City';

function partes(d: Date): Record<string, string> {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** Fecha local de México (YYYY-MM-DD) de un instante. */
export function fechaMX(d: Date = new Date()): string {
  const p = partes(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hora local de México sin zona (YYYY-MM-DDTHH:mm:ss) para columnas `timestamp`. */
export function timestampMX(d: Date = new Date()): string {
  const p = partes(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export function sumarDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sábado, de una fecha YYYY-MM-DD. */
export function diaSemana(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "mar 4 nov 2026" a partir de YYYY-MM-DD. */
export function fechaLarga(fecha: string | null | undefined): string {
  if (!fecha) return '';
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number);
  if (!y) return String(fecha);
  return `${DIAS[diaSemana(fecha.slice(0, 10))].slice(0, 3).toLowerCase()} ${d} ${MESES[m - 1]} ${y}`;
}

/** Fecha y hora local de México de un instante ISO (con zona). */
export function fechaHoraMX(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = partes(d);
  return `${Number(p.day)} ${MESES[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

/** Fecha/hora de una columna `timestamp` sin zona (ya está en hora local). */
export function fechaHoraLocal(ts: string | null | undefined): string {
  if (!ts) return '';
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return ts;
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}`;
}

/** Fecha de México (YYYY-MM-DD) de un instante ISO con zona. */
export function fechaMXdeISO(iso: string): string {
  return fechaMX(new Date(iso));
}

/** Próxima salida aérea (martes o jueves), contando hoy si aún es martes/jueves. */
export function proximoEnvio(desde: string = fechaMX()): string {
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(desde, i);
    const dw = diaSemana(f);
    if (dw === 2 || dw === 4) return f;
  }
  return desde;
}
