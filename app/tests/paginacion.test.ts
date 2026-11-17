import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Toda consulta paginada con `.range(` debe tener un orden TOTAL (termina en una llave única); si no, Postgres
 * puede repetir u omitir filas entre páginas. Aquí se listan las cadenas de orden aprobadas.
 */
const APROBADAS = [
  ['nombre', 'id'],                                   // localidades, rutas, perfiles
  ['ruta_id', 'localidad_id'],                        // ruta_localidades (llave primaria)
  ['ruta_id', 'usuario_id'],                          // ruta_ruteros (llave primaria)
  ['fecha', 'capturado_en', 'id'],                    // conteos
  ['creada_en', 'id'],                                // guías
  ['fecha', 'tipo', 'ruta_id', 'localidad_id'],       // v_conteos_diarios (clave del GROUP BY)
  ['fecha', 'sucursal', 'metodo_pago', 'estado_pago'],// v_cierre_diario (clave del GROUP BY)
].map((x) => x.join('>'));

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
}

describe('paginación con orden total', () => {
  const todos = archivos(join(__dirname, '..', 'src'));
  const hallazgos: { archivo: string; cadena: string }[] = [];
  for (const archivo of todos) {
    const t = readFileSync(archivo, 'utf8');
    let i = -1;
    while ((i = t.indexOf('.range(', i + 1)) !== -1) {
      const inicio = Math.max(t.lastIndexOf('supabase.from(', i), t.lastIndexOf('return qy', i), t.lastIndexOf('q<Guia[]>(qy', i));
      const tramo = t.slice(inicio, i);
      const orden = [...tramo.matchAll(/\.order\('(\w+)'/g)].map((m) => m[1]);
      hallazgos.push({ archivo: archivo.split('/src/')[1], cadena: orden.join('>') });
    }
  }
  it('se encontraron consultas paginadas (la prueba no está vacía)', () => { expect(hallazgos.length).toBeGreaterThanOrEqual(8); });
  it.each(hallazgos.map((h) => [h.archivo, h.cadena]))('%s: orden «%s» es total', (_a, cadena) => {
    expect(APROBADAS).toContain(cadena);
  });
});
