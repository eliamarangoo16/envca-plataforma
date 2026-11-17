import { describe, expect, it } from 'vitest';
import { calcularMonto, fmtMXN, parseNumero, redondear2 } from '../src/lib/money';
import { aCSV } from '../src/lib/csv';
import { clasificarError, mensajeError } from '../src/lib/errors';
import { diaSemana, fechaMX, proximoEnvio, sumarDias, timestampMX } from '../src/lib/time';
import { nuevoId } from '../src/lib/ids';

describe('dinero', () => {
  it('redondea a 2 decimales sin ruido de flotante', () => {
    expect(redondear2(1.005)).toBe(1.01);
    expect(redondear2(2.675)).toBe(2.68);
    expect(calcularMonto(2.35, 240)).toBe(564);
    expect(calcularMonto(0.333, 240)).toBe(79.92);
    expect(calcularMonto(1.234, 240.5)).toBe(296.78);
  });
  it('formatea MXN con 2 decimales', () => { expect(fmtMXN(1234.5)).toMatch(/1,234\.50/); });
  it('parsea coma o punto decimal', () => {
    expect(parseNumero('12,5')).toBe(12.5);
    expect(parseNumero(' 3.25 ')).toBe(3.25);
    expect(parseNumero('abc')).toBeNull();
    expect(parseNumero('')).toBeNull();
  });
});

describe('fechas de México', () => {
  it('una captura a las 23:30 en CDMX (05:30Z del día siguiente) cuenta como el día local', () => {
    expect(fechaMX(new Date('2026-11-17T05:30:00Z'))).toBe('2026-11-16');
    expect(fechaMX(new Date('2026-11-17T06:30:00Z'))).toBe('2026-11-17');
    expect(timestampMX(new Date('2026-11-17T05:30:00Z'))).toBe('2026-11-16T23:30:00');
  });
  it('días de la semana y próxima salida (martes/jueves)', () => {
    expect(diaSemana('2026-11-16')).toBe(1);        // lunes
    expect(proximoEnvio('2026-11-16')).toBe('2026-11-17');
    expect(proximoEnvio('2026-11-17')).toBe('2026-11-17');
    expect(proximoEnvio('2026-11-18')).toBe('2026-11-19');
    expect(proximoEnvio('2026-11-20')).toBe('2026-11-24');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('csv', () => {
  it('lleva BOM, escapa comillas y comas, y neutraliza fórmulas', () => {
    const s = aCSV([{ a: 'hola, "mundo"', b: '=SUMA(1)', c: -3 }], [{ titulo: 'A', valor: (x) => x.a }, { titulo: 'B', valor: (x) => x.b }, { titulo: 'C', valor: (x) => x.c }]);
    expect(s.charCodeAt(0)).toBe(0xfeff);
    expect(s).toBe('﻿A,B,C\r\n"hola, ""mundo""",\'=SUMA(1),-3\r\n');
  });
});

describe('clasificación de errores', () => {
  it('distingue red, sesión, transitorio y datos', () => {
    expect(clasificarError({ message: 'TypeError: Failed to fetch', code: '' }, 0)).toBe('network');
    expect(clasificarError({ message: 'x' })).toBe('network');
    expect(clasificarError({ name: 'AuthRetryableFetchError', message: 'x' }, 0)).toBe('network');
    expect(clasificarError({ message: 'JWT expired', code: 'PGRST301' }, 401)).toBe('auth');
    expect(clasificarError({ message: 'x' }, 503)).toBe('transient');
    expect(clasificarError({ message: 'x' }, 429)).toBe('transient');
    expect(clasificarError({ message: 'x', code: '23505' }, 409)).toBe('permanent');
    expect(clasificarError({ message: 'x', code: '42501' }, 403)).toBe('permanent');
    expect(clasificarError({ message: 'x', code: '23514' })).toBe('permanent');
  });
  it('mensajes en español', () => {
    expect(mensajeError({ message: 'new row violates row-level security policy for table "x"', code: '42501' }, 403)).toMatch(/permiso/);
    expect(mensajeError({ message: 'Failed to fetch' }, 0)).toMatch(/Sin conexión/);
  });
});

describe('ids', () => { it('genera uuid v4 únicos', () => { const a = nuevoId(), b = nuevoId(); expect(a).not.toBe(b); expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); }); });
