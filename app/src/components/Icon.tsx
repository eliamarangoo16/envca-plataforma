const P: Record<string, string> = {
  inicio: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  mas: 'M12 5v14M5 12h14',
  lista: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  usuario: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  usuarios: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20c0-3.5 3.2-5.5 7-5.5s7 2 7 5.5M17 4.5a3.5 3.5 0 010 6.5M19 14.8c1.8.7 3 2.2 3 4.7',
  guia: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  grafica: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  mapa: 'M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  ruta: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h6a3 3 0 000-6h-4a3 3 0 010-6h6',
  etiqueta: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  dinero: 'M3 7h18v10H3zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM6.5 10v4M17.5 10v4',
  caja: 'M3 8l9-5 9 5v9l-9 5-9-5zM3 8l9 5 9-5M12 13v9',
  descarga: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  imprimir: 'M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  sync: 'M20 11a8 8 0 00-14.5-3.5M4 4v4h4M4 13a8 8 0 0014.5 3.5M20 20v-4h-4',
  editar: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  salir: 'M9 4H4v16h5M16 8l4 4-4 4M20 12H9',
  cerrar: 'M6 6l12 12M18 6L6 18',
};

export function Icon({ n }: { n: keyof typeof P | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[n] ?? P.lista} />
    </svg>
  );
}
