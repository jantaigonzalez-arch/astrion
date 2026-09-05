/**
 * EL CASCO: LA MARCA DE LA CAPA DE INTELIGENCIA.
 *
 * Es la única señal fuerte de que se cruzó una frontera. La capa no cambia la
 * paleta ni la tipografía —eso se probó y sacaba al usuario del ERP en vez de
 * avisarle—, así que todo el peso de decir «esto es otra cosa» lo lleva esta
 * marca, y por eso es una marca y no un icono más del juego que usa el resto del
 * sistema.
 *
 * ── POR QUÉ UN CASCO Y NO UN ASTRONAUTA ENTERO ────────────────────────────
 *
 * Hubo una figura completa: casco, tronco, brazos, piernas y estela. Se veía
 * pasable a 96 px y era un garabato a 16, que es el tamaño al que de verdad vive
 * —el renglón de la barra lateral—. Ahí no hay arreglo posible: una figura
 * humana necesita seis trazos para leerse, y seis trazos en dieciséis píxeles
 * son manchas.
 *
 * El casco dice astronauta igual de rápido con dos formas, sobrevive al tamaño
 * chico y aguanta escalar sin volverse otra cosa.
 *
 * ── LAS TRES PIEZAS, Y NINGUNA SOBRA ──────────────────────────────────────
 *
 * El casco es UN SOLO trazado con `evenodd`: la esfera menos el visor. El visor
 * queda calado —no relleno de blanco— y por eso funciona sobre cualquier fondo,
 * claro u oscuro, sin declarar un color que habría que mantener en línea con el
 * tema.
 *
 * Dentro va el reflejo: una barra inclinada y un punto. Sin él la marca es un
 * aro con un hueco y podría ser un botón de encendido; con él, el hueco se lee
 * como cristal. Se comprobó rasterizando las dos versiones a 16, 20, 24, 36 y
 * 96 px, que es la única forma de saber esto —mirando el código las dos parecen
 * bien—.
 *
 * Todo con `currentColor`: hereda el color de donde se ponga y no hay que
 * declarar nada dos veces para claro y oscuro.
 */
export function Astronauta({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="currentColor"
      className={className}
      role="img"
      aria-label="Capa de inteligencia"
    >
      {/* La esfera menos el visor, de una pieza. `evenodd` es lo que convierte
          el segundo contorno en un hueco en vez de en una mancha encima. */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M24 3a21 21 0 1 1 0 42 21 21 0 0 1 0-42z
           M20.5 11.5h7a9 9 0 0 1 9 9v2.6c0 4.6-3.7 8.4-8.4 8.4h-8.2c-4.6 0-8.4-3.8-8.4-8.4v-2.6a9 9 0 0 1 9-9z"
      />
      {/* El reflejo del visor. Es lo que hace que el hueco se lea como cristal. */}
      <rect
        x="15.9"
        y="16.2"
        width="3"
        height="8"
        rx="1.5"
        transform="rotate(-32 17.4 20.2)"
      />
      <circle cx="21.6" cy="16.6" r="1.5" />
    </svg>
  );
}

/**
 * EL ASTRONAUTA ENTERO, para donde hay sitio.
 *
 * El casco de arriba es la marca chica —16 px en la barra lateral—; esto es la
 * misma figura completa, y va donde el espacio la deja respirar: la franja de la
 * capa y el estado vacío de Inteligencia.
 *
 * ── SOBREVIVE DESDE 24 px, Y ESO SE MIDIÓ ─────────────────────────────────
 *
 * La primera figura que dibujé era de línea y a 16 px era un garabato. Esta es
 * de formas macizas con contraste fuerte —visor casi negro sobre traje casi
 * blanco—, y eso es lo que la salva: rasterizada a 20, 24, 32, 48 y 72 px se
 * sigue leyendo como un astronauta a partir de 24. Por debajo va el casco.
 *
 * ── LOS COLORES SON FIJOS, Y ES CORRECTO QUE LO SEAN ──────────────────────
 *
 * No usa las variables del tema. Un traje espacial es blanco, el visor es
 * oscuro y las suelas son rojas: teñirlo de azul de marca lo convertiría en una
 * mancha azul con forma de muñeco. Funciona igual en claro y en oscuro porque el
 * blanco del traje contrasta con los dos fondos —comprobado en los dos—, y el
 * contorno gris claro es lo que lo despega del papel cuando el fondo es casi
 * blanco.
 *
 * Los tres puntos del pecho sí son los de la casa —azul, ámbar y rojo de
 * Astraion— y son el único guiño de marca que lleva.
 */
export function AstronautaCompleto({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={className} role="img" aria-label="Astronauta">
      {/* La manguera sale de la cadera y se enrosca. Va primero para que el
          guante le tape el nacimiento. */}
      <path
        d="M104 116c18 2 28 11 28 22 0 10-9 16-19 14"
        fill="none"
        stroke="#1d7fa8"
        strokeWidth={7}
        strokeLinecap="round"
      />
      {/* Hombros y mochila, detrás del torso. */}
      <rect x="56" y="62" width="48" height="22" rx="11" fill="#c9d2e0" />
      {/* Brazos y guantes. */}
      <rect x="44" y="72" width="13" height="38" rx="6.5" fill="#eef2f8" stroke="#c9d2e0" strokeWidth={1.4} />
      <rect x="103" y="72" width="13" height="38" rx="6.5" fill="#eef2f8" stroke="#c9d2e0" strokeWidth={1.4} />
      <rect x="42" y="104" width="17" height="17" rx="7" fill="#b9c3d3" />
      <rect x="101" y="104" width="17" height="17" rx="7" fill="#b9c3d3" />
      {/* Piernas y botas, con la suela roja. */}
      <rect x="65" y="106" width="13" height="34" rx="6" fill="#eef2f8" stroke="#c9d2e0" strokeWidth={1.4} />
      <rect x="82" y="106" width="13" height="34" rx="6" fill="#eef2f8" stroke="#c9d2e0" strokeWidth={1.4} />
      <rect x="62" y="132" width="18" height="14" rx="5" fill="#f7f9fc" stroke="#c9d2e0" strokeWidth={1.4} />
      <rect x="80" y="132" width="18" height="14" rx="5" fill="#f7f9fc" stroke="#c9d2e0" strokeWidth={1.4} />
      <rect x="62" y="141" width="18" height="5" rx="2.5" fill="#f2604a" />
      <rect x="80" y="141" width="18" height="5" rx="2.5" fill="#f2604a" />
      {/* Torso, encima de brazos y piernas para tapar sus arranques. */}
      <rect x="57" y="70" width="46" height="44" rx="15" fill="#f7f9fc" stroke="#c9d2e0" strokeWidth={1.4} />
      {/* El panel del pecho: el único guiño a la marca. */}
      <rect x="68" y="79" width="24" height="14" rx="4" fill="#e3e9f3" />
      <circle cx="74.5" cy="86" r="2.7" fill="#2f5fd0" />
      <circle cx="80" cy="86" r="2.7" fill="#e8b023" />
      <circle cx="85.5" cy="86" r="2.7" fill="#f2604a" />
      <path d="M60 108h40" stroke="#c9d2e0" strokeWidth={3.4} strokeLinecap="round" />
      {/* El casco, al final: encima de todo. */}
      <circle cx="80" cy="44" r="26" fill="#f7f9fc" stroke="#c9d2e0" strokeWidth={1.4} />
      <path
        d="M80 26c11.6 0 21 8.4 21 18.8 0 5.6-2.8 9.8-7.8 9.8H66.8c-5 0-7.8-4.2-7.8-9.8C59 34.4 68.4 26 80 26z"
        fill="#2b3446"
      />
      {/* El destello del visor, en el mismo sitio que en la marca chica: es lo
          que hace que las dos se lean como el mismo personaje. */}
      <circle cx="70.5" cy="36" r="4.3" fill="#5c6b86" />
    </svg>
  );
}
