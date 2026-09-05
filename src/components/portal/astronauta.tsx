/**
 * EL ASTRONAUTA: LA MARCA DE LA CAPA DE INTELIGENCIA.
 *
 * Es la única señal fuerte de que se cruzó una frontera. La capa no cambia la
 * paleta ni la tipografía —eso se probó y sacaba al usuario del ERP en vez de
 * avisarle—, así que todo el peso de decir «esto es otra cosa» lo lleva este
 * dibujo, y por eso es un dibujo y no un icono más del juego que usa el resto
 * del sistema.
 *
 * ── POR QUÉ UN ASTRONAUTA ─────────────────────────────────────────────────
 *
 * Porque describe exactamente lo que pasa aquí: se está fuera del suelo firme.
 * Todo lo demás del ERP pisa datos capturados; esta capa flota sobre
 * estimaciones. Que la figura esté en el aire —y no de pie— es el argumento
 * entero, y por eso se mueve despacio en vez de quedarse quieta.
 *
 * ── ORIGINAL, Y ESO IMPORTA ───────────────────────────────────────────────
 *
 * Está inspirado en el aire de las marcas de herramientas de agentes, pero
 * dibujado desde cero: copiar el logotipo de otra empresa en el producto de un
 * cliente sería apropiarse de su identidad, y además ata a Astraion a una marca
 * que no controla.
 *
 * ── DIBUJADO CON `currentColor` Y SIN RELLENO OPACO ───────────────────────
 *
 * Hereda el color de donde se ponga y funciona igual en claro y en oscuro sin
 * declarar nada dos veces. El casco lleva un brillo a media opacidad en vez de
 * un blanco fijo, que en modo oscuro se vería como un agujero.
 */
export function Astronauta({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label="Capa de inteligencia"
    >
      {/*
        LOS MIEMBROS SE DIBUJAN CON TRAZO GRUESO Y PUNTA REDONDA, no con
        contornos. Un contorno de dos líneas por brazo se convierte en ruido por
        debajo de 24 px, que es el tamaño al que esto vive en la barra lateral;
        una línea gruesa con la punta redonda da el mismo volumen y sobrevive.
      */}

      {/* La estela: de dónde viene. Se apaga hacia atrás. */}
      <g strokeWidth={2}>
        <path d="M12.5 34c-2.4 1.5-4.5 3.4-6.2 5.7" opacity="0.3" />
        <path d="M8.5 29.5c-1.8.8-3.4 1.8-4.9 3" opacity="0.19" />
        <path d="M17 38.5c-1.7 1.7-3.1 3.7-4.3 5.8" opacity="0.13" />
      </g>

      {/* La mochila, detrás del cuerpo y desplazada hacia su espalda —abajo a la
          izquierda—, no debajo del casco: ahí se leía como una sombra. */}
      <path d="M19.5 22.5 24 29.5" strokeWidth={9.5} opacity="0.2" />

      {/* El tronco. LARGO, y ahí está media pelea del dibujo: con un tronco
          corto el casco domina y la figura se lee como una cabeza con patas. */}
      <path d="M21 20.5 27.5 30.5" strokeWidth={6.6} opacity="0.92" />

      {/* Brazos desde el hombro: el adelantado abre camino, el de atrás sigue. */}
      <path d="M22.8 22c4-3 8.2-4.4 12.4-4.1" strokeWidth={3.3} />
      <path d="M22.2 26.5c-2.9 1.4-5.6 3-8 5" strokeWidth={3.1} opacity="0.85" />

      {/* Piernas desde la cadera: una estirada y la otra recogida. Nadie flota
          con las dos iguales — es lo que separa a esta figura de una de pie. */}
      <path d="M28 30.8c2 2.6 4.3 5 6.8 7.2" strokeWidth={3.7} />
      <path d="M25.6 32c.3 3.3 0 6.5-1 9.6" strokeWidth={3.3} opacity="0.85" />

      {/* EL CASCO, AL FINAL: tapa el arranque del tronco y queda encima de todo.
          Relleno translúcido con el mismo color en vez de un blanco fijo —un
          blanco se vería como un agujero en modo oscuro—. */}
      <circle cx="18" cy="14" r="5.8" fill="currentColor" fillOpacity="0.14" strokeWidth={2.1} />
      {/* El reflejo del visor: la única marca que dice que es un casco y no una
          cabeza. */}
      <path d="M15.2 11.6a3.9 3.9 0 0 1 3.8-1.6" strokeWidth={1.7} opacity="0.6" />

      {/* La estrella hacia la que va. Sin ella la figura está a la deriva; con
          ella, tiene rumbo — que es lo que se quiere decir de esta capa. */}
      <path d="M40 9v4.4M37.8 11.2h4.4" strokeWidth={2} opacity="0.5" />
    </svg>
  );
}
