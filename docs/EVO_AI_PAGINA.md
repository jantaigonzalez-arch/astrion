# Evo_AI — Documentación de la página de producto

> Guía técnica completa de la landing **`/evo-ai`** dentro de `web_evoelution`.
> Cubre arquitectura, componentes, sistema de diseño, i18n, la narrativa
> visual y las decisiones tomadas. Pensada para estudiar y para extender.

---

## 1. Contexto: ¿qué es Evo_AI?

**Evo_AI** es el nombre de producto de la *Evoelution Chromatography Platform*
(repo `Evoelution_development/evo_ai`): una plataforma de análisis
cromatográfico para laboratorios farmacéuticos que:

- Parsea binarios `.dat` de **Waters Empower 3**.
- Corrige la línea base (**ALS**, Eilers & Boelens) y suaviza la señal
  (**Savitzky-Golay**).
- Detecta picos automáticamente (RT, altura, área, FWHM, SNR).
- Genera cartas de control de calidad **Levey-Jennings** (±2σ / ±3σ).
- Aplica **ML** para detectar anomalías (Isolation Forest), proyectar el
  espacio de features (PCA 2D) y agrupar corridas (KMeans).
- Exporta reportes en PDF/CSV.

Stack del producto: **FastAPI + Python 3.11 + SciPy + scikit-learn** (backend)
y **Next.js 16** (frontend), desplegado con Docker + Nginx.

La página `/evo-ai` es la **landing de marketing** de ese producto, dentro del
sitio corporativo `web_evoelution`. El wordmark refuerza la idea de que Evo_AI
es *la evolución con IA de Evoelution* (juego: **Evo**+**elution** → **Evo_AI**,
donde "elution/elución" es un término cromatográfico).

Inspiración estética: **Railway** (oscuro, técnico, gradientes, mockups de
producto) y **TetraScience – Tetra Data** (plataforma de datos científicos
pharma). Pero re-interpretado con la identidad propia de Evoelution
(cromatografía / "señal de pico") para no calcar.

---

# Parte I — La ciencia detrás de Evo_AI (química analítica)

> Esta parte explica **la química y los algoritmos** que Evo_AI implementa: qué
> es un cromatograma, por qué la señal cruda es un problema, y la ciencia de
> cada etapa del procesamiento (ALS, Savitzky-Golay, detección de picos,
> Levey-Jennings, ML). Para cada tema: (1) la ciencia, (2) el detalle
> técnico/algorítmico, (3) por qué importa en un laboratorio farmacéutico
> regulado. Entender esto es lo que da sentido a cada mockup y texto de la
> landing.

## A. Fundamentos: qué es un cromatograma y qué mide

### La ciencia/química

La cromatografía es una técnica de separación basada en el **reparto diferencial** de los componentes de una mezcla entre dos fases: una **fase estacionaria** (el relleno de la columna, p. ej. sílica funcionalizada con cadenas C18 en fase reversa) y una **fase móvil** (el eluyente líquido que fluye a través de la columna, típicamente una mezcla agua/buffer + modificador orgánico como acetonitrilo o metanol).

Cada analito interacciona con ambas fases con una afinidad distinta. Un compuesto que "prefiere" la fase estacionaria queda retenido más tiempo; uno que "prefiere" la fase móvil sale antes. Ese reparto se describe termodinámicamente por el **factor de retención** $k$:

$$k = \frac{t_R - t_0}{t_0}$$

donde $t_R$ es el tiempo de retención del analito y $t_0$ el tiempo muerto (tiempo que tarda un compuesto no retenido en atravesar la columna, ligado al volumen muerto $V_0$). El proceso de arrastre del analito por la fase móvil a lo largo de la columna hasta el detector es la **elución**.

### El detalle técnico

Un **cromatograma** es una serie temporal:

- **Eje x (tiempo, min):** el tiempo transcurrido desde la inyección. En Evo_AI proviene de la tasa de muestreo del detector codificada en el binario `.dat` de Empower 3.
- **Eje y (respuesta del detector):** la magnitud física que el detector convierte en señal. En un detector UV/DAD es la **absorbancia** (unidades de absorbancia, AU, o mAU) a una longitud de onda $\lambda$ fija o extraída del espectro; sigue la ley de Lambert-Beer, $A = \varepsilon \cdot b \cdot c$, de modo que la respuesta es proporcional a la concentración instantánea del analito que pasa por la celda.

Un **pico** es la traza que deja una banda cromatográfica al pasar por el detector: idealmente una gaussiana centrada en $t_R$. **Un pico = un analito** (bajo el supuesto de separación adecuada), porque cada especie eluye como una banda concentrada alrededor de su tiempo de retención característico.

Jerarquía de datos:
- **Corrida (run/injection):** una sola inyección → un cromatograma. Es la unidad atómica que Evo_AI parsea del `.dat`.
- **Secuencia (sequence):** el conjunto ordenado de corridas de una tanda analítica (blancos, estándares de calibración, muestras, controles de idoneidad del sistema, blancos de arrastre). Es la unidad sobre la que se construyen las cartas de control y el análisis multivariado.

### Por qué es importante

El cromatograma es el **dato crudo (raw data)** del que deriva toda decisión analítica: identidad (¿es el analito correcto?), pureza (¿hay impurezas coeluyendo?) y contenido (¿cuánto hay?). En un entorno GMP, ese `.dat` es un **registro regulado**: su integridad, atribuibilidad y trazabilidad caen bajo 21 CFR Part 11 y ALCOA+. Entender qué representa físicamente cada eje no es pedante: es lo que permite distinguir una señal química real de un artefacto instrumental, y esa distinción es la base de una liberación de lote correcta.

---

## B. Por qué la señal cruda es un problema

La señal que sale del detector **no** es una serie de gaussianas limpias sobre cero. Tres patologías la contaminan.

### B.1 Deriva de línea base (baseline drift)

**La física:** la línea base es la respuesta del detector en ausencia de analito. Debería ser plana, pero deriva por:

- **Gradiente de elución:** al aumentar el % de modificador orgánico (fase B) durante la corrida, cambia la absorbancia de fondo de la fase móvil (los solventes absorben distinto en UV) y el índice de refracción de la celda → la base "sube" o "baja" a lo largo del gradiente.
- **Temperatura:** fluctuaciones del horno de columna alteran la viscosidad, el reparto y la línea de base del detector.
- **Sangrado de columna (column bleed):** desprendimiento lento de fase estacionaria o de contaminantes acumulados, más marcado en columnas envejecidas y en gradientes agresivos.

### B.2 Ruido (noise)

Fluctuaciones de alta frecuencia superpuestas a la señal: **ruido del detector** (ruido electrónico, deriva de lámpara UV, ruido de fotodiodo), **ruido de la bomba** (pulsaciones del flujo si el amortiguador no compensa bien), y ruido químico (micropartículas, burbujas). El ruido fija el piso de detección: nada por debajo de él es cuantificable con confianza.

### B.3 Coelución / resolución insuficiente

Dos analitos con $k$ parecidos eluyen solapados. La métrica es la **resolución** $R_s$:

$$R_s = \frac{2\,(t_{R2} - t_{R1})}{w_1 + w_2} = 1.18 \cdot \frac{t_{R2} - t_{R1}}{w_{h1} + w_{h2}}$$

donde $w$ es el ancho de pico en la base y $w_h$ el ancho a media altura (FWHM). Criterio clásico:

| $R_s$ | Interpretación |
|-------|----------------|
| < 1.0 | Picos solapados, cuantificación no confiable |
| 1.5 | **Separación a línea base** (~99.7 %), objetivo de referencia |
| ≥ 2.0 | Holgura robusta (recomendable para métodos de impurezas/estabilidad) |

### Por qué es importante

La cuantificación se basa en **integrar el área bajo el pico**. Si la línea base deriva, el integrador tiene que decidir dónde "apoyar" el pico: un baseline mal trazado bajo un pico introduce sesgo directo en el área (y por tanto en el resultado de contenido o de impureza). Si dos picos coeluyen, el área de uno "contamina" la del otro. En un método validado bajo ICH Q2, la **especificidad** exige demostrar que la señal del analito está libre de interferencias: un $R_s$ insuficiente es un hallazgo de idoneidad del sistema (USP <621>) que invalida la corrida. Corregir baseline y ruido **antes** de integrar no es cosmética: es condición para que el área signifique lo que decimos que significa.

---

## C. Corrección de línea base — ALS (Eilers & Boelens)

### La química/física

El objetivo es estimar la **línea base** (la contribución de fondo lento: gradiente, sangrado, deriva térmica) y restarla, dejando solo la contribución de los analitos. La clave física es una **separación de escalas**: la línea base varía lentamente (baja frecuencia espacial a lo largo del cromatograma), mientras que los picos son eventos rápidos y estrechos. Un buen estimador de baseline debe seguir el fondo sin "trepar" por dentro de los picos.

### El detalle algorítmico

**ALS (Asymmetric Least Squares)**, de Eilers & Boelens (2005), plantea la baseline $z$ que minimiza una función de costo con dos términos en tensión:

$$Q(z) = \sum_i w_i\,(y_i - z_i)^2 \;+\; \lambda \sum_i (\Delta^2 z_i)^2$$

- **Término de fidelidad** $\sum w_i (y_i - z_i)^2$: penaliza que la baseline se aleje de los datos.
- **Término de rugosidad** $\lambda \sum (\Delta^2 z_i)^2$: penaliza la curvatura (segunda diferencia $\Delta^2 z_i = z_{i-1} - 2z_i + z_{i+1}$). Fuerza a que $z$ sea **suave**.
- **$\lambda$ (lambda, suavizado):** controla la rigidez de la baseline. $\lambda$ grande → baseline muy suave, casi recta (sigue solo la deriva global); $\lambda$ chico → baseline flexible que empieza a seguir los picos (indeseable). Órdenes típicos: $\lambda \sim 10^5$–$10^8$.

**La asimetría — el corazón del método.** Los pesos $w_i$ no son fijos; se actualizan iterativamente según de qué lado de la baseline cae cada punto:

$$w_i = \begin{cases} p & \text{si } y_i > z_i \quad (\text{el punto está por encima} \to \text{probable pico}) \\ 1-p & \text{si } y_i \le z_i \quad (\text{el punto está por debajo/en la base}) \end{cases}$$

con $p$ (asimetría) pequeño, típicamente $p \in [0.001, 0.1]$. La lógica: los puntos que quedan **por encima** de la baseline provisional son, muy probablemente, parte de un pico, y se les da un peso $p$ minúsculo → la baseline **los ignora** en lugar de subir hacia ellos. Los puntos por debajo (ruido de base genuino) pesan $1-p \approx 1$. Se resuelve el sistema lineal (matriz pentadiagonal, muy eficiente), se recalculan los pesos y se itera hasta convergencia.

Si $p$ fuera $0.5$ (simétrico), la "baseline" sería un mínimos-cuadrados suavizado que **se comería** los picos por la mitad. La asimetría es exactamente lo que impide eso: la baseline pasa por debajo de los picos, no a través de ellos.

### Por qué es importante

El área y la altura son proporcionales a la concentración **respecto de una línea base correcta**. Una baseline que trepa hacia los picos subestima el área; una demasiado baja la sobreestima. En un método de impurezas donde un pico al 0.05 % debe distinguirse del ruido, un error de baseline de pocas mAU cambia si una impureza está "por encima" o "por debajo" del umbral de notificación (ICH Q3A/B). ALS ofrece dos ventajas regulatorias concretas: es **determinístico y reproducible** (mismos $\lambda$, $p$ → misma baseline, siempre) y elimina el sesgo subjetivo del operador que traza la línea a mano. Esa reproducibilidad es oro para integridad de datos: la operación es auditable y no depende de quién la ejecutó.

---

## D. Suavizado — Savitzky-Golay

### La química/física del problema

Queremos atenuar el ruido de alta frecuencia (sección B.2) sin **distorsionar la forma del pico**. La forma importa: altura, ancho (FWHM) y los momentos estadísticos del pico codifican eficiencia y asimetría. Un suavizado tosco los destruye.

### El detalle algorítmico

**Savitzky-Golay (SG)** ajusta, para cada punto, un **polinomio de bajo orden por mínimos cuadrados** dentro de una ventana móvil de $2m+1$ puntos, y reemplaza el punto central por el valor del polinomio ajustado. Gracias a la propiedad de convolución, esto se reduce a un producto con coeficientes fijos precalculados:

$$y_i^{\text{suave}} = \sum_{j=-m}^{m} c_j \, y_{i+j}$$

Dos parámetros:

- **Ancho de ventana ($2m+1$):** cuántos puntos se promedian localmente. Ventana grande → más reducción de ruido, pero más riesgo de aplanar picos estrechos.
- **Orden polinómico ($k$, típicamente 2 o 3):** el grado del polinomio local. Un orden par (cuadrático/cúbico) **preserva la curvatura** cerca del máximo del pico.

**Ventaja decisiva sobre la media móvil:** una media móvil es un SG de orden 0 (ajusta una constante local). Ante un pico, la constante local queda por debajo del máximo → **aplana la altura y ensancha el pico** (sesga hacia abajo los picos, hacia arriba los valles). SG, al ajustar una parábola, sigue la curvatura y **conserva la altura, el ancho y los momentos** del pico hasta orden $k$. Esa preservación de momentos es la razón por la que es el estándar en instrumentación analítica.

**El compromiso:** ruido vs. distorsión. Ventana demasiado ancha o orden demasiado bajo → sobre-suavizado: se pierde altura, aumenta el FWHM, dos picos apenas resueltos se funden. Ventana demasiado estrecha → apenas reduce ruido. Regla práctica: la ventana debe ser **menor que el FWHM del pico más angosto** (varios puntos por FWHM), y orden 2–3.

### Por qué es importante

El **SNR** entra directo en LOD y LOQ (sección E). Un suavizado bien parametrizado sube el SNR reduciendo el denominador (ruido) sin tocar la señal → mejora los límites de detección/cuantificación **sin** manipular la magnitud del analito. Pero un SG mal parametrizado es una forma sutil de distorsión del dato: si ensancha picos, degrada la resolución aparente y sesga el conteo de platos teóricos. En un contexto regulado, el preprocesamiento debe estar **parametrizado, documentado y fijo** por método; cambiar la ventana de SG entre corridas de una misma secuencia sería una inconsistencia de datos. La virtud de SG es que preserva la fidelidad química de la señal mientras limpia el ruido: mejora la calidad del dato sin inventar señal.

---

## E. Detección e integración de picos + métricas

### E.1 Detección — la ciencia y el algoritmo

Un pico es un **máximo local** de la señal (derivada primera pasa de + a −, derivada segunda negativa). En Evo_AI se usa `scipy.signal.find_peaks` sobre la señal ya corregida de baseline y suavizada. Parámetros clave:

- **`height` (umbral de altura):** descarta lo que no supera un mínimo sobre la base (filtra ruido).
- **`prominence` (prominencia):** cuánto sobresale un pico respecto de la línea de base local entre valles. Es el filtro más robusto contra falsos positivos: un hombro sobre un pico grande tiene poca prominencia y se puede discriminar.
- **`distance`:** separación mínima entre máximos (evita contar el mismo pico dos veces por ruido residual).

La **integración** delimita el pico (inicio/fin donde la señal vuelve a la base o donde hay un valle entre picos coeluidos → drop line / valley-to-valley) y suma el área.

### E.2 Las métricas — definición, fórmula y significado

**RT — Tiempo de retención**
Posición del máximo en el eje x ($t_R$, min). Es la **coordenada de identidad** del analito bajo condiciones fijas. Su repetibilidad (RSD del $t_R$ entre inyecciones) es un criterio de idoneidad del sistema típico (p. ej. RSD ≤ 1 %).

**Área**
$$A = \int_{t_{ini}}^{t_{fin}} S(t)\,dt \approx \sum_i S_i \,\Delta t$$
Es la métrica **cuantitativa** por excelencia: bajo la ley de Beer, el área es proporcional a la masa/concentración del analito que atraviesa el detector ($A \propto c$). Toda la cuantificación (calibración externa, estándar interno, normalización de áreas) se apoya en el área.

**Altura**
Máximo de la señal corregida sobre la base ($H$, mAU). También $\propto c$, pero más sensible al ancho de pico y a la coelución que el área; se usa cuando los picos son muy angostos o hay solapamiento parcial.

**FWHM — Ancho a media altura**
Ancho del pico a $H/2$ ($w_h$). Vincula la métrica con la **eficiencia de la columna**, los **platos teóricos** $N$:

$$N = 5.54 \left(\frac{t_R}{w_h}\right)^2$$

Más platos = picos más angostos y altos = mejor resolución. La **altura de plato** $H_{plato} = L/N$ ($L$ = longitud de columna) mide la calidad del empaque. Con el ancho a distintas alturas se estima la **asimetría / tailing**:

$$A_s = \frac{b}{a}\Big|_{10\%}, \qquad T_f = \frac{w_{0.05}}{2f}\Big|_{5\%}$$

donde $a$/$b$ son las semianchuras anterior y posterior al máximo. $A_s \approx T_f \approx 1$ = pico simétrico; $>1.5$–$2$ indica tailing (silanoles residuales, sobrecarga, volumen extracolumna) → hallazgo de idoneidad y señal de columna degradándose.

**SNR — Relación señal/ruido**
$$SNR = \frac{H}{N_{ruido}}$$
con $N_{ruido}$ estimado como amplitud pico-a-pico (o desvío) del ruido en una región sin picos. Fundamenta los límites del método:

| Criterio | Regla clásica | Significado |
|----------|--------------|-------------|
| **LOD** | S/N ≈ 3 | Límite de detección: se distingue del ruido, no se cuantifica |
| **LOQ** | S/N ≈ 10 | Límite de cuantificación: medible con exactitud/precisión aceptables |

### E.3 Tabla resumen

| Métrica | Qué indica químicamente | Por qué importa |
|---------|------------------------|-----------------|
| **RT** | Identidad del analito | Confirmación de identidad; RSD de RT = idoneidad del sistema |
| **Área** | Cantidad ($\propto c$) | Base de toda cuantificación (contenido, impurezas) |
| **Altura** | Cantidad / respuesta pico | Cuantificación en picos angostos o parcialmente resueltos |
| **FWHM** | Eficiencia ($N$), estado de columna | Resolución, detección de ensanchamiento/envejecimiento |
| **As / Tf** | Simetría del pico | Integración fiable; diagnóstico de silanoles/sobrecarga |
| **SNR** | Calidad de señal | Define LOD/LOQ; criterio de aceptación de sensibilidad |

### Por qué es importante

Estas seis métricas son, literalmente, los **criterios de idoneidad del sistema (SST)** que USP <621> e ICH Q2 exigen antes de reportar un resultado: RSD de área y RT, número de platos, factor de tailing, resolución entre pares críticos, y S/N para métodos traza. Si la extracción de métricas es inconsistente o manual, todo el edificio de validación se tambalea. Automatizarla de forma determinística garantiza que "el pico a 4.2 min con área X" significa lo mismo en cada corrida y en cada auditoría.

---

## F. Control de calidad — Levey-Jennings y Westgard

### La ciencia estadística

Una **carta Levey-Jennings (LJ)** es un gráfico de control de Shewhart aplicado a un parámetro analítico monitoreado en el tiempo (p. ej. el área o el RT del estándar de idoneidad, o de un control de calidad, corrida tras corrida). Presupone que, cuando el sistema está **bajo control**, ese parámetro se distribuye ~normal alrededor de una **media $\mu$** con un **desvío estándar $\sigma$** establecidos a partir de un histórico de corridas válidas.

Se trazan líneas horizontales en $\mu$ y en $\mu \pm 1\sigma$, $\pm 2\sigma$, $\pm 3\sigma$. Bajo normalidad:

- $\pm 2\sigma$ cubre ~95.5 % → superarlo es un **evento de advertencia** (esperable ~4.5 % de las veces por azar).
- $\pm 3\sigma$ cubre ~99.7 % → superarlo es un **evento crítico** (probabilidad de azar ~0.3 %): fuerte indicio de causa asignable.

En Evo_AI: límites de **advertencia = $\mu \pm 2\sigma$** y **críticos = $\mu \pm 3\sigma$**.

### Reglas de Westgard

Un solo punto fuera de límites tiene tasa de falsos rechazos no despreciable. Las **reglas de Westgard** son un sistema multirregla que aumenta la detección de error real bajando los falsos positivos, combinando patrones:

| Regla | Disparo | Detecta |
|-------|---------|---------|
| **1₂s** | 1 punto fuera de ±2σ | **Advertencia** (dispara revisión, no rechazo) |
| **1₃s** | 1 punto fuera de ±3σ | Error aleatorio grande → **rechazo** |
| **2₂s** | 2 consecutivos fuera del mismo ±2σ | Error sistemático (sesgo) |
| **R₄s** | Rango entre 2 puntos > 4σ | Error aleatorio |
| **4₁s** | 4 consecutivos fuera del mismo ±1σ | Deriva/sesgo sistemático |
| **10ₓ** | 10 consecutivos del mismo lado de la media | Deriva sistemática (tendencia) |

Las reglas de "corrida del mismo lado" (4₁s, 10ₓ) son las que capturan **deriva lenta**: un método que envejece, una columna que pierde platos, una lámpara que decae. Ninguno de esos puntos viola ±3σ individualmente, pero el patrón sí es señal.

### Por qué es importante

LJ + Westgard es el **estándar de facto del QC** en laboratorios clínicos y farmacéuticos: convierte una serie de resultados en una decisión objetiva "en control / fuera de control". Enlaza directamente con **system suitability (USP <621>)**: los parámetros SST (RT, área, N, tailing, Rs) monitoreados en LJ permiten distinguir una corrida puntualmente mala de una **tendencia** del método. Detectar la deriva **temprano** (regla 10ₓ) evita liberar datos generados por un sistema que ya salió de su estado validado, y anticipa mantenimiento (cambio de columna, lámpara) antes del fallo franco. En términos regulatorios, es evidencia documentada del **estado de control** del método, insumo directo para la verificación continua de la performance (ICH Q14) y para investigaciones OOS/OOT.

---

## G. Machine Learning interpretable — Isolation Forest, PCA, KMeans

Premisa: en Evo_AI, cada corrida se resume en un **vector de features cromatográficas** (RT, área, altura, FWHM, SNR, As, N, etc.). El ML opera sobre ese espacio de features. Antes, se escala.

### RobustScaler — por qué

Estandarizar features es necesario porque están en unidades distintas (min vs. mAU·s vs. adimensional). El escalado estándar (z-score con media y σ) es **frágil ante outliers**: justo lo que buscamos (una corrida anómala) distorsionaría la media y la σ usadas para escalar. **RobustScaler** centra en la **mediana** y escala por el **rango intercuartílico (IQR)**:

$$x' = \frac{x - \text{mediana}}{IQR}$$

Mediana e IQR son estadísticos robustos: un puñado de corridas anómalas casi no los mueve. Así, las anomalías **destacan** en el espacio escalado en vez de contaminar la referencia.

### Isolation Forest — detección de anomalías

**Qué hace:** construye árboles que particionan el espacio de features con cortes aleatorios. Las observaciones **anómalas** se aíslan con pocos cortes (quedan en ramas cortas) porque están en regiones poco pobladas; las normales requieren muchos cortes. La longitud de camino promedio → un **score de anomalía** (en Evo_AI, 0–100 %).

**Por qué se eligió:** es eficiente, no asume normalidad ni forma de cluster, escala bien y funciona en pocos features. Está diseñado explícitamente para el caso "muchas normales, pocas raras".

**Interpretación cromatográfica:** un score alto se dispara cuando una corrida tiene una combinación inusual de features: un FWHM anormalmente ancho (columna degradándose), un área fuera de rango (problema de inyección o de muestra), un SNR bajo (lámpara/ruido), un RT desplazado (deriva de fase móvil). La pregunta accionable es *qué feature* llevó el score arriba.

### PCA 2D — visualización del espacio de features

**Qué hace:** proyecta el espacio multidimensional de features en 2 componentes principales (las direcciones de máxima varianza), preservando lo más posible la estructura. Permite **ver** en un plano cómo se distribuyen las corridas.

**Por qué se eligió:** es lineal e **interpretable** — los *loadings* dicen qué features pesan en cada componente. No es una proyección opaca; se puede explicar por qué dos corridas quedan lejos.

**Interpretación cromatográfica:** corridas similares se agrupan; una corrida que se aleja del cúmulo señala un perfil de features distinto. Si el eje que la separa está dominado (por sus loadings) por FWHM y N, la lectura es "problema de eficiencia/columna"; si lo domina el área, "problema de respuesta/cuantificación".

### KMeans — agrupamiento de corridas

**Qué hace:** particiona las corridas en $k$ grupos minimizando la distancia intra-cluster. Descubre **estructura natural** en la secuencia.

**Interpretación cromatográfica:** los clusters pueden separar poblaciones esperadas (blancos vs. estándares vs. muestras) o revelar **deriva por bloques** (p. ej. las corridas de la segunda mitad de la secuencia formando su propio cluster → la columna o la fase móvil cambiaron durante la tanda). Es exploratorio y complementa a LJ para ver estructura que una carta univariada no muestra.

### Por qué la interpretabilidad importa (entorno regulado)

En farma **no se aceptan cajas negras** para tomar decisiones sobre el dato: cada rechazo o alerta debe poder **justificarse y auditarse**. Los tres métodos elegidos son interpretables por construcción — Isolation Forest apunta a features concretas, PCA expone sus loadings, KMeans agrupa por distancias explicables — a diferencia de una red neuronal profunda cuya decisión sería difícil de defender ante un auditor. RobustScaler asegura que el preprocesamiento no esté sesgado por los mismos outliers que buscamos.

Y el punto crítico: el ML **complementa, no reemplaza** al químico. Estas técnicas son **no supervisadas y sin unidades regulatorias propias**: señalan "esta corrida es rara" o "estas se agrupan", pero **no deciden** conformidad. La decisión OOS/OOT, la interpretación de la causa raíz y la disposición del lote son del analista responsable. El ML es un **sistema de triage** que dirige la atención humana hacia las corridas que la merecen — reduce el volumen a revisar y detecta patrones multivariados que el ojo no ve, dejando el juicio final donde debe estar.

---

## H. Por qué todo esto importa — síntesis regulatoria y de negocio

### Integridad de datos (ALCOA+)

Todo el pipeline de Evo_AI existe para servir a la **integridad del dato**, el principio rector de la data regulada. ALCOA+ exige que el dato sea **A**ttributable, **L**egible, **C**ontemporáneo, **O**riginal y **A**preciso, más completo, consistente, perdurable y disponible. Un procesamiento **determinístico y parametrizado** (ALS con $\lambda$/$p$ fijos, SG con ventana/orden fijos, métricas calculadas por algoritmo) aporta directamente **Consistencia** (misma entrada → misma salida) y **Exactitud** (áreas correctas sobre baseline correcta), y elimina la variabilidad del operador.

### Trazabilidad y auditabilidad (21 CFR Part 11)

Parsear el `.dat` **original** de Empower 3 preserva el dato fuente; procesarlo con parámetros registrados hace la transformación **reproducible y auditable** — un auditor puede re-ejecutar y obtener el mismo resultado. Eso es precisamente lo que 21 CFR Part 11 pide de los registros electrónicos: integridad, trazabilidad y capacidad de reconstruir cómo se llegó a un resultado.

### Reducción del error humano de integración

La integración manual de línea base es históricamente la mayor fuente de **variabilidad y de hallazgos de integridad** (el "peak shaving" o reintegración sin justificación es una observación 483 clásica de la FDA). Automatizar baseline y métricas con un método fijo y documentado retira ese factor subjetivo y produce un rastro defendible.

### Detección temprana de deriva del sistema

Las cartas Levey-Jennings + Westgard sobre las features convierten el monitoreo en **predictivo**: capturan el envejecimiento de columna, la caída de lámpara o la deriva de fase móvil **antes** de que causen un fallo de idoneidad o, peor, la liberación de un dato inválido. Esto alimenta la **verificación continua de la performance del método** (ICH Q14) y anticipa mantenimiento — valor operativo y de calidad a la vez.

### El valor de estandarizar el procesamiento

Estandarizar el pipeline — mismo baseline, mismo suavizado, mismas definiciones de métrica en cada corrida, laboratorio e instrumento — es lo que hace los resultados **comparables** y las decisiones **defendibles**. Se apoya en el marco regulatorio: **ICH Q2(R2)** (validación: especificidad, exactitud, precisión, LOD/LOQ, robustez), **ICH Q14** (desarrollo y ciclo de vida del procedimiento analítico), **USP <621>** (idoneidad del sistema) y **USP <1058>** (calificación del sistema analítico, AIQ). El retorno de negocio es concreto: menos investigaciones OOS por artefactos de procesamiento, auditorías más limpias, liberación de lotes más rápida y confiable, y un conocimiento del método que se acumula en vez de perderse con cada operador.

---

# Parte II — La implementación en la web

## 2. Stack y convenciones del sitio

| Capa | Tecnología |
|---|---|
| Framework | **Next.js 16** (App Router, React 19, Turbopack, Server Actions) |
| Estilos | **Tailwind CSS 4** + tokens **OKLCH** (claro/oscuro) |
| Animación | **Motion** (`motion/react`) |
| i18n | **next-intl 4** — español (por defecto) / inglés, `localePrefix: as-needed` |
| Tipografía | **Inter** (sans) + **JetBrains Mono** (mono) vía `next/font` |
| Iconos | **lucide-react** |

Convenciones clave que sigue la página (idioms del repo):

- Las **páginas de marketing** son *Server Components* `async`. Reciben
  `params: Promise<{ locale }>`, hacen `setRequestLocale(locale)` y leen textos
  con `getTranslations`.
- Los **componentes con animación** llevan `"use client"` y usan `motion/react`.
- Enlaces internos con `Link` de `@/i18n/navigation` (respeta el locale).
- Contenedor de ancho máximo: `<Container>` (`max-w-7xl px-6 lg:px-8`).
- Aparición al hacer scroll: `<Reveal>` (wrapper de Motion, respeta
  `prefers-reduced-motion`).

> **Nota de `AGENTS.md`**: "This is NOT the Next.js you know". Antes de tocar
> APIs de Next conviene leer `node_modules/next/dist/docs/`. Todo lo aquí
> descrito sigue los patrones ya presentes en el repo (params async,
> `getTranslations`, `setRequestLocale`, `Link` de next-intl).

---

## 3. Mapa de archivos

### Creados

```
src/app/[locale]/(marketing)/evo-ai/page.tsx      # La página /evo-ai (server)
src/components/marketing/evo-ai/
├── hero.tsx            # Hero: wordmark evolutivo + mockup de señal cruda
├── raw-signal.tsx      # Mockup "antes": cromatograma crudo y ruidoso
├── processed-signal.tsx# Mockup "después": cromatograma limpio + métricas
└── pipeline.tsx        # Flujo de 5 pasos (ingesta → ML)
docs/EVO_AI_PAGINA.md   # Este documento
```

### Modificados

```
src/messages/es.json    # nav.evoAi + bloque pages.evoAi
src/messages/en.json    # idem en inglés
src/components/marketing/navbar.tsx   # enlace "Evo_AI"
src/components/marketing/footer.tsx   # enlace "Evo_AI"
src/app/globals.css     # animaciones float/aurora/scan + utilidad .glow-ring
src/app/[locale]/layout.tsx           # script de tema inline (anti-FOUC)
```

### Eliminados

```
src/components/marketing/evo-ai/raw-data-cloud.tsx  # 1ª versión (nube de puntos, descartada)
src/components/shared/theme-script.tsx              # reemplazado por script inline
```

---

## 4. Sistema de diseño (tokens y utilidades)

Todo vive en `src/app/globals.css`. La identidad es **azul profundo (confianza
pharma) + cian "señal de pico"**, en OKLCH, con modo claro/oscuro.

### 4.1 Tokens de color (extracto)

```css
:root {
  --primary: oklch(0.52 0.19 258);   /* azul Evoelution */
  --accent:  oklch(0.78 0.14 200);   /* cian "señal" */
  --brand-500 / --brand-400 / --brand-300;  /* rampa de marca para gradientes */
  --signal / --signal-bright;               /* cian para efectos */
  --success / --warning / --destructive;
}
.dark { /* mismos tokens, superficies oscuras */ }
```

Se exponen a Tailwind vía `@theme inline` como `--color-primary`,
`--color-brand-500`, `--color-signal`, etc. → se usan como `text-primary`,
`bg-brand-500`, `from-signal`, …

### 4.2 Utilidades propias

| Clase | Qué hace |
|---|---|
| `.bg-grid` | Malla tipo cuadrícula de cromatograma (48×48px). |
| `.text-gradient-brand` | Texto con gradiente `brand-500 → signal-bright`. |
| `.glass` | Fondo semitransparente + `backdrop-blur` (efecto vidrio). |
| `.glow-ring` | **(nuevo)** Borde con gradiente luminoso (padding-box + border-box). |

### 4.3 Animaciones (nuevas, "de futuro")

Registradas en `@theme inline` y definidas con `@keyframes`:

| Animación | Uso |
|---|---|
| `animate-glow` | Pulso de opacidad (ya existía). |
| `animate-float` (16s) | Blobs que derivan y escalan suavemente. |
| `animate-aurora` (20s) | Halo que rota y "respira". |
| `animate-scan` (7s) | Haz que barre los mockups como un escáner. |

**Accesibilidad**: un bloque `@media (prefers-reduced-motion: reduce)`
desactiva `float`, `aurora` y `scan` para quien reduce el movimiento.

```css
@media (prefers-reduced-motion: reduce) {
  .animate-float, .animate-aurora, .animate-scan { animation: none; }
}
```

---

## 5. Anatomía de la página `/evo-ai`

Archivo: `src/app/[locale]/(marketing)/evo-ai/page.tsx`.

Es un *Server Component* que:

1. Espera `params`, hace `setRequestLocale(locale)`.
2. Lee traducciones con `getTranslations("pages.evoAi")`.
3. Extrae **arrays** de i18n con `t.raw(...)` (stats, tags, features, methods,
   points).
4. Define arrays locales que **no** se traducen (nombres técnicos):
   `FEATURE_ICONS` (iconos lucide) y `STACK` (Next.js 16, FastAPI, SciPy…).
5. Exporta `generateMetadata` (title/description por locale).

### Orden de secciones (narrativa "antes → después")

```
1. <EvoAiHero/>            Hero: wordmark Evo_AI + mockup de SEÑAL CRUDA (el "antes")
2. El problema            Texto del problema + mockup de SEÑAL PROCESADA (el "después")
3. Banda de métricas      4 stats en mono con gradiente
4. <EvoAiPipeline/>       5 pasos: ingesta → señal → picos → QC → ML
5. Capacidades            Grid de 6 tarjetas con icono
6. Machine learning       3 métodos (Isolation Forest / PCA / KMeans)
7. Cumplimiento pharma    4 puntos + escudo (integridad de datos)
8. Stack técnico          Chips mono del stack
9. <CTA/>                 Llamado a la acción (componente compartido)
```

> **La clave de la narrativa**: el hero muestra la señal **cruda y caótica**
> (el problema real de un `.dat` sin procesar) y la sección siguiente muestra
> el **resultado limpio e integrado** que entrega Evo_AI. Es un contraste
> visual "problema → solución".

### Patrón de una sección (ejemplo simplificado)

```tsx
<section className="border-b border-border py-24">
  <Container>
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">
        {t("features.eyebrow")}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        {t("features.title")}
      </h2>
    </Reveal>
    <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((f, i) => { /* tarjeta con icono */ })}
    </div>
  </Container>
</section>
```

---

## 6. Componentes en detalle

### 6.1 `hero.tsx` — Wordmark evolutivo + mockup

Cliente (`"use client"`). Dos columnas:

**Columna izquierda**
- Badge con `Sparkles` (`t("badge")`).
- **Wordmark `Evo_AI`** que cuenta la evolución en sí mismo:
  ```
  Evo  ‹elution›  _AI  ▍
  │      │          │    └─ cursor terminal parpadeante (animate-pulse)
  │      │          └───── "_AI" en text-gradient-brand + glow (text-shadow cian)
  │      └──────────────── "elution" pequeño, tachado en rojo, se desvanece
  │                         (opacity 0.85 → 0.38 con Motion)
  └─────────────────────── "Evo": raíz compartida con Evoelution
  ```
  Detalles a11y: `aria-label="Evo_AI, la evolución de Evoelution"`; el tachado
  y el cursor son `aria-hidden`.
- Subtítulo `h2` (`title` + `titleAccent`), párrafo, dos botones (demo /
  "ver cómo funciona" → ancla `#pipeline`), y una línea de cumplimiento.

**Columna derecha**
- Renderiza `<RawSignal annotations={...} />` (el mockup de señal cruda).
  Las `annotations` salen de `t.raw("problem.annotations")`.

**Fondo "de futuro"**: `DotField`, `.bg-grid`, y **tres halos** — un aurora
(`animate-aurora`) y dos blobs (`animate-float` con `animation-delay`
distintos para que no vayan sincronizados).

### 6.2 `raw-signal.tsx` — El "antes" (señal cruda)

Cliente. Dibuja un **cromatograma sin procesar** dentro de un mockup de
instrumento (barra de ventana estilo macOS + `.glow-ring` + `animate-scan`).

Todo es **determinista** (mismo resultado en servidor y cliente → sin desajuste
de hidratación). La señal se compone de tres ingredientes:

```js
// Constantes
const W = 300, H = 140, BASE = 104;   // viewBox y línea base

// 1) Picos gaussianos DELIBERADAMENTE solapados ("sin resolver")
const HUMPS = [{c:58,a:30,w:15}, {c:92,a:24,w:11}, {c:150,a:40,w:17},
               {c:173,a:33,w:13}, {c:244,a:20,w:22}];

// 2) La señal en cada x:
function signalY(x, noise) {
  const drift = 7*Math.sin(x*0.03+0.6) + 5*Math.sin(x*0.011+2); // línea base a la deriva
  let humps = 0;
  for (const h of HUMPS) humps += h.a * Math.exp(-((x-h.c)**2)/(2*h.w*h.w));
  return BASE - drift - humps + noise;   // menor y = pico más alto
}

// 3) Ruido de alta frecuencia con PRNG SEMBRADO (LCG determinista)
let s = 987654321 >>> 0;
const rnd = () => { s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
// noise = (rnd() - 0.5) * 4.5  por cada muestra (x += 1.5)
```

Encima de la curva se colocan **3 marcadores de problema** (`MARKERS`) con
guías verticales punteadas rojas y chips `⚠` (`Ruido sin filtrar`,
`Picos sin resolver`, `Línea base a la deriva`). Pie: `● no integrado`.

> **Por qué un PRNG sembrado y no `Math.random()`**: si el ruido fuera aleatorio,
> el HTML del servidor y el del cliente diferirían y React lanzaría un error de
> hidratación. Con semilla fija, ambos generan exactamente la misma curva.

### 6.3 `processed-signal.tsx` — El "después" (señal procesada)

Cliente. Mismo marco de instrumento (`.glow-ring` + `animate-scan`), pero
muestra el **resultado limpio** de Evo_AI:

- Cromatograma **resuelto** reutilizando el componente `Chromatogram` (curva
  animada de picos limpios que ya existía en el repo). Cabecera `● integrado`.
- **Tabla de picos** en mono: `RT / Área / FWHM / SNR` (3 filas).
- **`AnomalyGauge`**: medidor circular SVG. El progreso se anima con
  `strokeDashoffset` de `circ` a `circ*(1 - score/100)` (score 12% = corrida
  saludable). Se dispara con `whileInView`.

### 6.4 `pipeline.tsx` — El flujo de datos

Cliente. Lee `t.raw("pipeline.steps")` (5 pasos). Cada paso es una tarjeta con:
icono lucide (`FileInput → Waves → Activity → LineChart → BrainCircuit`),
número `0N`, nombre, un **tag mono** (`.dat`, `SciPy`, `find_peaks`,
`Levey-Jennings`, `scikit-learn`) y descripción. Entre tarjetas hay un
**conector** (`ArrowRight`) que rota 90° en móvil (vertical) y 0° en desktop
(horizontal). Cada tarjeta aparece con `whileInView` y un `delay` escalonado.
La sección tiene `id="pipeline"` (destino del ancla del hero).

---

## 7. Internacionalización (i18n)

Mensajes en `src/messages/es.json` y `en.json`. Estructura del bloque nuevo:

```jsonc
"nav": { …, "evoAi": "Evo_AI", … },
"pages": {
  "evoAi": {
    "badge", "eyebrow", "title", "titleAccent", "subtitle", "cta1", "cta2",
    "stats":   { "lead", "items": [{value,label} × 4] },
    "problem": { "eyebrow", "kicker", "tags":[×2], "points":[×4],
                 "annotations":[×3], "link" },
    "pipeline":{ "eyebrow", "title", "subtitle", "steps":[{name,tag,desc} × 5] },
    "features":{ "eyebrow", "title", "subtitle", "items":[{name,desc} × 6] },
    "ml":      { "eyebrow", "title", "body", "methods":[{name,desc} × 3] },
    "compliance": { "eyebrow", "title", "body", "points":[×4] },
    "stack":   { "eyebrow", "title" },
    "finalCta":{ … }   // (nota: la página usa el componente <CTA/> compartido)
  }
}
```

Reglas de traducción aplicadas:

- **Prosa** (títulos, descripciones): traducida ES/EN.
- **Términos técnicos** (`.dat`, `Isolation Forest`, `Levey-Jennings`,
  `FastAPI`, `find_peaks`…): **sin traducir** a propósito — refuerzan el look
  técnico y son estándar de industria.
- Los **arrays** (stats, steps, features, methods, points, tags, annotations)
  se leen con `t.raw("clave")` y se tipan con `as Tipo[]` en el componente.

Para añadir/editar textos: edita **ambos** JSON (es/en) manteniendo las mismas
claves. Un JSON inválido rompe el build, así que valídalo
(`node -e "JSON.parse(require('fs').readFileSync('src/messages/es.json'))"`).

---

## 8. Integración con navbar y footer

- **`navbar.tsx`**: se añadió `{ href: "/evo-ai", label: t("evoAi") }` al array
  `links`, colocado tras "Servicios" para dar protagonismo al producto.
- **`footer.tsx`**: enlace `Evo_AI` en la columna de servicios, encima de
  "Productos".

Ambos usan la clave `nav.evoAi`.

---

## 9. Fix del script de tema (anti-FOUC)

**Síntoma**: warning en consola de desarrollo —
*"Encountered a script tag while rendering React component."*

**Causa**: el componente `ThemeScript` **devolvía un `<script>`**. React 19
advierte porque los `<script>` renderizados por un componente no se ejecutan en
render de cliente.

**Solución** (según `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`,
sección *Themes*): inlinear el `<script>` **crudo** en el `<head>` del layout
raíz, no envolverlo en un componente.

```tsx
// src/app/[locale]/layout.tsx
const themeScript = `(function(){try{var t=localStorage.getItem('theme');
  var m=window.matchMedia('(prefers-color-scheme: dark)').matches;
  if(t==='dark'||(!t&&m)){document.documentElement.classList.add('dark');}
}catch(e){}})();`;

// …dentro del <head>:
<script dangerouslySetInnerHTML={{ __html: themeScript }} />
```

Se eliminó `src/components/shared/theme-script.tsx`. El comportamiento del tema
es idéntico (aplica `.dark` antes del primer pintado, sin flash); solo cambió
**dónde** vive el script.

> El script corre **síncronamente durante el parseo del HTML**, antes de que
> React entre en juego, por eso evita el flash mejor que `useEffect` o
> `useLayoutEffect`. Nota: bajo una CSP estricta sin `'unsafe-inline'`
> necesitarías un `nonce`.

---

## 10. Cómo verificar / comandos útiles

```bash
# (Node vía nvm)
nvm use            # usa la versión de .nvmrc (24)

npm run typecheck  # tsc --noEmit  → debe salir limpio
npm run dev        # servidor en http://localhost:3000
npm run build      # build de producción

# Validar JSON de mensajes
node -e "JSON.parse(require('fs').readFileSync('src/messages/es.json'));\
         JSON.parse(require('fs').readFileSync('src/messages/en.json'));\
         console.log('OK')"

# Rutas de la página
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/evo-ai      # ES
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/en/evo-ai   # EN
```

---

## 11. Cómo extender

- **Nueva sección**: copia el patrón `<section><Container><Reveal>…</Reveal>…`,
  añade sus textos a `pages.evoAi` en ambos JSON y léelos con `t`/`t.raw`.
- **Nuevo mockup**: reutiliza el marco (barra de ventana + `.glow-ring` +
  `animate-scan`) de `raw-signal.tsx` / `processed-signal.tsx`.
- **Más "futurismo"**: la utilidad `.glow-ring` y las animaciones
  `float/aurora/scan` ya están globales — puedes aplicarlas al pipeline o a las
  tarjetas de capacidades.
- **Curva sintética distinta**: ajusta `HUMPS`, `drift` o la amplitud de ruido
  en `raw-signal.tsx` (recuerda mantener el PRNG sembrado).
- **Captura real del producto**: podrías sustituir el cromatograma sintético
  por un screenshot real de `evo_ai` dentro del mismo marco.

---

## 12. Decisiones de diseño (por qué se hizo así)

1. **Metáfora nativa de cromatografía** en vez de una "nube de datos" genérica
   (primera versión, descartada) — para que la página sea inconfundiblemente de
   Evoelution y no una copia de TetraScience.
2. **Wordmark evolutivo** `Evo`~~`elution`~~`_AI` — comunica de un vistazo que
   Evo_AI es la evolución con IA de Evoelution.
3. **Términos técnicos sin traducir** — credibilidad ante químicos analíticos.
4. **Determinismo en las gráficas** (PRNG sembrado) — evita errores de
   hidratación de React con SSR.
5. **Animaciones respetando `prefers-reduced-motion`** — accesibilidad.
6. **Narrativa antes→después** (hero crudo → resultado limpio) — muestra el
   valor del producto sin explicarlo con texto.

---

*Última actualización: 2026-07-22. Mantener este documento junto al código si
la página evoluciona.*
