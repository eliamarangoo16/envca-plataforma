import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _cerrarParaPruebas, DB_NOMBRE, kvSet, limpiarDatosUsuario } from '../src/lib/db';
import { encolar, enviarBandeja, listarOutbox, type Transport } from '../src/lib/outbox';
import { textoRestantes, vaciarAntesDeSalir } from '../src/lib/salida';
import { borrarBorrador, cargarBorrador, guardarBorrador } from '../src/lib/borrador';

const U = 'user-1';
const conteo = (id: string) => encolar({ tipo: 'conteo', rid: id, usuario_id: U, payload: { id, tipo: 'salida', fecha: '2026-11-16', ruta_id: null, localidad_id: 'l', cantidad: 1, notas: null, usuario_id: U } });
const OK = { error: null, status: 201 };
const RED = { error: { message: 'Failed to fetch', code: '' }, status: 0 };

beforeEach(async () => {
  await _cerrarParaPruebas();
  await new Promise<void>((res, rej) => { const r = indexedDB.deleteDatabase(DB_NOMBRE); r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res(); });
});

describe('cerrar sesión con registros en la bandeja', () => {
  it('sin registros no intenta enviar nada', async () => {
    let llamado = false;
    expect(await vaciarAntesDeSalir(U, async () => { llamado = true; })).toEqual({ total: 0, pendientes: 0, errores: 0 });
    expect(llamado).toBe(false);
  });
  it('con red: envía primero y no queda nada por advertir', async () => {
    await conteo('c1'); await conteo('c2');
    const t: Transport = { upsert: async () => OK, update: async () => OK };
    const r = await vaciarAntesDeSalir(U, () => enviarBandeja(t, U));
    expect(r.total).toBe(0);
  });
  it('sin red: informa cuántos quedan (para advertir) y NO borra la bandeja', async () => {
    await conteo('c1'); await conteo('c2');
    const t: Transport = { upsert: async () => RED, update: async () => RED };
    const r = await vaciarAntesDeSalir(U, () => enviarBandeja(t, U));
    expect(r).toMatchObject({ total: 2, pendientes: 2, errores: 0 });
    expect(textoRestantes(r)).toBe('2 registros');
    expect(textoRestantes({ total: 1, pendientes: 0, errores: 1 })).toBe('1 registro (1 con error)');
    // el cierre de sesión limpia datos del usuario pero la bandeja sobrevive
    await kvSet('perfil', { id: U });
    await limpiarDatosUsuario();
    expect((await listarOutbox(U)).map((i) => i.rid)).toEqual(['c1', 'c2']);
  });
  it('un envío que se cuelga no impide mostrar la advertencia (tope)', async () => {
    await conteo('c1');
    const r = await vaciarAntesDeSalir(U, () => new Promise(() => {}), 30);
    expect(r.total).toBe(1);
  });
});

describe('borrador de la guía (el id sobrevive a salir y volver)', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
  it('se recupera el mismo id y formulario hasta que se confirma; por usuario', () => {
    const a = mem();
    guardarBorrador('u1', { id: 'id-guia-1', form: { remitente: 'Ana' }, intentado: true }, a);
    expect(cargarBorrador('u1', a)).toEqual({ id: 'id-guia-1', form: { remitente: 'Ana' }, intentado: true });
    expect(cargarBorrador('u2', a)).toBeNull();
    borrarBorrador('u1', a);
    expect(cargarBorrador('u1', a)).toBeNull();
  });
  it('un valor corrupto se ignora', () => {
    const a = mem(); a.setItem('envca-guia-borrador:u1', '{no es json');
    expect(cargarBorrador('u1', a)).toBeNull();
  });
});
