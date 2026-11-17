/**
 * Clasificación de errores de Supabase/PostgREST.
 *  - network:   sin señal / fetch falló. Se reintenta; el registro NO se pierde.
 *  - auth:      sesión vencida (401). Se reintenta tras refrescar sesión.
 *  - transient: 5xx / 408 / 429. Se reintenta más tarde.
 *  - permanent: error de datos o permisos (4xx). Se marca y no bloquea a los demás.
 */
export type ClaseError = 'network' | 'auth' | 'transient' | 'permanent';

export interface ErrorRemoto {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
  name?: string;
}


/** Código propio: la actualización no tocó ninguna fila (RLS filtra en silencio o el registro ya no existe). */
export const COD_SIN_FILAS = 'ENVCA_SIN_FILAS';

export const MSG_VENTANA_EDICION = 'Solo puedes corregir registros de hoy y de ayer; pide el cambio a un administrador.';

export const MSG_CONTEO_RECHAZADO =
  'El servidor rechazó este conteo. Los ruteros no pueden registrar una fecha posterior a mañana ni de hace más de 30 días ' +
  '(revisa la fecha del teléfono); también puede ser un problema de permisos de tu cuenta. ' +
  'Descártalo y captúralo de nuevo con la fecha correcta, o avisa a un administrador.';

/** true si el error es un conflicto de llave primaria sobre `id` (no cualquier 23505, p. ej. folio duplicado). */
export function esConflictoId(e: ErrorRemoto | null | undefined): boolean {
  if (!e || e.code !== '23505') return false;
  const t = `${e.message ?? ''} ${e.details ?? ''}`;
  return /_pkey\b/.test(t) || /\(id\)=/.test(t);
}

export function clasificarError(e: ErrorRemoto | null | undefined, status?: number): ClaseError {
  if (!e) return 'permanent';
  // Sin status explícito: un código SQL/PostgREST implica que el servidor respondió (dato); sin código, no hubo respuesta.
  const st = status ?? e.status ?? (e.code && !/^E[A-Z]+$/.test(e.code) ? 400 : 0);
  const msg = `${e.name ?? ''} ${e.message ?? ''}`;
  if (e.name === 'AuthRetryableFetchError') return 'network';
  // Sin respuesta HTTP (status 0): red caída o fallo de fetch. Nunca se trata como error de datos.
  if (st === 0) return 'network';
  if (st === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt expired/i.test(msg)) return 'auth';
  if (st === 408 || st === 429 || st >= 500) return 'transient';
  return 'permanent';
}

/** Mensaje en español para mostrar al usuario. */
export function mensajeError(e: ErrorRemoto | null | undefined, status?: number): string {
  if (!e) return 'Ocurrió un error desconocido.';
  const clase = clasificarError(e, status);
  if (clase === 'network') return 'Sin conexión con el servidor. Revisa tu señal e inténtalo de nuevo.';
  if (clase === 'auth') return 'Tu sesión venció. Vuelve a iniciar sesión.';
  if (clase === 'transient') return 'El servidor no pudo atender la solicitud en este momento. Inténtalo más tarde.';
  switch (e.code) {
    case COD_SIN_FILAS: return `No se actualizó ningún registro: ya no existe o no tienes permiso para cambiarlo. ${MSG_VENTANA_EDICION}`;
    case '42501':
      // Los mensajes que escribe la propia base (triggers) se muestran tal cual; el texto genérico de RLS no ayuda.
      if (e.message && !/row-level security|permission denied|violates row/i.test(e.message)) return e.message;
      return 'No tienes permiso para realizar esta acción.';
    case '23503': return 'El registro depende de un dato que no existe o que aún está en uso (ruta, localidad o tarifa).';
    case '23505': return 'Ya existe un registro con esos datos.';
    case '23514': return 'Algún dato está fuera del rango permitido.';
    case '23502': return 'Falta un dato obligatorio.';
    case '22P02': case '22007': case '22003': return 'Algún dato tiene un formato no válido.';
    case '42703': case '42P01': case 'PGRST204': case 'PGRST205':
      return 'La base de datos aún no está actualizada para esta función. Avisa a un administrador.';
    case 'PGRST116': return 'No se encontró el registro (o no tienes permiso para verlo).';
  }
  return e.message ? `No se pudo completar: ${e.message}` : 'No se pudo completar la operación.';
}

/** Convierte una excepción cualquiera (fetch rechazado, etc.) a ErrorRemoto con status 0. */
export function desdeExcepcion(x: unknown): ErrorRemoto {
  const e = x as { message?: string; name?: string } | undefined;
  return { message: e?.message ?? String(x), name: e?.name, status: 0, code: '' };
}
