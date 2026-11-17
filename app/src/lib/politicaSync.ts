/** Cuándo bajar los catálogos completos (el envío de pendientes es aparte y puede intentarse seguido). */
export const CATALOGOS_CADA_MS = 10 * 60_000;
export const CATALOGOS_REINTENTO_MS = 60_000;

export interface EstadoCatalogos {
  /** Última descarga completa exitosa (ms epoch); 0 = nunca en esta apertura. */
  ultimoOk: number;
  /** Último intento (ms epoch), exitoso o no. */
  ultimoIntento: number;
  /** Abrir la app o volver la red: bajar ya. */
  forzar: boolean;
}

export function debeRefrescarCatalogos(ahora: number, e: EstadoCatalogos): boolean {
  if (e.forzar) return true;
  if (e.ultimoOk && ahora - e.ultimoOk < CATALOGOS_CADA_MS) return false;
  // Tras un fallo no se insiste cada 30 s.
  if (e.ultimoIntento && e.ultimoIntento > e.ultimoOk && ahora - e.ultimoIntento < CATALOGOS_REINTENTO_MS) return false;
  return true;
}
