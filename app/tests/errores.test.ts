import { describe, expect, it, vi } from 'vitest';
import { clasificarError, COD_SIN_FILAS, desdeExcepcion, esConflictoId, mensajeError } from '../src/lib/errors';

describe('conflicto de llave primaria de la guía', () => {
  it('23505 sobre id sí; 23505 de otra restricción (folio) no', () => {
    expect(esConflictoId({ code: '23505', message: 'duplicate key value violates unique constraint "guias_pkey"', details: 'Key (id)=(abc) already exists.' })).toBe(true);
    expect(esConflictoId({ code: '23505', message: 'duplicate key value violates unique constraint "guias_folio_key"', details: 'Key (folio)=(SPH-3) already exists.' })).toBe(false);
    expect(esConflictoId({ code: '23514', message: 'x' })).toBe(false);
    expect(esConflictoId(null)).toBe(false);
  });
});

describe('mensajes', () => {
  it('los mensajes que escribe la base (triggers, 42501) se muestran tal cual', () => {
    const m = 'Debe quedar al menos un administrador nivel 1 activo';
    expect(mensajeError({ message: m, code: '42501' }, 403)).toBe(m);
    expect(mensajeError({ message: 'No puedes cambiar tu propio rol ni desactivar tu propia cuenta', code: '42501' }, 403)).toBe('No puedes cambiar tu propio rol ni desactivar tu propia cuenta');
  });
  it('el 42501 genérico de RLS sigue diciendo "sin permiso"', () => {
    expect(mensajeError({ message: 'new row violates row-level security policy for table "x"', code: '42501' }, 403)).toMatch(/No tienes permiso/);
  });
  it('0 filas actualizadas: mensaje de la ventana de edición', () => {
    expect(mensajeError({ message: '.', code: COD_SIN_FILAS }, 403)).toMatch(/Solo puedes corregir registros de hoy y de ayer; pide el cambio a un administrador/);
    expect(clasificarError({ message: '.', code: COD_SIN_FILAS }, 403)).toBe('permanent');
  });
  it('abortos y tiempos agotados son error de red (el registro se queda pendiente)', () => {
    expect(clasificarError(desdeExcepcion(Object.assign(new Error('aborted'), { name: 'AbortError' })), 0)).toBe('network');
    expect(clasificarError({ message: 'TypeError: Failed to fetch: tiempo de espera agotado (15 s)', code: '' }, 0)).toBe('network');
    expect(clasificarError({ message: 'Tiempo de espera agotado', code: '', name: 'TimeoutError', status: 0 })).toBe('network');
  });
});

describe('perfil: nunca se asume "activo" ante un fallo', () => {
  async function conRespuesta(r: { data: unknown; error: unknown; status: number }) {
    vi.resetModules();
    vi.doMock('../src/lib/supabase', () => {
      const b: Record<string, unknown> = {};
      b.select = () => b; b.eq = () => b; b.limit = () => Promise.resolve(r);
      return { supabase: { from: () => b, auth: {} }, SUPABASE_URL: 'x', SUPABASE_KEY: 'y' };
    });
    return (await import('../src/lib/auth')).bajarPerfil('u1');
  }
  const fila = (extra: object) => ({ id: 'u1', nombre: 'N', sucursal: null, rol: 'rutero', ...extra });
  it('columna `activo` inexistente (42703) = error, NO se reintenta sin ella ni se asume activo', async () => {
    const r = await conRespuesta({ data: null, error: { code: '42703', message: 'column perfiles.activo does not exist' }, status: 400 });
    expect(r.perfil).toBeNull();
    expect(r.error).toBeTruthy();
  });
  it('error 500 = error (el llamador usa la copia guardada o muestra el error)', async () => {
    const r = await conRespuesta({ data: null, error: { code: '', message: 'boom' }, status: 500 });
    expect(r.perfil).toBeNull(); expect(r.error).toBeTruthy(); expect(r.red).toBe(false);
  });
  it('activo=false e `activo` ausente o nulo = inactivo', async () => {
    expect((await conRespuesta({ data: [fila({ activo: false })], error: null, status: 200 })).perfil?.activo).toBe(false);
    expect((await conRespuesta({ data: [fila({})], error: null, status: 200 })).perfil?.activo).toBe(false);
    expect((await conRespuesta({ data: [fila({ activo: null })], error: null, status: 200 })).perfil?.activo).toBe(false);
  });
  it('activo=true = activo; rol desconocido = inactivo', async () => {
    expect((await conRespuesta({ data: [fila({ activo: true })], error: null, status: 200 })).perfil?.activo).toBe(true);
    expect((await conRespuesta({ data: [fila({ activo: true, rol: 'otro' })], error: null, status: 200 })).perfil?.activo).toBe(false);
  });
});
