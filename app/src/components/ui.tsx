import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="cargando" role="status"><span className="giro" />{texto}</div>;
}

export function Vacio({ children }: { children: ReactNode }) { return <div className="vacio">{children}</div>; }

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'ok' | 'warn' | 'err'; children: ReactNode }) {
  return <div className={`aviso ${tipo}`} role={tipo === 'err' ? 'alert' : 'status'}>{children}</div>;
}

export function ErrorCaja({ error, onReintentar }: { error: string; onReintentar?: () => void }) {
  return (
    <div className="aviso err" role="alert">
      <p style={{ margin: 0 }}>{error}</p>
      {onReintentar && <button className="btn chico" style={{ marginTop: 8 }} onClick={onReintentar}><Icon n="sync" /> Reintentar</button>}
    </div>
  );
}

export function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      {children}
      {ayuda && <span className="ayuda">{ayuda}</span>}
    </label>
  );
}

export function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div className="fondo no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

export function Confirmar({ titulo, texto, textoOk = 'Confirmar', peligro, ocupado, onOk, onCancelar }: {
  titulo: string; texto: ReactNode; textoOk?: string; peligro?: boolean; ocupado?: boolean; onOk: () => void; onCancelar: () => void;
}) {
  return (
    <Modal titulo={titulo} onCerrar={onCancelar}>
      <div>{texto}</div>
      <div className="acciones">
        <button className="btn" onClick={onCancelar} disabled={ocupado}>Cancelar</button>
        <button className={`btn ${peligro ? 'danger lleno' : 'primary'}`} onClick={onOk} disabled={ocupado}>{ocupado ? 'Procesando…' : textoOk}</button>
      </div>
    </Modal>
  );
}

export function Segmentos<T extends string>({ valor, opciones, onCambio }: { valor: T; opciones: { v: T; t: string }[]; onCambio: (v: T) => void }) {
  return (
    <div className="segmentos" role="radiogroup">
      {opciones.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={valor === o.v} className={valor === o.v ? 'on' : ''} onClick={() => onCambio(o.v)}>{o.t}</button>
      ))}
    </div>
  );
}

export function Stepper({ valor, onCambio, min = 0 }: { valor: number; onCambio: (n: number) => void; min?: number }) {
  const [txt, setTxt] = useState(String(valor));
  useEffect(() => { setTxt(String(valor)); }, [valor]);
  return (
    <div className="stepper">
      <button type="button" aria-label="Restar uno" onClick={() => onCambio(Math.max(min, valor - 1))}>−</button>
      <input
        inputMode="numeric" aria-label="Cantidad" value={txt}
        onChange={(e) => {
          const t = e.target.value.replace(/\D/g, '');
          setTxt(t);
          onCambio(t === '' ? 0 : Math.min(99999, Number(t)));
        }}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" className="mas" aria-label="Sumar uno" onClick={() => onCambio(valor + 1)}>+</button>
    </div>
  );
}

export function Pagina({ titulo, acciones, children }: { titulo: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <div className="col">
      <div className="fila entre"><h1 style={{ margin: 0 }}>{titulo}</h1>{acciones && <div className="fila">{acciones}</div>}</div>
      {children}
    </div>
  );
}

export function Barras({ filas, formato }: { filas: { etiqueta: string; valor: number }[]; formato?: (n: number) => string }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  if (!filas.length) return <Vacio>Sin datos en el periodo.</Vacio>;
  return (
    <div className="barras">
      {filas.map((f) => (
        <div className="barra" key={f.etiqueta}>
          <span>{f.etiqueta}</span>
          <div className="b"><i style={{ width: `${(f.valor / max) * 100}%` }} /></div>
          <span className="n">{formato ? formato(f.valor) : f.valor}</span>
        </div>
      ))}
    </div>
  );
}
