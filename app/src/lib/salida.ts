import { contarOutbox } from './outbox';
import { conTope } from './tiempo';

export interface RestoBandeja { total: number; pendientes: number; errores: number }

/**
 * Antes de cerrar sesión: si hay registros en la bandeja, intenta enviarlos (`enviar` ya verifica si hay red).
 * Devuelve lo que QUEDA. Nunca borra nada de la bandeja.
 */
export async function vaciarAntesDeSalir(userId: string, enviar: () => Promise<unknown>, topeMs = 45_000): Promise<RestoBandeja> {
  const antes = await contarOutbox(userId);
  if (antes.total === 0) return { total: 0, pendientes: 0, errores: 0 };
  try { await conTope(Promise.resolve().then(enviar), topeMs, () => undefined); } catch { /* sin red u otro fallo: se cuenta lo que quedó */ }
  const c = await contarOutbox(userId);
  return { total: c.total, pendientes: c.pendientes, errores: c.errores };
}

export function textoRestantes(r: RestoBandeja): string {
  const n = r.total;
  const base = `${n} registro${n === 1 ? '' : 's'}`;
  return r.errores > 0 ? `${base} (${r.errores} con error)` : base;
}
