-- EL BLOQUEO ES DE CADA RUBRO, NO DE LA EMPRESA.
--
-- La 0030 lo puso en `settings` y duró un día. El error se ve en cuanto alguien
-- intenta usarlo: una empresa no tiene UNA postura sobre pasarse del
-- presupuesto, tiene una por concepto. El hotel se cotiza antes de viajar y el
-- tope es un tope; la comida depende de dónde se pare uno a comer y el tope es
-- una guía. Con un solo interruptor hay que elegir cuál de las dos se trata mal:
-- o el hotel deja de controlarse, o la comida bloquea a un ingeniero por
-- cuarenta pesos en una carretera.
--
-- Es el mismo error que la 0029 corrigió con las categorías, una vuelta más
-- abajo: una decisión que es de cada renglón, tomada para todos a la vez.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UNA MIGRACIÓN NUEVA Y NO CORREGIR LA 0030
--
-- Porque la 0030 ya corrió: en la copia local, y en cualquier máquina donde
-- alguien haya hecho `tenant.ts migrate` desde entonces. Reescribirla dejaría
-- esas bases con una columna que el código ya no conoce y sin la que sí
-- necesita, y `migrated_version` diría que están al día. Las migraciones de
-- este repositorio van hacia adelante incluso cuando lo que cambian es una
-- decisión de ayer — la 0027 rehízo el índice de la 0026 y la 0029 deshizo su
-- enum.
--
-- ---------------------------------------------------------------------------
-- APAGADO DE FÁBRICA, INCLUIDOS LOS CINCO DE SIEMPRE
--
-- Nadie estrena un bloqueo por haber actualizado. Los cinco rubros sembrados y
-- los que cada empresa haya creado nacen y siguen en «avisa y marca», que es
-- como se comportaban hasta ahora. Encenderlo es una decisión que se toma
-- rubro a rubro, mirando la pantalla.
--
-- `settings.viaticos_bloquea_exceso` se borra en vez de dejarse: dos sitios que
-- contestan la misma pregunta acaban contestándola distinto, y entonces ninguna
-- consulta sabe a cuál creerle. Nunca llegó a producción, así que no hay nada
-- que preservar.
--
-- ---------------------------------------------------------------------------
-- ESCRITA A MANO. Ver la regla 4 de AGENTS.md — vale para las dos carpetas.

/*
  Lo que decide es si el tope de ESTE rubro se hace cumplir. La cuenta no
  cambia: suma del rubro en todo el viaje contra presupuesto × días, la misma
  que pinta el aviso. Un rubro sin `daily_budget_mxn` no bloquea aunque esto
  esté encendido — no hay contra qué comparar.
*/
ALTER TABLE "viatico_rubros" ADD COLUMN "blocks_over_budget" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "settings" DROP COLUMN "viaticos_bloquea_exceso";
