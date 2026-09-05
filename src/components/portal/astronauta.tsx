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
