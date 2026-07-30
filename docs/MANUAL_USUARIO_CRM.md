# Manual de usuario — Portal Evoelution

> Guía práctica para el equipo comercial y de soporte.
> Todo lo que puedes hacer en el portal, paso a paso, sin tecnicismos.

---

## Índice

1. [Entrar al portal](#1-entrar-al-portal)
2. [Qué ve cada rol](#2-qué-ve-cada-rol)
3. [El embudo comercial (CRM)](#3-el-embudo-comercial-crm)
4. [Negocios](#4-negocios)
5. [Organizaciones y contactos](#5-organizaciones-y-contactos)
6. [Actividades (tu agenda)](#6-actividades-tu-agenda)
7. [De lead web a negocio](#7-de-lead-web-a-negocio)
8. [De negocio ganado a contrato](#8-de-negocio-ganado-a-contrato)
9. [Vista 360 del cliente](#9-vista-360-del-cliente)
10. [Informes y análisis](#10-informes-y-análisis)
11. [Objetivos](#11-objetivos)
12. [Plantillas de correo](#12-plantillas-de-correo)
13. [Automatizaciones](#13-automatizaciones)
14. [Configuración del embudo y etiquetas](#14-configuración-del-embudo-y-etiquetas)
15. [Buscar](#15-buscar)
16. [Exportar a Excel](#16-exportar-a-excel)
17. [Preguntas frecuentes](#17-preguntas-frecuentes)

---

## 1. Entrar al portal

1. Abre el portal y pulsa **Iniciar sesión**.
2. Escribe tu **correo** y tu **contraseña**.
3. Entrarás al **Panel**, tu página de inicio.

El menú lateral izquierdo cambia según tu rol. Si no ves una sección, es porque tu perfil no tiene acceso a ella.

> **Consejo**: puedes cambiar entre **español** e **inglés** y entre **modo claro** y **oscuro** desde la barra superior.

---

## 2. Qué ve cada rol

| Rol | Qué puede hacer |
|---|---|
| **Cliente** (laboratorio) | Ver y abrir sus propios tickets de soporte. |
| **Agente** (soporte) | Atender la cola de tickets, registrar servicios y refacciones. |
| **Vendedor** | Todo el **CRM** (su cartera), contratos y leads. |
| **Administrador** | Todo lo anterior, sin restricción, más configuración y usuarios. |

**Regla importante del CRM:** el **vendedor ve solo sus negocios**; el **administrador ve los de todo el equipo** y puede filtrar a los suyos con el botón *"Ver solo los míos"*.

---

## 3. El embudo comercial (CRM)

Menú: **CRM → Embudo**

Es tu tablero principal. Cada columna es una **etapa** del proceso de venta y cada tarjeta es un **negocio** (una oportunidad).

### Las 5 etapas por defecto

| Etapa | Probabilidad de cierre |
|---|---|
| Prospección | 10 % |
| Contacto establecido | 25 % |
| Necesidad detectada | 45 % |
| Cotización enviada | 65 % |
| Negociación | 85 % |

### Mover un negocio

**Arrastra la tarjeta** con el ratón y suéltala en otra columna. Se guarda solo — verás brevemente el aviso *"Guardando…"*. No hay que pulsar ningún botón.

### Qué muestra cada columna

En la cabecera de cada etapa verás:
- **El número de negocios** en esa etapa.
- **El valor total** en pesos.
- **El valor ponderado**: el total multiplicado por la probabilidad de la etapa. Es el pronóstico realista — lo que de verdad se espera cerrar.

> **Ejemplo**: 132,500 $ en "Cotización enviada" (65 %) → ponderado = **86,125 $**.

### Los 4 indicadores de arriba

- **Negocios abiertos** — cuántos hay activos y cuánto suman.
- **Ganados** — cuántos cerraste y por cuánto.
- **Tasa de cierre** — porcentaje de ganados sobre el total de cerrados.
- **Actividades vencidas** — tareas cuya fecha ya pasó y siguen pendientes. **Si este número sube, revisa tu agenda.**

### Tarjetas en rojo (negocios estancados)

Si una tarjeta aparece con **borde rojo** y la leyenda *"Estancado X d"*, significa que ese negocio lleva más días sin movimiento de los permitidos en su etapa. Es un recordatorio para retomarlo.

*(El límite de días lo configura el administrador en cada etapa; ver [sección 14](#14-configuración-del-embudo-y-etiquetas)).*

### Cerrados recientemente

Abajo del tablero hay una tabla con los últimos negocios **ganados** y **perdidos**, con su valor y su motivo.

---

## 4. Negocios

### Crear un negocio

1. En el embudo, pulsa **Nuevo negocio**.
2. Rellena:
   - **Título** — descríbelo claro. Ej. *"Contrato anual de mantenimiento HPLC (3 equipos)"*.
   - **Etapa** — en qué punto está.
   - **Responsable comercial** — si lo dejas vacío, queda a tu nombre.
   - **Organización** y **Contacto** — al elegir la organización, la lista de contactos se filtra sola.
   - **Valor (MXN / USD)**.
   - **Cierre estimado** — la fecha en que esperas cerrarlo. *Importante para el pronóstico.*
   - **Origen** — de dónde vino (referido, web, congreso…).
3. Pulsa **Crear negocio**.

Se le asigna un folio automático: **EVO-D-000001**, **EVO-D-000002**, etc.

### La ficha de un negocio

Pulsa el título de cualquier tarjeta para abrirla. Verás:

**Columna principal**

- **Productos y servicios** — las líneas de tu cotización. Puedes elegir del catálogo (productos y refacciones) o escribir el concepto a mano; indicas cantidad, precio unitario y descuento. **El valor del negocio se recalcula solo** con la suma de las líneas.
- **Actividades** — la agenda de ese negocio. Puedes agendar una nueva desde ahí mismo y marcar como completada con la casilla.
- **Notas** — el registro de la conversación: acuerdos, objeciones, resultados de llamadas.
- **Avance del negocio** — la bitácora automática: quién lo movió de etapa, cuándo y a dónde. No se puede editar; es tu historial auditable.

**Panel lateral**

- **Valor** y su equivalente ponderado.
- **Marcar ganado / Marcar perdido** — al marcar perdido te pide el **motivo** (es obligatorio y alimenta los informes).
- **Contrato** *(solo si el negocio está ganado)* — el botón para generar el contrato. Ver [sección 8](#8-de-negocio-ganado-a-contrato).
- **Etiquetas** — pulsa una etiqueta para ponerla o quitarla. Se ven en la tarjeta del tablero.
- **Correo** — elige una plantilla y pulsa *Redactar correo*: se abre tu programa de correo con todo prellenado. Ver [sección 12](#12-plantillas-de-correo).
- **Detalles** — responsable, fecha de cierre, origen, y el lead de origen si vino de la web.

### Editar o eliminar

- **Editar** — botón arriba a la derecha de la ficha.
- **Eliminar** — solo el administrador. Es permanente.

---

## 5. Organizaciones y contactos

**Organización** = el laboratorio o la empresa.
**Contacto** = la persona con la que hablas dentro de esa organización.

### Registrar una organización

Menú: **CRM → Organizaciones → Nueva organización**

Puedes darla de alta **aunque todavía no sea cliente**. Los campos importantes:

- **Nombre**, **giro**, **teléfono**, **sitio web**, **dirección**.
- **Responsable comercial**.
- **Cuenta de portal** — enlázala aquí **cuando ya sea cliente**. Esto es lo que activa la vista 360 (ver [sección 9](#9-vista-360-del-cliente)) y permite generar contratos.

### Editar una organización

Abre su ficha y pulsa **Editar** (arriba a la derecha). Puedes cambiar cualquier
dato, incluido el vínculo con la cuenta de portal.

### Vincular la cuenta de portal ⭐

Este es el paso que convierte una organización del CRM en un **cliente conectado**
con el resto del portal. Hazlo cuando el laboratorio ya sea cliente.

El vínculo se puede hacer **desde los dos lados**: desde la organización del CRM
(eliges la cuenta) o desde la cuenta de usuario (eliges la organización). El
resultado es el mismo; usa el que te quede más a mano.

#### Camino A — desde el CRM (eliges la cuenta de portal)

| Desde dónde | Qué pulsar |
|---|---|
| El aviso *"aún no está vinculada"* en su ficha | **Vincular cuenta de portal** |
| La cabecera de su ficha | **Editar** |
| Un negocio ganado, en el panel *Contrato* | **Vincular cuenta de portal** |

1. En el formulario, busca el campo **"Cuenta de portal (si ya es cliente)"**.
2. Despliega la lista y elige el laboratorio.
3. Pulsa **Guardar cambios**.

> **Si el laboratorio no aparece en la lista**, es porque todavía no tiene cuenta
> en el portal. Pídele al administrador que la cree en
> **Administración → Usuarios**; solo salen las cuentas con rol *cliente* que
> estén activas.

#### Camino B — desde Usuarios (eliges la organización) 🆕

Útil cuando acabas de dar de alta la cuenta del laboratorio y quieres enlazarla
sin salir de la pantalla de administración.

Menú: **Administración → Usuarios**

1. La tabla tiene una columna **CRM** que te dice de un vistazo cómo está cada cuenta:
   - **nombre de la organización** (en azul) → ya está vinculada; el enlace te lleva a su ficha comercial.
   - **⚠ Sin vincular** (en ámbar) → es un cliente que todavía no tiene ficha en el CRM asociada. Púlsalo y te lleva directo a editarlo.
   - **—** → no aplica (cuentas de admin, agente o vendedor).
2. Ya en **Editar cuenta**, busca el bloque **Organización del CRM** (solo aparece
   si el rol es *Cliente*).
3. Elige la organización en la lista, o **— Sin vincular —** para deshacer el enlace.
4. Pulsa **Guardar cambios**.

> **Una cuenta, una organización.** Si eliges una organización que ya estaba
> enlazada a otra cuenta —o si la cuenta ya tenía otra ficha asignada—, el sistema
> suelta el vínculo anterior automáticamente. No hace falta que lo limpies a mano.

**Qué se desbloquea al vincularla (por cualquiera de los dos caminos):**

- La ficha muestra el bloque **Relación como cliente**: sus contratos, equipos y
  tickets recientes.
- Aparece la insignia verde **Cliente del portal**.
- Se habilita **Generar contrato** desde los negocios ganados.
- En **Usuarios**, la columna *CRM* pasa de *Sin vincular* al nombre de la organización.

### Registrar un contacto

Menú: **CRM → Contactos → Nuevo contacto**

Nombre, puesto, correo, teléfono y a qué organización pertenece. También puedes crearlo directamente desde la ficha de una organización con **+ Agregar contacto**.

---

## 6. Actividades (tu agenda)

Menú: **CRM → Actividades**

Aquí ves **todo lo que tienes que hacer**, ordenado por vencimiento y con las vencidas marcadas en rojo.

### Tipos de actividad

Llamada · Reunión · Correo · Tarea · Demostración · **Visita al laboratorio**

### Agendar

Se agenda desde la ficha de un negocio o de una organización: eliges el tipo, escribes el asunto y pones la fecha y hora de vencimiento.

### Filtros

- **Pendientes** / **Todas**
- **Solo mías** *(el administrador puede ver las de todo el equipo)*

### Completar

Pulsa la **casilla** a la izquierda. Se marca en verde y el texto se tacha. Si te equivocas, vuelve a pulsarla para reabrirla.

> **Buena práctica**: no cierres una llamada sin agendar el siguiente paso. Un negocio sin actividad pendiente es un negocio que se enfría.

---

## 7. De lead web a negocio

Cuando alguien llena el **formulario de contacto** de la web, aparece en **Leads**.

Menú: **Leads**

1. Revisa el mensaje del interesado.
2. Pulsa **Convertir**.
3. El sistema crea automáticamente:
   - la **organización** (si el lead puso empresa y no existía ya),
   - el **contacto** con su nombre y correo,
   - el **negocio**, colocado en la primera etapa del embudo y a tu nombre.
4. Te lleva directo a la ficha del negocio nuevo.

Los leads ya convertidos se marcan con **✓ En el embudo** para que no los conviertas dos veces.

---

## 8. De negocio ganado a contrato

Este es el paso que conecta el CRM con la operación.

1. En la ficha del negocio, pulsa **Marcar ganado**.
2. Aparece el panel **Contrato** en el lateral. Pueden pasar tres cosas:

   | Situación | Qué verás |
   |---|---|
   | El negocio no tiene organización | *"Asigna una organización al negocio"* |
   | La organización no está enlazada a una cuenta de portal | Botón **Vincular cuenta de portal** → te lleva a editarla ([ver cómo](#vincular-la-cuenta-de-portal-)) |
   | Todo listo *(y eres admin)* | Botón **Generar contrato** |

3. Al pulsar **Generar contrato**, el formulario llega **prellenado**:
   - Número sugerido (ej. `EVO-C-2026-000001`)
   - Laboratorio
   - Vendedor responsable
   - Importe
   - Una nota indicando de qué negocio salió
4. Ajusta lo que haga falta (vigencia, equipos amparados) y guarda.

A partir de ahí:
- La ficha del **negocio** muestra el contrato generado, con enlace directo.
- La ficha del **contrato** muestra el **negocio de origen**.

Así queda la trazabilidad completa: **Lead → Negocio → Contrato → Equipos → Tickets**.

---

## 9. Vista 360 del cliente

Abre cualquier **organización** que esté enlazada a una cuenta de portal. Verás el bloque **Relación como cliente** con tres columnas:

- **Contratos** — los contratos vigentes y su importe.
- **Equipos** — los equipos registrados y cuántos módulos tiene cada uno.
- **Tickets recientes** — los últimos tickets de soporte que abrió.

Es la foto completa de la cuenta en una sola pantalla: lo comercial y lo operativo juntos.

> Si la organización **no** está enlazada, en lugar de esos datos verás un aviso
> con el botón **Vincular cuenta de portal**. Son dos clics:
> [cómo vincularla](#vincular-la-cuenta-de-portal-).

---

## 10. Informes y análisis

Menú: **CRM → Informes**

### Los 4 indicadores

- **Pronóstico ponderado** — lo que se espera cerrar, sumando cada negocio abierto por la probabilidad de su etapa.
- **Tasa de cierre** — ganados frente a perdidos.
- **Ciclo de venta** — cuántos días tarda en promedio un negocio desde que se crea hasta que se cierra.
- **Negocios estancados** — cuántos superaron su límite de días sin movimiento.

### Los 6 gráficos

| Informe | Para qué sirve |
|---|---|
| **Embudo por etapa** | Ver dónde se acumula el valor y dónde se atasca el proceso. |
| **Ganado por mes** | La tendencia de los últimos 12 meses. |
| **Ranking por monto ganado** | Quién está vendiendo más en el equipo. |
| **Pronóstico por mes de cierre** | Cuánto entra cada mes, según las fechas estimadas. |
| **Motivos de pérdida** | Por qué se pierden los negocios (precio, competencia, presupuesto…). |
| **Origen de las oportunidades** | Qué canal te trae mejor negocio. |

Abajo, si hay negocios estancados, aparece la lista con cuántos días lleva cada uno parado.

> El administrador puede alternar entre **todo el equipo** y **solo sus datos**.

---

## 11. Objetivos

Menú: **CRM → Objetivos**

Metas comerciales con barra de avance. El avance se calcula **solo**, contando los negocios marcados como ganados dentro del periodo.

Puedes fijar el objetivo por:
- **Ingresos ganados (MXN)** — un monto a alcanzar.
- **Negocios ganados** — un número de cierres.

Y acotarlo por **vendedor** (o dejarlo para todo el equipo), por **embudo** y por **periodo** (fecha de inicio y fin).

Cuando se alcanza, la barra se pone **verde** con la leyenda *"objetivo alcanzado"*.

*Crear y eliminar objetivos es exclusivo del administrador.*

---

## 12. Plantillas de correo

Menú: **CRM → Plantillas**

Textos reutilizables para el seguimiento comercial, para no reescribir lo mismo cada vez.

### Marcadores disponibles

Escribe estos códigos en el asunto o el cuerpo y se rellenan solos con los datos del negocio:

| Marcador | Se reemplaza por |
|---|---|
| `{{contacto}}` | Nombre del contacto |
| `{{organizacion}}` | Nombre de la organización |
| `{{negocio}}` | Título del negocio |
| `{{valor}}` | Valor del negocio en MXN |
| `{{yo}}` | Tu nombre |

### Ejemplo

> **Asunto:** Seguimiento a tu cotización — `{{organizacion}}`
>
> Hola `{{contacto}}`:
> Te escribo para dar seguimiento a la propuesta de `{{negocio}}` por `{{valor}}`.
> Quedo atento a tus comentarios.
> Saludos, `{{yo}}`

### Cómo usarla

En la ficha de un negocio → panel **Correo** → elige la plantilla → **Redactar correo**. Se abre tu programa de correo habitual con el destinatario, asunto y texto ya puestos. Tú revisas y envías.

> El correo **sale desde tu cuenta**, no desde el sistema. El portal solo prepara el borrador.

---

## 13. Automatizaciones

Menú: **CRM → Automatizaciones** *(solo administrador)*

Reglas del tipo: **"cuando un negocio entre a la etapa X, crea automáticamente la actividad Y"**.

### Crear una regla

1. Ponle un **nombre** (ej. *"Seguimiento tras cotizar"*).
2. Elige **la etapa que la dispara**.
3. Define la actividad que se creará: **tipo**, **asunto** y **en cuántos días vence**.

A partir de ahí, cada vez que un negocio llegue a esa etapa —arrastrándolo, editándolo o al crearlo— la actividad aparece sola en la agenda del responsable.

Puedes **pausar** una regla sin borrarla.

> **Ejemplo real**: *Al entrar a "Cotización enviada" → crear llamada "Confirmar recepción de la cotización", vence en 2 días.* Así ninguna cotización se queda sin seguimiento.

---

## 14. Configuración del embudo y etiquetas

Menú: **CRM → Embudos** *(solo administrador)*

### Etapas

Para cada etapa puedes ajustar:

- **Nombre**
- **Probabilidad %** — alimenta el pronóstico ponderado.
- **Estanca a los… (días)** — tras cuántos días sin movimiento la tarjeta se marca en rojo. Pon **0** para desactivarlo.

Con las flechas **▲ ▼** cambias el orden de las etapas. Con el bote de basura las eliminas — **solo si están vacías**; si tiene negocios, muévelos antes. Es una protección para que no se pierda nada.

Abajo puedes **agregar** una etapa nueva.

### Etiquetas

Marcas de color para clasificar negocios (*urgente*, *licitación*, *renovación*…). Eliges nombre y color de la paleta: azul, cian, verde, ámbar, rojo o gris.

Se aplican desde la ficha de cada negocio y se ven en las tarjetas del tablero.

---

## 15. Buscar

Menú: **CRM → Buscar**

Escribe al menos **2 caracteres** y busca a la vez en:

- **Negocios** — por título o por folio (*EVO-D-000004*)
- **Organizaciones** — por nombre o giro
- **Contactos** — por nombre, correo o teléfono
- **Actividades** — por asunto

Los resultados salen agrupados y cada uno lleva enlace directo a su ficha.

> La búsqueda queda guardada en la dirección de la página, así que puedes **compartir el enlace** con un compañero.

---

## 16. Exportar a Excel

Desde **Informes**, el botón **Exportar CSV** descarga tus negocios en un archivo que abre directo en Excel.

También hay exportación de **organizaciones** y **contactos**.

- Los archivos salen con acentos correctos y nombre con fecha: `evoelution-negocios-2026-07-26.csv`.
- **El vendedor exporta solo su cartera**; el administrador, todo.

---

## 17. Preguntas frecuentes

**Arrastré una tarjeta a otra etapa, ¿tengo que guardar?**
No. Se guarda automáticamente al soltarla.

**¿Por qué no puedo eliminar una etapa?**
Porque tiene negocios dentro. Muévelos a otra etapa primero; es una protección para no perder información.

**¿Por qué mi negocio no aparece en el pronóstico?**
Porque le falta la **fecha de cierre estimado**. El pronóstico agrupa por mes de cierre, así que sin esa fecha no puede clasificarlo.

**Puse productos y el valor del negocio cambió solo.**
Es correcto. Cuando un negocio tiene líneas de producto, su valor pasa a ser la suma de esas líneas (cantidad × precio − descuento).

**¿El sistema envía los correos por mí?**
No. Las plantillas preparan el borrador y lo abren en tu programa de correo. Tú lo revisas y lo envías. El seguimiento de aperturas y clics no está disponible.

**Marqué un negocio como perdido por error.**
Ábrelo y pulsa **Reabrir negocio**. Vuelve a estado abierto y conserva todo su historial.

**No veo los negocios de mis compañeros.**
Correcto: cada vendedor ve su cartera. Solo el administrador ve los de todo el equipo.

**Una organización no muestra contratos ni tickets.**
Le falta enlazarla a su **cuenta de portal**. Abre su ficha → **Editar** (o el botón
**Vincular cuenta de portal** del propio aviso) → elige el laboratorio en el campo
*"Cuenta de portal"* → **Guardar cambios**.
[Guía paso a paso](#vincular-la-cuenta-de-portal-).

**¿Cómo sé qué clientes me faltan por vincular?**
Ve a **Administración → Usuarios** y mira la columna **CRM**: las cuentas con el
aviso ámbar **Sin vincular** son las que aún no tienen ficha comercial asociada.
Pulsa el aviso y lo enlazas desde ahí mismo.

**Vinculé la organización equivocada.**
Vuelve a entrar (por cualquiera de los dos caminos) y elige la correcta, o
**— Sin vincular —** para dejarla suelta. El vínculo anterior se libera solo:
cada cuenta representa a una sola organización.

**El laboratorio no aparece en la lista de cuentas de portal.**
Solo se listan las cuentas con rol **cliente** que estén **activas**. Si no está,
hay que crearla primero en **Administración → Usuarios** (lo hace el administrador).

**¿Puedo editar una organización o un contacto ya creado?**
Las organizaciones sí: ficha → **Editar**. Los contactos, por ahora, se corrigen
creando uno nuevo; avísanos si necesitas la pantalla de edición.

**¿Puedo tener varios embudos?**
El sistema los soporta y aparecerían como pestañas en el tablero, pero por ahora solo se pueden configurar las etapas del embudo existente.

---

## Flujo completo de un cliente, de principio a fin

```
1. Llega un lead por el formulario web
              ↓
2. Lo conviertes → se crean organización + contacto + negocio
              ↓
3. Lo mueves por el embudo (arrastrando las tarjetas)
   · agendas actividades en cada paso
   · registras notas de cada conversación
   · agregas productos → el valor se calcula solo
              ↓
4. Lo marcas GANADO
              ↓
5. Generas el contrato (llega prellenado desde el negocio)
              ↓
6. Se registran sus equipos
              ↓
7. El laboratorio abre tickets de soporte
              ↓
8. Todo se ve junto en la ficha de la organización (vista 360)
```

---

*Manual de usuario del Portal Evoelution — actualizado el 26 de julio de 2026.*
*Si algo no funciona como se describe aquí, avisa al administrador del sistema.*
