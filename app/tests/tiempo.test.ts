import { afterEach, describe, expect, it, vi } from 'vitest';
import { conTope, fetchConTope } from '../src/lib/tiempo';
import { clasificarError, desdeExcepcion } from '../src/lib/errors';
import { debeRefrescarCatalogos, CATALOGOS_CADA_MS, CATALOGOS_REINTENTO_MS } from '../src/lib/politicaSync';

afterEach(() => { vi.useRealTimers(); });

/** fetch que nunca responde pero respeta la señal de aborto (como el real). */
const colgado = (_i: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
  init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })));
});

describe('fetchConTope', () => {
  it('a los 15 s aborta y lanza un error de red (no un error de datos)', async () => {
    vi.useFakeTimers();
    const f = fetchConTope(colgado as never, 15_000);
    const p = f('https://x/rest/v1/conteos').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(14_999);
    let resuelto = false; void p.then(() => { resuelto = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(resuelto).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const e = (await p) as Error;
    expect(e).toBeInstanceOf(TypeError);
    expect(e.message).toMatch(/Failed to fetch.*tiempo de espera/);
    // y así lo clasifica el resto de la app: red -> el registro se queda pendiente
    expect(clasificarError(desdeExcepcion(e), 0)).toBe('network');
  });
  it('si el llamador aborta con su propia señal, se respeta (no se disfraza de timeout)', async () => {
    const f = fetchConTope(colgado as never, 15_000);
    const ctl = new AbortController();
    const p = f('https://x', { signal: ctl.signal }).catch((e: unknown) => e);
    ctl.abort();
    expect(((await p) as Error).name).toBe('AbortError');
  });
  it('una respuesta a tiempo pasa tal cual', async () => {
    const f = fetchConTope((async () => new Response('ok')) as never, 50);
    expect(await (await f('https://x')).text()).toBe('ok');
  });
});

describe('conTope', () => {
  it('devuelve el valor de respaldo si la promesa no termina, e ignora su rechazo tardío', async () => {
    let rechazar!: (e: Error) => void;
    const p = new Promise<number>((_r, rej) => { rechazar = rej; });
    expect(await conTope(p, 20, () => -1)).toBe(-1);
    rechazar(new Error('tarde'));                // no debe producir "unhandled rejection"
    await new Promise((r) => setTimeout(r, 10));
  });
  it('si la promesa termina antes, gana ella', async () => {
    expect(await conTope(Promise.resolve(7), 1000, () => -1)).toBe(7);
  });
});

describe('cuándo bajar catálogos completos', () => {
  const T0 = 1_000_000_000;
  it('al abrir / al volver la red (forzar) siempre', () => {
    expect(debeRefrescarCatalogos(T0, { ultimoOk: T0 - 1000, ultimoIntento: T0 - 1000, forzar: true })).toBe(true);
    expect(debeRefrescarCatalogos(T0, { ultimoOk: 0, ultimoIntento: 0, forzar: true })).toBe(true);
  });
  it('no antes de 10 minutos aunque la sincronización corra cada 30 s', () => {
    const e = { ultimoOk: T0, ultimoIntento: T0, forzar: false };
    for (let t = 30_000; t < CATALOGOS_CADA_MS; t += 30_000) expect(debeRefrescarCatalogos(T0 + t, e)).toBe(false);
    expect(debeRefrescarCatalogos(T0 + CATALOGOS_CADA_MS, e)).toBe(true);
  });
  it('tras un fallo reintenta al minuto, no cada 30 s', () => {
    const e = { ultimoOk: 0, ultimoIntento: T0, forzar: false };
    expect(debeRefrescarCatalogos(T0 + 30_000, e)).toBe(false);
    expect(debeRefrescarCatalogos(T0 + CATALOGOS_REINTENTO_MS, e)).toBe(true);
  });
});
