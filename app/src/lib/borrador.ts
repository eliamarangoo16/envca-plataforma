/**
 * Borrador de la guía en captura (formulario + id). El id se conserva mientras la guía no esté confirmada,
 * así un reintento después de salir y volver usa el MISMO id y no puede duplicarse.
 * Va en sessionStorage (no en disco) y por usuario.
 */
export interface Borrador<F> { id: string; form: F; intentado: boolean }

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const clave = (uid: string) => `envca-guia-borrador:${uid}`;
function almacenPorDefecto(): Almacen | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

export function cargarBorrador<F>(uid: string, a: Almacen | null = almacenPorDefecto()): Borrador<F> | null {
  try {
    const t = a?.getItem(clave(uid));
    if (!t) return null;
    const b = JSON.parse(t) as Borrador<F>;
    return b && typeof b.id === 'string' && b.form && typeof b.form === 'object' ? { id: b.id, form: b.form, intentado: !!b.intentado } : null;
  } catch { return null; }
}

export function guardarBorrador<F>(uid: string, b: Borrador<F>, a: Almacen | null = almacenPorDefecto()): void {
  try { a?.setItem(clave(uid), JSON.stringify(b)); } catch { /* sin espacio o modo privado: se sigue sin borrador */ }
}

export function borrarBorrador(uid: string, a: Almacen | null = almacenPorDefecto()): void {
  try { a?.removeItem(clave(uid)); } catch { /* */ }
}
