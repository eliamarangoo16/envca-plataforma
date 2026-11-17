import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { q } from '../lib/api';
import { useAuth } from '../lib/auth';
import { parseNumero } from '../lib/money';
import { Aviso, Campo, Cargando, ErrorCaja, Pagina, Segmentos } from '../components/ui';
import { GuiaHoja } from '../components/GuiaHoja';
import { useConfigGuia } from './Caja';
import type { ConfigGuia, Guia } from '../lib/types';

type Encabezado = NonNullable<ConfigGuia['encabezado']>;
const LOGO_MAX_BYTES = 300 * 1024;
const FORMATOS = {
  '4x6': { ancho: '101.6', alto: '152.4', nombre: '4 × 6 pulgadas' },
  '4x8': { ancho: '101.6', alto: '203.2', nombre: '4 × 8 pulgadas' },
} as const;
type Formato = keyof typeof FORMATOS | 'otro';

/** Edición de la información de la empresa, la nota y el tamaño de la guía. Solo administrador de nivel 1 (la base lo exige también). */
export function ConfigGuiasAdmin() {
  const cfg = useConfigGuia();
  if (cfg.cargando) return <Pagina titulo="Formato de guías"><Cargando /></Pagina>;
  if (cfg.error) return <Pagina titulo="Formato de guías"><ErrorCaja error={cfg.error} onReintentar={cfg.recargar} /></Pagina>;
  if (!cfg.data) return <Pagina titulo="Formato de guías"><Aviso tipo="warn">No se encontró la configuración de la guía.</Aviso></Pagina>;
  return <FormularioConfig config={cfg.data} />;
}

function FormularioConfig({ config }: { config: ConfigGuia }) {
  const { userId } = useAuth();
  const e: Encabezado = config.encabezado ?? {};
  const [name, setName] = useState(e.name ?? '');
  const [l1, setL1] = useState(e.l1 ?? '');
  const [slogan, setSlogan] = useState(e.slogan ?? '');
  const [rfc, setRfc] = useState(e.rfc ?? '');
  const [titular, setTitular] = useState(e.titular ?? '');
  const [phones, setPhones] = useState(e.phones ?? '');
  const [logo, setLogo] = useState(e.logo ?? '');
  const [nota, setNota] = useState(config.nota ?? '');
  const [ancho, setAncho] = useState(String(config.ancho_mm ?? 101.6));
  const [alto, setAlto] = useState(String(config.alto_mm ?? 152.4));
  const [vista, setVista] = useState(false);
  const formatoActual: Formato = (Object.keys(FORMATOS) as (keyof typeof FORMATOS)[]).find((k) => FORMATOS[k].ancho === ancho.trim() && FORMATOS[k].alto === alto.trim()) ?? 'otro';
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function elegirLogo(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setError('El logotipo debe ser PNG, JPG o WebP.');
    if (f.size > LOGO_MAX_BYTES) return setError('El logotipo pesa más de 300 KB. Usa una imagen más chica.');
    const lector = new FileReader();
    lector.onload = () => setLogo(String(lector.result));
    lector.onerror = () => setError('No se pudo leer el logotipo.');
    lector.readAsDataURL(f);
  }

  async function guardar() {
    setError(null); setAviso(null);
    const a = parseNumero(ancho);
    const l = parseNumero(alto);
    if (a === null || l === null || a < 50 || a > 300 || l < 50 || l > 300) return setError('El ancho y el alto deben estar entre 50 y 300 mm.');
    if (!name.trim()) return setError('Escribe el nombre de la empresa.');
    setOcupado(true);
    const campos = {
      encabezado: { name: name.trim(), l1: l1.trim(), slogan: slogan.trim(), rfc: rfc.trim(), titular: titular.trim(), phones: phones.trim(), logo },
      nota: nota.trim(),
      ancho_mm: a,
      alto_mm: l,
      actualizado_por: userId,
    };
    const r = await q(supabase.from('config_guia').update(campos).eq('id', 1).select('id'));
    setOcupado(false);
    if (r.error) return setError(r.error);
    if (!(r.data as unknown[] | null)?.length) return setError('No se guardó: no tienes permiso para cambiar el formato de las guías.');
    setAviso('Formato guardado. Las guías que se impriman a partir de ahora usan estos datos.');
  }

  const muestra: Guia = {
    id: 'muestra', folio: 'SPH-0000', sucursal: 'SPH', creada_en: '', anulada: false, fecha_recepcion: null, fecha_envio: null,
    remitente: 'Remitente de ejemplo', remitente_telefono: '', destinatario: 'Destinatario de ejemplo', direccion_eeuu: '',
    ciudad: 'San José', estado: 'CA', zip: '', contenido: 'Mercancía de ejemplo', bultos: 2, peso_kg: 2.35, perecedero: false,
    pago: 564, moneda: 'MXN', metodo_pago: 'Efectivo', estado_pago: 'Pagado', tarifa_por_kg: 240,
  } as unknown as Guia;

  return (
    <Pagina titulo="Formato de guías" acciones={<button className="btn chico" onClick={() => setVista((v) => !v)}>{vista ? 'Ocultar vista previa' : 'Vista previa'}</button>}>
      <div className="col">
        {error && <Aviso tipo="err">{error}</Aviso>}
        {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
        <h2>Información de la empresa</h2>
        <Campo etiqueta="Nombre de la empresa"><input type="text" value={name} onChange={(x) => setName(x.target.value)} /></Campo>
        <Campo etiqueta="Línea superior" ayuda="Texto pequeño arriba del nombre, por ejemplo MENSAJERÍA Y PAQUETERÍA."><input type="text" value={l1} onChange={(x) => setL1(x.target.value)} /></Campo>
        <Campo etiqueta="Eslogan"><input type="text" value={slogan} onChange={(x) => setSlogan(x.target.value)} /></Campo>
        <Campo etiqueta="R.F.C."><input type="text" value={rfc} onChange={(x) => setRfc(x.target.value)} /></Campo>
        <Campo etiqueta="Titular"><input type="text" value={titular} onChange={(x) => setTitular(x.target.value)} /></Campo>
        <Campo etiqueta="Teléfonos (pie de la guía)"><textarea rows={2} value={phones} onChange={(x) => setPhones(x.target.value)} /></Campo>
        <Campo etiqueta="Logotipo" ayuda="PNG, JPG o WebP de hasta 300 KB. Si no pones logotipo, se imprime solo el nombre.">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(x) => elegirLogo(x.target.files?.[0])} />
        </Campo>
        {logo && <div className="fila" style={{ gap: 8, alignItems: 'center' }}><img src={logo} alt="Logotipo actual" style={{ height: 48, maxWidth: 120, objectFit: 'contain' }} /><button className="btn chico" onClick={() => setLogo('')}>Quitar logotipo</button></div>}

        <h2>Nota al pie de la guía</h2>
        <Campo etiqueta="Texto de la nota"><textarea rows={6} value={nota} onChange={(x) => setNota(x.target.value)} /></Campo>

        <h2>Tamaño de la guía</h2>
        <div className="fila" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Campo etiqueta="Ancho (mm)"><input type="text" inputMode="decimal" value={ancho} onChange={(x) => setAncho(x.target.value)} /></Campo>
          <Campo etiqueta="Alto (mm)"><input type="text" inputMode="decimal" value={alto} onChange={(x) => setAlto(x.target.value)} /></Campo>
        </div>
        <Segmentos<Formato>
          valor={formatoActual}
          opciones={[{ v: '4x6', t: FORMATOS['4x6'].nombre }, { v: '4x8', t: FORMATOS['4x8'].nombre }, { v: 'otro', t: 'Otro tamaño' }]}
          onCambio={(f) => { if (f !== 'otro') { setAncho(FORMATOS[f].ancho); setAlto(FORMATOS[f].alto); } }}
        />
        <p className="peq muted">Elige 4 × 6 o 4 × 8 pulgadas, o escribe otro tamaño en mm. Los textos y las fuentes de la guía están pensados para la medida elegida; revisa la vista previa antes de imprimir.</p>

        {vista && (
          <div className="hoja-wrap" style={{ alignItems: 'flex-start' }}>
            <GuiaHoja guia={muestra} config={{ ...config, encabezado: { ...e, name, l1, slogan, rfc, titular, phones, logo }, nota, ancho_mm: parseNumero(ancho) ?? 101.6, alto_mm: parseNumero(alto) ?? 152.4 }} etiqueta="ORIGINAL" />
          </div>
        )}

        <div className="acciones"><button className="btn primary" onClick={() => void guardar()} disabled={ocupado}>Guardar formato</button></div>
      </div>
    </Pagina>
  );
}
