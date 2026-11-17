import { useMemo, useState } from 'react';
import type { Localidad } from '../lib/types';

function norm(s: string) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

export function BuscadorLocalidad({ localidades, valor, onElegir, destacadas, etiquetaExtra }: {
  localidades: Localidad[];
  valor: string | null;
  onElegir: (l: Localidad) => void;
  /** ids que se muestran primero (p. ej. las de la ruta). */
  destacadas?: Set<string>;
  etiquetaExtra?: (l: Localidad) => string;
}) {
  const [txt, setTxt] = useState('');
  const lista = useMemo(() => {
    const t = norm(txt.trim());
    const f = localidades.filter((l) => l.activa !== false && (!t || norm(`${l.nombre} ${l.municipio ?? ''}`).includes(t)));
    if (destacadas?.size) f.sort((a, b) => Number(destacadas.has(b.id)) - Number(destacadas.has(a.id)) || a.nombre.localeCompare(b.nombre, 'es'));
    return f.slice(0, 80);
  }, [localidades, txt, destacadas]);
  const elegida = localidades.find((l) => l.id === valor);
  return (
    <div>
      <input type="search" placeholder="Buscar localidad o municipio…" value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Buscar localidad" autoComplete="off" />
      {elegida && <p className="aviso ok" style={{ marginTop: 6 }}>Elegida: <b>{elegida.nombre}</b>{elegida.municipio ? `, ${elegida.municipio}` : ''}{elegida.pendiente ? ' (nueva, por enviar)' : ''}</p>}
      <div className="lista-sel" role="listbox" aria-label="Localidades">
        {lista.length === 0 && <div className="vacio" style={{ border: 0 }}>Sin resultados. Puedes crear una nueva localidad.</div>}
        {lista.map((l) => (
          <button key={l.id} type="button" role="option" aria-selected={l.id === valor} className={l.id === valor ? 'on' : ''} onClick={() => onElegir(l)}>
            {l.nombre}{l.pendiente ? ' • nueva' : ''}
            <small>{[l.municipio, etiquetaExtra?.(l)].filter(Boolean).join(' · ')}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
