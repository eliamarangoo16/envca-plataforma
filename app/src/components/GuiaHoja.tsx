import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { fmtMXN } from '../lib/money';
import type { ConfigGuia, Guia } from '../lib/types';

/** dd/mm/aaaa a partir de una fecha `YYYY-MM-DD` o un timestamp (hora de México). */
function fechaCorta(v: string | null | undefined): string {
  if (!v) return '';
  const s = v.slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function fechaRecibido(ts: string | null | undefined): string {
  if (!ts) return '';
  // `fecha_recepcion` es timestamp sin zona: ya está en hora local de México.
  return fechaCorta(ts);
}

function pagoTexto(g: Guia): string {
  if (g.pago == null && !g.estado_pago) return '';
  const partes: string[] = [];
  if (g.pago != null) partes.push(fmtMXN(g.pago));
  if (g.estado_pago) partes.push(g.estado_pago.toUpperCase());
  if (g.estado_pago === 'Pagado' && g.metodo_pago) partes.push(g.metodo_pago.toUpperCase());
  return partes.join(' · ');
}

function Renglon({ k, v, cls = '' }: { k: string; v: string | number | null | undefined; cls?: string }) {
  const texto = v === null || v === undefined || v === '' ? ' ' : String(v);
  return (
    <div className="g-r">
      <span className="g-k">{k}</span>
      <span className={`g-v ${cls}`}>{texto}</span>
    </div>
  );
}

function CodigoBarras({ valor }: { valor: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    try {
      JsBarcode(svg, valor, { format: 'CODE128', displayValue: false, margin: 0, height: 50, width: 2, background: '#ffffff', lineColor: '#000000' });
      const w = parseFloat(svg.getAttribute('width') ?? '0');
      const h = parseFloat(svg.getAttribute('height') ?? '0');
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'none');
    } catch (_) {
      // Si el código no se puede dibujar, la guía se imprime sin barras.
    }
  }, [valor]);
  return <svg ref={ref} className="g-bar" aria-hidden="true" />;
}

/** Guía de transportación en hoja de 4 × 6 pulgadas (101.6 × 152.4 mm), igual al formato original. */
export function GuiaHoja({ guia, config, etiqueta }: { guia: Guia; config: ConfigGuia | null; etiqueta: string }) {
  const h = config?.encabezado ?? {};
  const logo = h.logo && /^(data:image|https?:|\.\/|\/)/.test(h.logo) ? h.logo : null;
  const copia = etiqueta !== 'ORIGINAL';
  const ancho = config?.ancho_mm ?? 101.6;
  const alto = config?.alto_mm ?? 152.4;
  // La guía se diseña para 101.6 mm de ancho; en tamaños más grandes todo el contenido se escala con `zoom`.
  const escala = ancho / 101.6;
  const direccionEEUU = [guia.direccion_eeuu, [guia.ciudad, guia.estado].filter(Boolean).join(', '), guia.zip].filter(Boolean).join(', ');
  const detalle = [
    guia.bultos ? `${guia.bultos} bulto${guia.bultos > 1 ? 's' : ''}` : '',
    guia.peso_kg ? `${Number(guia.peso_kg).toFixed(2)} kg` : '',
    guia.valor_declarado_mxn ? `Valor decl. ${fmtMXN(guia.valor_declarado_mxn)}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <section className="guia" style={{ width: '101.6mm', height: `${alto / escala}mm`, zoom: escala, ...(escala > 1 ? { maxWidth: 'none', alignSelf: 'flex-start' } : {}) }} aria-label={`Guía ${guia.folio} ${etiqueta}`}>
      <div className="g-copy">{copia ? 'COPIA PARA EL CLIENTE' : 'ORIGINAL · PEGAR EN EL PAQUETE'}</div>
      <div className="g-frame">
        <div className="g-head">
          {logo && <img src={logo} alt="" />}
          <div className="g-htext">
            <div className="g-l1">{h.l1 ?? ''}</div>
            <div className="g-name">{h.name ?? 'ENVCA'}</div>
            <div className="g-slogan">{h.slogan ?? ''}</div>
            <div className="g-rfc">
              {h.rfc ? `R.F.C. ${h.rfc}` : ''}
              {h.rfc && h.titular ? ' · ' : ''}
              {h.titular ?? ''}
            </div>
          </div>
        </div>

        <div className="g-title">
          <div>
            <div className="g-tt">GUÍA DE TRANSPORTACIÓN</div>
            <CodigoBarras valor={guia.folio} />
          </div>
          <span className="g-no">Nº {guia.folio}</span>
        </div>
        {guia.anulada && <div className="g-cold">ANULADA</div>}

        <div className="g-2">
          <Renglon k="FECHA DE ENVÍO:" v={fechaCorta(guia.fecha_envio)} />
          <Renglon k="RECIBIDO:" v={fechaRecibido(guia.fecha_recepcion)} />
        </div>
        <Renglon k="NOMBRE DEL DESTINATARIO:" v={guia.destinatario} cls="big" />
        <Renglon k="DIRECCIÓN EN E.E.U.U.:" v={direccionEEUU} cls="l2 big" />
        <Renglon k="TELÉFONOS:" v={guia.destinatario_telefonos} />
        <Renglon k="MERCANCÍA ENVIADA:" v={guia.contenido} cls="l3" />
        {detalle && <Renglon k="DETALLE:" v={detalle} />}
        {guia.perecedero && <div className="g-cold">PERECEDERO · MANTENER EN FRÍO</div>}
        <Renglon k="PAGO POR ENVÍO:" v={pagoTexto(guia)} />
        <Renglon k="NOMBRE DEL REMITENTE:" v={guia.remitente} />
        <div className="g-2 wl">
          <Renglon k="No. DE IDENTIFICACIÓN:" v={guia.remitente_id} />
          <Renglon k="TEL:" v={guia.remitente_telefono} />
        </div>
        <Renglon k="DIRECCIÓN:" v={guia.remitente_direccion} />
        <Renglon k="MUNICIPIO:" v={guia.remitente_municipio} />

        {config?.nota && <div className="g-nota">{config.nota}</div>}

        <div className="g-sigs">
          <figure>
            <span className="g-st">FIRMA DE CONFORMIDAD</span>
            <div className="g-sigline" />
            <figcaption>REMITENTE</figcaption>
          </figure>
          <figure>
            <span className="g-st">RECIBIDO POR: {guia.recibe ?? ''}</span>
            <div className="g-sigline" />
            <figcaption>FIRMA · {guia.punto_recepcion ?? ''}</figcaption>
          </figure>
        </div>
        <div className="g-foot">{h.phones ?? ''}</div>
      </div>
    </section>
  );
}
