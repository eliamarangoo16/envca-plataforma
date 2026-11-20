export type Rol = 'administrador' | 'admin_n2' | 'rutero' | 'sucursal';

export const ROL_NOMBRE: Record<Rol, string> = {
  administrador: 'Administrador nivel 1',
  admin_n2: 'Administrador nivel 2',
  rutero: 'Rutero',
  sucursal: 'Agente de caja',
};

export interface Perfil {
  id: string;
  nombre: string | null;
  sucursal: string | null;
  rol: Rol;
  activo: boolean;
  /** Administrador principal: único que da de baja usuarios, cambia el contenido del formato de guías y ve la bitácora de tarifas. */
  super_admin?: boolean;
  email?: string | null;
}

export interface Localidad {
  id: string;
  nombre: string;
  municipio: string | null;
  referencia: string | null;
  tiene_punto_recepcion: boolean;
  activa: boolean;
  creada_por?: string | null;
  creada_en?: string | null;
  /** Solo en cliente: aún no confirmada por el servidor. */
  pendiente?: boolean;
}

export interface Ruta { id: string; nombre: string; activa: boolean | null; creada_en?: string | null }
export interface RutaLocalidad { ruta_id: string; localidad_id: string; dia_semana: number | null; orden: number | null }
export interface RutaRutero { ruta_id: string; usuario_id: string }

export type TipoConteo = 'recepcion' | 'salida';
export interface Conteo {
  id: string;
  tipo: TipoConteo;
  fecha: string;
  ruta_id: string | null;
  localidad_id: string;
  cantidad: number;
  notas: string | null;
  usuario_id: string;
  capturado_en: string | null;
  creado_en?: string | null;
}

export interface Tarifa {
  id: string;
  destino: string;
  precio_por_kg: number | null;
  moneda: string;
  activa: boolean | null;
  actualizada_en?: string | null;
}

export interface Guia {
  id: string;
  folio: string;
  sucursal: string;
  creada_por: string | null;
  creada_en: string | null;
  modificada_en: string | null;
  anulada: boolean | null;
  fecha_recepcion: string | null;
  fecha_envio: string | null;
  remitente: string | null;
  remitente_telefono: string | null;
  remitente_id: string | null;
  remitente_municipio: string | null;
  remitente_direccion: string | null;
  destinatario: string | null;
  destinatario_telefonos: string | null;
  direccion_eeuu: string | null;
  ciudad: string | null;
  estado: string | null;
  zip: string | null;
  contenido: string | null;
  bultos: number | null;
  peso_kg: number | null;
  valor_declarado_mxn: number | null;
  perecedero: boolean | null;
  pago: number | null;
  moneda: string | null;
  estado_pago: string | null;
  metodo_pago: string | null;
  recibe: string | null;
  punto_recepcion: string | null;
  notas: string | null;
  tarifa_id?: string | null;
  tarifa_por_kg?: number | null;
}

export interface ConfigGuia {
  id: number;
  encabezado: { name?: string; l1?: string; slogan?: string; phones?: string; rfc?: string; titular?: string; logo?: string } | null;
  nota: string | null;
  ancho_mm?: number | null;
  alto_mm?: number | null;
}

export const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Zelle'] as const;
export const ESTADOS_PAGO = ['Pagado', 'Por cobrar en destino'] as const;
