/** Topes de tiempo: nada de la sincronización puede quedarse colgado para siempre. */

export const TOPE_PETICION_MS = 15_000;

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Envuelve fetch con un tiempo máximo por petición. Al vencer se aborta y se lanza un TypeError
 * ("Failed to fetch"), que supabase-js/PostgREST devuelven como error de red (status 0): el registro
 * se queda pendiente y se reintenta. Si el llamador aborta con su propia señal, se respeta ese error.
 */
export function fetchConTope(base: Fetch = (i, n) => globalThis.fetch(i, n), ms = TOPE_PETICION_MS): Fetch {
  return async (input, init) => {
    const ctl = new AbortController();
    let vencio = false;
    const t = setTimeout(() => { vencio = true; ctl.abort(); }, ms);
    (t as unknown as { unref?: () => void }).unref?.();
    const externa = init?.signal;
    const alAbortar = () => ctl.abort();
    if (externa) { if (externa.aborted) ctl.abort(); else externa.addEventListener('abort', alAbortar, { once: true }); }
    try {
      return await base(input, { ...init, signal: ctl.signal });
    } catch (x) {
      if (vencio && !externa?.aborted) throw new TypeError(`Failed to fetch: tiempo de espera agotado (${Math.round(ms / 1000)} s)`);
      throw x;
    } finally {
      // El temporizador NO se cancela al recibir las cabeceras: si el cuerpo se queda a medias, también se aborta.
      externa?.removeEventListener('abort', alAbortar);
    }
  };
}

/** Resuelve con `alVencer()` si `p` no termina en `ms`. Si `p` rechaza después, el rechazo se ignora. */
export function conTope<T>(p: Promise<T>, ms: number, alVencer: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let listo = false;
    const t = setTimeout(() => {
      if (listo) return;
      listo = true;
      Promise.resolve().then(alVencer).then(resolve, reject);
    }, ms);
    p.then(
      (v) => { if (listo) return; listo = true; clearTimeout(t); resolve(v); },
      (e) => { if (listo) return; listo = true; clearTimeout(t); reject(e); },
    );
  });
}
