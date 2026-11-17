import { fmtMXN, fmtNum3 } from '../lib/money';
import { fechaHoraLocal, fechaLarga } from '../lib/time';
import type { ConfigGuia, Guia } from '../lib/types';

function F({ k, v }: { k: string; v: string | number | null | undefined }) {
  if (v === null || v === undefined || v === '') return null;
  return <div className="f"><span>{k}</span><b>{v}</b></div>;
}

/** Una hoja de guía para papel térmico de 80 mm (ancho útil 72 mm). */
export function GuiaHoja({ guia, config, etiqueta }: { guia: Guia; config: ConfigGuia | null; etiqueta: string }) {
  const h = config?.encabezado ?? {};
  const logo = h.logo && /^(data:image|https?:|\.\/|\/)/.test(h.logo) ? h.logo : null;
  const destino = [guia.ciudad, guia.estado, guia.zip].filter(Boolean).join(', ');
  return (
    <section className="hoja" aria-label={`Guía ${guia.folio} ${etiqueta}`}>
      <div className="tag">{etiqueta}</div>
      {logo && <img className="logo" src={logo} alt="" />}
      <div className="c">
        <div className="nm">{h.name || 'ENVCA'}</div>
        {h.l1 && <div>{h.l1}</div>}
        {h.slogan && <div><i>{h.slogan}</i></div>}
        {h.titular && <div>{h.titular}</div>}
        {h.rfc && <div>RFC: {h.rfc}</div>}
        {h.phones && <div>Tel: {h.phones}</div>}
      </div>
      <hr />
      <div className="folio">{guia.folio}</div>
      {guia.anulada && <div className="anulada">ANULADA</div>}
      <hr />
      <F k="Recepción" v={fechaHoraLocal(guia.fecha_recepcion)} />
      <F k="Envío" v={guia.fecha_envio ? fechaLarga(guia.fecha_envio) : ''} />
      <F k="Sucursal" v={guia.sucursal} />
      <hr />
      <div><b>REMITENTE</b></div>
      <div>{guia.remitente}</div>
      <F k="Tel" v={guia.remitente_telefono} />
      <F k="Municipio" v={guia.remitente_municipio} />
      <hr />
      <div><b>DESTINATARIO</b></div>
      <div>{guia.destinatario}</div>
      <F k="Tel" v={guia.destinatario_telefonos} />
      <div>{guia.direccion_eeuu}</div>
      <div>{destino}</div>
      <hr />
      <div><b>PAQUETE</b></div>
      <div>{guia.contenido}</div>
      <F k="Bultos" v={guia.bultos} />
      <F k="Peso" v={guia.peso_kg != null ? `${fmtNum3(guia.peso_kg)} kg` : ''} />
      <F k="Perecedero" v={guia.perecedero ? 'Sí' : 'No'} />
      <F k="Valor decl." v={guia.valor_declarado_mxn ? fmtMXN(guia.valor_declarado_mxn) : ''} />
      {guia.notas && <div>Notas: {guia.notas}</div>}
      <hr />
      <F k="Tarifa/kg" v={guia.tarifa_por_kg != null ? fmtMXN(guia.tarifa_por_kg) : ''} />
      <div className="f total"><span>TOTAL</span><b>{fmtMXN(guia.pago)}</b></div>
      <F k="Método" v={guia.metodo_pago} />
      <F k="Pago" v={guia.estado_pago} />
      <hr />
      {config?.nota && <div className="nota">{config.nota}</div>}
      <div className="firma">Firma de conformidad</div>
    </section>
  );
}
