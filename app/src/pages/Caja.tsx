import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { q, traerTodo } from '../lib/api';
import { aCSV, descargarCSV } from '../lib/csv';
import { useQuery, useDebounced } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { nuevoId } from '../lib/ids';
import { borrarBorrador, cargarBorrador, guardarBorrador } from '../lib/borrador';
import { esConflictoId } from '../lib/errors';
import { calcularMonto, fmtMXN, fmtNum3, num2, parseNumero, redondear2 } from '../lib/money';
import { fechaHoraLocal, fechaHoraMX, fechaLarga, fechaMX, proximoEnvio, timestampMX } from '../lib/time';
import { ESTADOS_PAGO, METODOS_PAGO, type ConfigGuia, type Guia, type Tarifa } from '../lib/types';
import { Aviso, Campo, Cargando, Confirmar, ErrorCaja, Pagina, Vacio } from '../components/ui';
import { GuiaHoja } from '../components/GuiaHoja';
import { Icon } from '../components/Icon';

// ------------------------------------------------------------ Nueva guía
interface Form {
  tarifaId: string; destino: string;
  remitente: string; remitente_telefono: string; remitente_id: string; remitente_municipio: string; remitente_direccion: string;
  destinatario: string; destinatario_telefonos: string; direccion_eeuu: string; ciudad: string; estado: string; zip: string;
  contenido: string; bultos: string; peso: string; perecedero: boolean; valor: string;
  montoManual: string; metodo: string; estadoPago: string; fechaEnvio: string;
  recibe: string; punto: string; notas: string;
}

const VACIO: Form = {
  tarifaId: '', destino: '', remitente: '', remitente_telefono: '', remitente_id: '', remitente_municipio: '', remitente_direccion: '',
  destinatario: '', destinatario_telefonos: '', direccion_eeuu: '', ciudad: '', estado: '', zip: '', contenido: '', bultos: '1', peso: '',
  perecedero: false, valor: '', montoManual: '', metodo: 'Efectivo', estadoPago: 'Pagado', fechaEnvio: '', recibe: '', punto: '', notas: '',
};

export function NuevaGuia() {
  const { perfil, userId } = useAuth();
  const nav = useNavigate();
  const tarifas = useQuery<Tarifa[]>(() => q(supabase.from('tarifas').select('id,destino,precio_por_kg,moneda,activa').order('destino')), []);
  const uid = userId ?? 'sin-usuario';
  // El id y el formulario sobreviven a salir y volver mientras la guía no esté confirmada (mismo id en cada reintento).
  const [inicial] = useState(() => cargarBorrador<Form>(uid));
  const [f, setF] = useState<Form>(() => {
    const base: Form = { ...VACIO, fechaEnvio: proximoEnvio(), ...(inicial?.form ?? {}) };
    if (!base.fechaEnvio || base.fechaEnvio < fechaMX()) base.fechaEnvio = proximoEnvio();   // un borrador viejo no conserva una fecha pasada
    return base;
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [idGuia, setIdGuia] = useState(() => inicial?.id ?? nuevoId());
  const [intentado, setIntentado] = useState(inicial?.intentado ?? false);   // ya se mandó al servidor y no hubo confirmación
  useEffect(() => { guardarBorrador(uid, { id: idGuia, form: f, intentado }); }, [uid, idGuia, f, intentado]);
  const sucio = JSON.stringify({ ...f, fechaEnvio: '' }) !== JSON.stringify({ ...VACIO, fechaEnvio: '' });
  function descartarBorrador() {
    borrarBorrador(uid);
    setIdGuia(nuevoId()); setIntentado(false); setError(null);
    setF({ ...VACIO, fechaEnvio: proximoEnvio() });
  }

  const lista = (tarifas.data ?? []).filter((t) => t.activa !== false);
  const tarifa = lista.find((t) => t.id === f.tarifaId) ?? null;
  const precio = tarifa?.precio_por_kg ?? null;
  const peso = parseNumero(f.peso);
  const manual = !tarifa || precio === null;
  const montoManual = parseNumero(f.montoManual);
  const monto = manual ? (montoManual !== null ? redondear2(montoManual) : null) : peso !== null && peso > 0 ? calcularMonto(peso, precio!) : null;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const inp = (k: keyof Form, props: Record<string, unknown> = {}) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => set(k, e.target.value as never), ...props });

  function elegirTarifa(id: string) {
    const t = lista.find((x) => x.id === id);
    setF((x) => ({ ...x, tarifaId: id, destino: t?.destino ?? '', ciudad: x.ciudad || t?.destino || '' }));
  }

  async function guardar() {
    setError(null);
    if (!userId || !perfil?.sucursal) { setError('Tu usuario no tiene sucursal asignada. Contacta a un administrador.'); return; }
    if (!f.remitente.trim()) return setError('Escribe el nombre del remitente.');
    if (!f.destinatario.trim()) return setError('Escribe el nombre del destinatario.');
    if (!f.direccion_eeuu.trim()) return setError('Escribe la dirección en EE. UU.');
    if (!f.contenido.trim()) return setError('Describe el contenido del paquete.');
    const bultos = parseNumero(f.bultos);
    if (bultos === null || bultos < 1 || !Number.isInteger(bultos)) return setError('Los bultos deben ser un número entero de 1 en adelante.');
    if (peso === null || peso <= 0) return setError('Escribe el peso en kilogramos (mayor a 0).');
    if (monto === null || monto < 0) return setError(manual ? 'Captura el monto a cobrar.' : 'No se pudo calcular el monto.');
    const valor = f.valor.trim() === '' ? null : parseNumero(f.valor);
    if (f.valor.trim() !== '' && (valor === null || valor < 0)) return setError('El valor declarado no es válido.');

    const fila = {
      id: idGuia, sucursal: perfil.sucursal, creada_por: userId,
      fecha_recepcion: timestampMX(), fecha_envio: f.fechaEnvio || null,
      remitente: f.remitente.trim(), remitente_telefono: f.remitente_telefono.trim() || null, remitente_id: f.remitente_id.trim() || null,
      remitente_municipio: f.remitente_municipio.trim() || null, remitente_direccion: f.remitente_direccion.trim() || null,
      destinatario: f.destinatario.trim(), destinatario_telefonos: f.destinatario_telefonos.trim() || null,
      direccion_eeuu: f.direccion_eeuu.trim(), ciudad: f.ciudad.trim() || null, estado: f.estado.trim() || null, zip: f.zip.trim() || null,
      contenido: f.contenido.trim(), bultos, peso_kg: peso, valor_declarado_mxn: valor, perecedero: f.perecedero,
      pago: monto, moneda: 'MXN', estado_pago: f.estadoPago, metodo_pago: f.metodo,
      recibe: f.recibe.trim() || null, punto_recepcion: f.punto.trim() || null, notas: f.notas.trim() || null,
      tarifa_id: tarifa?.id ?? null,
      // `folio` y `tarifa_por_kg` no se envían: los fija la base de datos. Con tarifa de precio fijo la base
      // también calcula `pago`; `pago` solo cuenta cuando la tarifa está «por definir» o no hay tarifa.
    };
    setGuardando(true);
    setIntentado(true);   // desde aquí la guía pudo llegar al servidor aunque la respuesta se pierda
    const r = await q<Guia[]>(supabase.from('guias').insert(fila).select());
    if (r.error && esConflictoId(r.raw)) {
      // La guía ya se guardó en un intento anterior cuya respuesta no llegó: se muestra la existente.
      const ya = await q<{ id: string }[]>(supabase.from('guias').select('id').eq('id', idGuia).limit(1));
      setGuardando(false);
      if (ya.data?.length) { borrarBorrador(uid); nav(`/guia/${idGuia}/imprimir?nueva=1&ya=1`, { replace: true }); return; }
      return setError(ya.error ?? r.error);
    }
    setGuardando(false);
    if (r.error) {
      const incierto = r.clase === 'network' || r.clase === 'transient';
      return setError(incierto
        ? `${r.error} No se pudo confirmar si la guía se guardó. Puedes volver a pulsar «Guardar guía»: no se duplicará. (Antes de capturarla de nuevo, revisa «Mis guías».)`
        : r.error);
    }
    borrarBorrador(uid);
    // Se muestran los valores que devolvió la base (folio, pago, tarifa_por_kg), no los calculados aquí.
    const g = r.data?.[0];
    let diferencia: string | null = null;
    if (g) {
      const pagoDb = g.pago === null ? null : Number(g.pago);
      const tarifaDb = g.tarifa_por_kg === null || g.tarifa_por_kg === undefined ? null : Number(g.tarifa_por_kg);
      const difPago = pagoDb !== null && monto !== null && Math.abs(pagoDb - monto) > 0.005;
      const difTarifa = tarifa !== null && precio !== null && tarifaDb !== null && Math.abs(tarifaDb - precio) > 0.005;
      if (difPago || difTarifa) diferencia = `El sistema fijó el cobro en ${fmtMXN(pagoDb)}${tarifaDb !== null ? ` (${fmtMXN(tarifaDb)} por kg)` : ''}; en pantalla se había calculado ${fmtMXN(monto)}. Vale el monto del sistema, que es el que se imprime.`;
    }
    nav(`/guia/${idGuia}/imprimir?nueva=1`, { replace: true, state: { diferencia } });
  }

  if (tarifas.cargando) return <Cargando />;
  return (
    <Pagina titulo="Nueva guía">
      {tarifas.error && <ErrorCaja error={tarifas.error} onReintentar={tarifas.recargar} />}
      {error && <Aviso tipo="err">{error}</Aviso>}
      {inicial && sucio && <Aviso tipo="info">Se recuperó la guía que estabas capturando. {intentado ? 'Ya se intentó guardar; si vuelves a guardarla no se duplicará. ' : ''}<button className="btn chico" type="button" onClick={descartarBorrador}>Borrar y empezar otra</button></Aviso>}

      <div className="tarjeta col">
        <h2>Destino y tarifa</h2>
        <Campo etiqueta="Destino">
          <select value={f.tarifaId} onChange={(e) => elegirTarifa(e.target.value)}>
            <option value="">Sin tarifa (capturar el monto a mano)</option>
            {lista.map((t) => <option key={t.id} value={t.id}>{t.destino} · {t.precio_por_kg === null ? 'precio por definir' : `${fmtMXN(t.precio_por_kg)} por kg`}</option>)}
          </select>
        </Campo>
        {lista.length === 0 && !tarifas.error && <Aviso tipo="warn">No hay tarifas disponibles para tu usuario. Puedes capturar el monto a mano.</Aviso>}
        <Campo etiqueta="Fecha de envío"><input type="date" {...inp('fechaEnvio')} /></Campo>
        <p className="peq muted">Salidas aéreas: martes y jueves. Próxima: {fechaLarga(proximoEnvio())}.</p>
      </div>

      <div className="tarjeta col">
        <h2>Remitente</h2>
        <Campo etiqueta="Nombre completo"><input type="text" {...inp('remitente', { autoComplete: 'off' })} /></Campo>
        <div className="grid2">
          <Campo etiqueta="Teléfono"><input type="tel" inputMode="tel" {...inp('remitente_telefono')} /></Campo>
          <Campo etiqueta="Identificación (opcional)"><input type="text" {...inp('remitente_id')} /></Campo>
        </div>
        <div className="grid2">
          <Campo etiqueta="Municipio"><input type="text" {...inp('remitente_municipio')} /></Campo>
          <Campo etiqueta="Dirección"><input type="text" {...inp('remitente_direccion')} /></Campo>
        </div>
      </div>

      <div className="tarjeta col">
        <h2>Destinatario en EE. UU.</h2>
        <Campo etiqueta="Nombre completo"><input type="text" {...inp('destinatario')} /></Campo>
        <Campo etiqueta="Teléfono(s)"><input type="text" inputMode="tel" {...inp('destinatario_telefonos')} /></Campo>
        <Campo etiqueta="Dirección (calle y número)"><input type="text" {...inp('direccion_eeuu')} /></Campo>
        <div className="grid2">
          <Campo etiqueta="Ciudad"><input type="text" {...inp('ciudad')} /></Campo>
          <Campo etiqueta="Estado"><input type="text" {...inp('estado')} /></Campo>
        </div>
        <Campo etiqueta="Código postal (ZIP)"><input type="text" inputMode="numeric" {...inp('zip')} /></Campo>
      </div>

      <div className="tarjeta col">
        <h2>Paquete</h2>
        <Campo etiqueta="Contenido"><input type="text" {...inp('contenido')} placeholder="Ej. mole, tlayudas, ropa" /></Campo>
        <div className="grid2">
          <Campo etiqueta="Bultos"><input type="text" inputMode="numeric" {...inp('bultos')} /></Campo>
          <Campo etiqueta="Peso (kg)"><input type="text" inputMode="decimal" {...inp('peso')} placeholder="0.0" /></Campo>
        </div>
        <label className={'check' + (f.perecedero ? ' on' : '')}><input type="checkbox" checked={f.perecedero} onChange={(e) => set('perecedero', e.target.checked)} /> Perecedero</label>
        <Campo etiqueta="Valor declarado (MXN, opcional)"><input type="text" inputMode="decimal" {...inp('valor')} /></Campo>
      </div>

      <div className="tarjeta col">
        <h2>Cobro</h2>
        {manual ? (
          <>
            {tarifa && <Aviso tipo="warn">La tarifa de {tarifa.destino} está «por definir». Captura el monto a mano.</Aviso>}
            <Campo etiqueta="Monto a cobrar (MXN)"><input type="text" inputMode="decimal" {...inp('montoManual')} placeholder="0.00" /></Campo>
          </>
        ) : (
          <div className="tarjeta panel">
            <div className="muted peq">{peso !== null && peso > 0 ? `${fmtNum3(peso)} kg × ${fmtMXN(precio)} por kg` : 'Escribe el peso para calcular'}</div>
            <div className="kpi" style={{ border: 0, padding: 0, background: 'transparent' }}><div className="v" data-testid="monto">{fmtMXN(monto ?? 0)}</div></div>
          </div>
        )}
        <div className="grid2">
          <Campo etiqueta="Método de pago"><select value={f.metodo} onChange={(e) => set('metodo', e.target.value)}>{METODOS_PAGO.map((m) => <option key={m}>{m}</option>)}</select></Campo>
          <Campo etiqueta="Estado del pago"><select value={f.estadoPago} onChange={(e) => set('estadoPago', e.target.value)}>{ESTADOS_PAGO.map((m) => <option key={m}>{m}</option>)}</select></Campo>
        </div>
      </div>

      <details className="tarjeta">
        <summary style={{ fontWeight: 800, cursor: 'pointer', minHeight: 40 }}>Otros datos (opcional)</summary>
        <div className="col" style={{ marginTop: 10 }}>
          <Campo etiqueta="Recibe"><input type="text" {...inp('recibe')} /></Campo>
          <Campo etiqueta="Punto de recepción"><input type="text" {...inp('punto')} /></Campo>
          <Campo etiqueta="Notas"><textarea {...inp('notas')} /></Campo>
        </div>
      </details>

      <button className="btn primary bloque" style={{ minHeight: 64 }} onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar guía'}</button>
    </Pagina>
  );
}

// ------------------------------------------------------------ Impresión
export function useConfigGuia() {
  return useQuery<ConfigGuia>(() => q(supabase.from('config_guia').select('id,encabezado,nota,ancho_mm,alto_mm').eq('id', 1).single()), []);
}

export function GuiaImprimir() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const g = useQuery<Guia>(() => q(supabase.from('guias').select('*').eq('id', id!).single()), [id]);
  const cfg = useConfigGuia();
  const { perfil } = useAuth();
  const dif = (useLocation().state as { diferencia?: string | null } | null)?.diferencia ?? null;
  const estiloPagina = useRef<HTMLStyleElement | null>(null);
  const hojaRef = useRef<HTMLDivElement>(null);
  const ancho = cfg.data?.ancho_mm ?? 101.6;
  const alto = cfg.data?.alto_mm ?? 152.4;
  const PAG_PEGATINAS = '@page { size: letter; margin: 10mm; }';

  useEffect(() => {
    const st = document.createElement('style');
    document.head.appendChild(st);
    estiloPagina.current = st;
    return () => { st.remove(); };
  }, []);

  /** Imprime la guía (4 × 6) o las pegatinas (hoja carta) cambiando el tamaño de página solo durante la impresión. */
  function imprimir(modo: 'guia' | 'pegatinas') {
    const st = estiloPagina.current;
    const hoja = hojaRef.current;
    if (st) st.textContent = modo === 'guia' ? `@page { size: ${ancho}mm ${alto}mm; margin: 0; }` : PAG_PEGATINAS;
    if (hoja) hoja.dataset.modo = modo;
    window.print();
    if (st) st.textContent = `@page { size: ${ancho}mm ${alto}mm; margin: 0; }`;
  }

  if (g.cargando || cfg.cargando) return <Cargando />;
  if (g.error) return <ErrorCaja error={g.error} onReintentar={g.recargar} />;
  if (!g.data) return <Vacio>No se encontró la guía.</Vacio>;
  const volver = perfil?.rol === 'administrador' ? `/guia/${g.data.id}` : '/mis-guias';
  // La guía va en el primer bulto; hay una pegatina por cada bulto restante.
  const pegatinas = Math.max(0, (g.data.bultos ?? 1) - 1);
  const pueblo = g.data.ciudad ?? '';
  return (
    <div className="col">
      <div className="no-print col">
        {sp.get('nueva') && (
          <Aviso tipo="ok">
            {sp.get('ya') ? 'Esta guía ya estaba guardada' : 'Guía guardada'} con folio <b>{g.data.folio}</b> · monto <b>{fmtMXN(g.data.pago)}</b>
            {g.data.tarifa_por_kg != null ? <> · tarifa <b>{fmtMXN(g.data.tarifa_por_kg)}</b> por kg</> : null}.
            {sp.get('ya') ? ' Se muestran los datos que ya estaban guardados; si algo está mal, pide la corrección a un administrador.' : ''}
          </Aviso>
        )}
        {dif && <Aviso tipo="warn">{dif}</Aviso>}
        {cfg.error && <Aviso tipo="warn">No se pudo cargar el encabezado de la guía ({cfg.error}). Se imprimirá con el encabezado básico.</Aviso>}
        <div className="acciones">
          <button className="btn primary" onClick={() => imprimir('guia')}><Icon n="imprimir" /> Imprimir (original y copia)</button>
          {pegatinas > 0 && <button className="btn" onClick={() => imprimir('pegatinas')}><Icon n="etiqueta" /> Imprimir pegatinas ({pegatinas})</button>}
          <Link className="btn" to={volver}>Listo</Link>
          {perfil?.rol === 'sucursal' && <Link className="btn accent" to="/guia/nueva">Nueva guía</Link>}
        </div>
        <p className="peq muted">Se imprimen dos hojas de {ancho} × {alto} mm: original y copia del cliente.</p>
      </div>
      <div className="hoja-wrap" ref={hojaRef} data-modo="guia">
        <GuiaHoja guia={g.data} config={cfg.data} etiqueta="ORIGINAL" />
        <GuiaHoja guia={g.data} config={cfg.data} etiqueta="COPIA CLIENTE" />
        <div className="pegatinas">
          {Array.from({ length: pegatinas }, (_, i) => (
            <div className="pegatina" key={i}><span><b>{g.data!.destinatario}</b> - {pueblo}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Listas
export function ListaGuias({ admin }: { admin: boolean }) {
  const [texto, setTexto] = useState('');
  const buscar = useDebounced(texto.trim());
  const [pagina, setPagina] = useState(1);
  const [filas, setFilas] = useState<Guia[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [hayMas, setHayMas] = useState(false);
  const TAM = 30;
  const [nonce, setNonce] = useState(0);

  useEffect(() => { setPagina(1); }, [buscar]);
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    let qy = supabase.from('guias').select('id,folio,sucursal,creada_en,anulada,remitente,destinatario,ciudad,peso_kg,pago,metodo_pago,estado_pago,bultos');
    if (buscar) {
      const s = buscar.replace(/[,()%*]/g, ' ');
      qy = qy.or(`folio.ilike.%${s}%,remitente.ilike.%${s}%,destinatario.ilike.%${s}%`);
    }
    q<Guia[]>(qy.order('creada_en', { ascending: false }).order('id').range(0, pagina * TAM - 1) as never).then((r) => {
      if (!vivo) return;
      setCargando(false);
      if (r.error) { setError(r.error); return; }
      setError(null);
      setFilas(r.data ?? []);
      setHayMas((r.data ?? []).length === pagina * TAM);
    });
    return () => { vivo = false; };
  }, [buscar, pagina, nonce]);

  return (
    <Pagina titulo={admin ? 'Guías' : 'Mis guías'} acciones={admin ? <ExportarGuias /> : undefined}>
      <input type="search" placeholder="Buscar por folio, remitente o destinatario…" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar guías" />
      {error && <ErrorCaja error={error} onReintentar={() => setNonce((n) => n + 1)} />}
      {cargando && filas.length === 0 ? <Cargando /> : filas.length === 0 && !error ? <Vacio>No hay guías{buscar ? ' que coincidan' : ' todavía'}.</Vacio> : (
        <div className="lista">
          {filas.map((g) => (
            <Link key={g.id} to={`/guia/${g.id}`} className="item" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="fila entre"><span className="t">{g.folio}</span><b>{fmtMXN(g.pago)}</b></div>
              <div>{g.remitente} → {g.destinatario}</div>
              <div className="peq muted">{fechaHoraMX(g.creada_en)} · {g.sucursal} · {g.metodo_pago} · {g.estado_pago}</div>
              {g.anulada && <span className="pill err">Anulada</span>}
            </Link>
          ))}
        </div>
      )}
      {hayMas && <button className="btn bloque" onClick={() => setPagina((p) => p + 1)} disabled={cargando}>{cargando ? 'Cargando…' : 'Cargar más'}</button>}
    </Pagina>
  );
}

function ExportarGuias() {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function exportar() {
    setOcupado(true); setError(null);
    const r = await traerTodo<Guia>((a, b) => supabase.from('guias').select('*').order('creada_en', { ascending: false }).order('id').range(a, b));
    setOcupado(false);
    if (r.error) { setError(r.error); return; }
    const csv = aCSV(r.data!, [
      { titulo: 'Folio', valor: (g) => g.folio }, { titulo: 'Sucursal', valor: (g) => g.sucursal },
      { titulo: 'Creada (UTC)', valor: (g) => g.creada_en }, { titulo: 'Fecha recepción (MX)', valor: (g) => g.fecha_recepcion },
      { titulo: 'Fecha envío', valor: (g) => g.fecha_envio }, { titulo: 'Anulada', valor: (g) => (g.anulada ? 'Sí' : 'No') },
      { titulo: 'Remitente', valor: (g) => g.remitente }, { titulo: 'Tel. remitente', valor: (g) => g.remitente_telefono },
      { titulo: 'Municipio remitente', valor: (g) => g.remitente_municipio },
      { titulo: 'Destinatario', valor: (g) => g.destinatario }, { titulo: 'Tel. destinatario', valor: (g) => g.destinatario_telefonos },
      { titulo: 'Dirección EE. UU.', valor: (g) => g.direccion_eeuu }, { titulo: 'Ciudad', valor: (g) => g.ciudad },
      { titulo: 'Estado', valor: (g) => g.estado }, { titulo: 'ZIP', valor: (g) => g.zip },
      { titulo: 'Contenido', valor: (g) => g.contenido }, { titulo: 'Bultos', valor: (g) => g.bultos },
      { titulo: 'Peso kg', valor: (g) => g.peso_kg }, { titulo: 'Perecedero', valor: (g) => (g.perecedero ? 'Sí' : 'No') },
      { titulo: 'Valor declarado MXN', valor: (g) => (g.valor_declarado_mxn != null ? num2(g.valor_declarado_mxn) : '') },
      { titulo: 'Tarifa por kg MXN', valor: (g) => (g.tarifa_por_kg != null ? num2(g.tarifa_por_kg) : '') },
      { titulo: 'Monto MXN', valor: (g) => num2(g.pago) }, { titulo: 'Método de pago', valor: (g) => g.metodo_pago },
      { titulo: 'Estado de pago', valor: (g) => g.estado_pago }, { titulo: 'Notas', valor: (g) => g.notas },
    ]);
    descargarCSV(`guias-envca-${fechaMX()}.csv`, csv);
  }
  return <>
    <button className="btn chico" onClick={() => void exportar()} disabled={ocupado}><Icon n="descarga" /> {ocupado ? 'Exportando…' : 'Exportar CSV'}</button>
    {error && <Aviso tipo="err">{error}</Aviso>}
  </>;
}

// ------------------------------------------------------------ Detalle
export function GuiaDetalle() {
  const { id } = useParams();
  const { perfil } = useAuth();
  const nav = useNavigate();
  const g = useQuery<Guia>(() => q(supabase.from('guias').select('*').eq('id', id!).single()), [id]);
  const [anular, setAnular] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = perfil?.rol === 'administrador';

  async function hacerAnular() {
    setOcupado(true); setError(null);
    const r = await q(supabase.from('guias').update({ anulada: true }).eq('id', id!).select('id'));
    setOcupado(false);
    if (r.error) { setError(r.error); setAnular(false); return; }
    if (!(r.data as unknown[] | null)?.length) { setError('No se pudo anular: no tienes permiso o la guía ya no existe.'); setAnular(false); return; }
    setAnular(false); g.recargar();
  }

  if (g.cargando) return <Cargando />;
  if (g.error) return <ErrorCaja error={g.error} onReintentar={g.recargar} />;
  const x = g.data;
  if (!x) return <Vacio>No se encontró la guía (o no tienes permiso para verla).</Vacio>;
  const fila = (k: string, v: string | number | null | undefined) => v === null || v === undefined || v === '' ? null : <div className="fila entre" style={{ borderBottom: '1px solid #dde2ea', padding: '6px 0' }}><span className="muted">{k}</span><b style={{ textAlign: 'right' }}>{v}</b></div>;
  return (
    <Pagina titulo={`Guía ${x.folio}`}>
      {error && <Aviso tipo="err">{error}</Aviso>}
      {x.anulada && <Aviso tipo="err">Esta guía está ANULADA.</Aviso>}
      <div className="acciones">
        <Link className="btn primary" to={`/guia/${x.id}/imprimir`}><Icon n="imprimir" /> Reimprimir</Link>
        {admin && !x.anulada && <button className="btn danger" onClick={() => setAnular(true)}>Anular guía</button>}
        <button className="btn" onClick={() => nav(-1)}>Volver</button>
      </div>
      <div className="tarjeta">
        <h2>Cobro</h2>
        {fila('Monto', fmtMXN(x.pago))}{fila('Tarifa por kg', x.tarifa_por_kg != null ? fmtMXN(x.tarifa_por_kg) : '')}
        {fila('Método', x.metodo_pago)}{fila('Estado del pago', x.estado_pago)}
      </div>
      <div className="tarjeta">
        <h2>Paquete</h2>
        {fila('Contenido', x.contenido)}{fila('Bultos', x.bultos)}{fila('Peso', x.peso_kg != null ? `${fmtNum3(x.peso_kg)} kg` : '')}
        {fila('Perecedero', x.perecedero ? 'Sí' : 'No')}{fila('Valor declarado', x.valor_declarado_mxn ? fmtMXN(x.valor_declarado_mxn) : '')}
        {fila('Recepción', fechaHoraLocal(x.fecha_recepcion))}{fila('Envío', x.fecha_envio ? fechaLarga(x.fecha_envio) : '')}{fila('Sucursal', x.sucursal)}
        {fila('Notas', x.notas)}
      </div>
      <div className="tarjeta">
        <h2>Remitente</h2>
        {fila('Nombre', x.remitente)}{fila('Teléfono', x.remitente_telefono)}{fila('Identificación', x.remitente_id)}{fila('Municipio', x.remitente_municipio)}{fila('Dirección', x.remitente_direccion)}
      </div>
      <div className="tarjeta">
        <h2>Destinatario</h2>
        {fila('Nombre', x.destinatario)}{fila('Teléfono(s)', x.destinatario_telefonos)}{fila('Dirección', x.direccion_eeuu)}{fila('Ciudad', x.ciudad)}{fila('Estado', x.estado)}{fila('ZIP', x.zip)}
        {fila('Recibe', x.recibe)}{fila('Punto de recepción', x.punto_recepcion)}
      </div>
      {anular && <Confirmar titulo="Anular guía" peligro textoOk="Sí, anular" ocupado={ocupado} texto={<p>La guía <b>{x.folio}</b> dejará de contar en los cierres y los tableros. Esta acción no se puede deshacer desde la app.</p>} onOk={() => void hacerAnular()} onCancelar={() => setAnular(false)} />}
    </Pagina>
  );
}

// ------------------------------------------------------------ Cierre
export interface FilaCierre { fecha: string; sucursal: string; metodo_pago: string | null; estado_pago: string | null; guias: number; bultos: number; peso_kg: number; monto: number }

export function TablaCierre({ filas }: { filas: FilaCierre[] }) {
  const tot = useMemo(() => filas.reduce((a, r) => ({ guias: a.guias + Number(r.guias), bultos: a.bultos + Number(r.bultos), peso: a.peso + Number(r.peso_kg), monto: a.monto + Number(r.monto) }), { guias: 0, bultos: 0, peso: 0, monto: 0 }), [filas]);
  const pagado = filas.filter((r) => r.estado_pago === 'Pagado').reduce((a, r) => a + Number(r.monto), 0);
  const porMetodo = useMemo(() => {
    const m = new Map<string, { guias: number; monto: number }>();
    for (const r of filas) { const k = r.metodo_pago ?? 'Sin método'; const c = m.get(k) ?? { guias: 0, monto: 0 }; c.guias += Number(r.guias); c.monto += Number(r.monto); m.set(k, c); }
    return [...m.entries()];
  }, [filas]);
  if (!filas.length) return <Vacio>Sin guías en este cierre.</Vacio>;
  return (
    <div className="col">
      <div className="kpis">
        <div className="kpi"><div className="v">{tot.guias}</div><div className="l">Guías</div></div>
        <div className="kpi"><div className="v">{fmtNum3(tot.peso)}</div><div className="l">Kilogramos</div></div>
        <div className="kpi"><div className="v">{fmtMXN(tot.monto)}</div><div className="l">Monto total</div></div>
        <div className="kpi"><div className="v">{fmtMXN(pagado)}</div><div className="l">Pagado (por cobrar: {fmtMXN(tot.monto - pagado)})</div></div>
      </div>
      <div className="tabla-w"><table>
        <thead><tr><th>Método</th><th className="num">Guías</th><th className="num">Monto</th></tr></thead>
        <tbody>{porMetodo.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v.guias}</td><td className="num">{fmtMXN(v.monto)}</td></tr>)}</tbody>
        <tfoot><tr><td>Total</td><td className="num">{tot.guias}</td><td className="num">{fmtMXN(tot.monto)}</td></tr></tfoot>
      </table></div>
      <div className="tabla-w"><table>
        <thead><tr><th>Método</th><th>Estado de pago</th><th className="num">Guías</th><th className="num">Bultos</th><th className="num">Kg</th><th className="num">Monto</th></tr></thead>
        <tbody>{filas.map((r, i) => <tr key={i}><td>{r.metodo_pago ?? '—'}</td><td>{r.estado_pago ?? '—'}</td><td className="num">{r.guias}</td><td className="num">{r.bultos}</td><td className="num">{fmtNum3(Number(r.peso_kg))}</td><td className="num">{fmtMXN(Number(r.monto))}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}

export function CierreTurno() {
  const { perfil } = useAuth();
  const hoy = fechaMX();
  const r = useQuery<FilaCierre[]>(() => q(supabase.from('v_cierre_diario').select('*').eq('fecha', hoy).eq('sucursal', perfil?.sucursal ?? '')), [hoy, perfil?.sucursal]);
  return (
    <Pagina titulo="Cierre de mi turno">
      <div className="tarjeta panel"><b>{fechaLarga(hoy)}</b> · {perfil?.sucursal} · solo tus guías (no anuladas)</div>
      {r.cargando ? <Cargando /> : r.error ? <ErrorCaja error={r.error} onReintentar={r.recargar} /> : <TablaCierre filas={r.data ?? []} />}
      <button className="btn bloque" onClick={() => r.recargar()}><Icon n="sync" /> Actualizar</button>
    </Pagina>
  );
}
