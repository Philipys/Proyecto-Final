# Especificación de Requisitos y Escenarios BDD (`spec/spec.md`)

Este documento constituye la especificación formal del proyecto (**Spec-Driven Development — SDD**) redactada **antes** de la implementación del código fuente. Toda regla de negocio, cálculo astronómico y endpoint CRUD debe satisfacer exactamente los umbrales y escenarios aquí definidos.

---

## 1. Catálogo de Sitios Lunares Base (Dataset NASA JPL Horizons 2027)
El sistema operará inicialmente con los 6 sitios oficiales definidos en el dataset del curso para el año **2027** (resolución horaria: 8,760 registros UTC por astro):

| ID del Sitio | Nombre | Longitud (°E) | Latitud (°) | Región / Característica |
| :--- | :--- | :---: | :---: | :--- |
| `apollo-11` | Apolo 11 — Mar de la Tranquilidad | `23.473` | `0.674` | Ecuatorial, cara visible |
| `chandrayaan-3` | Chandrayaan-3 — Shiv Shakti | `32.319` | `-69.373` | Latitud alta sur, cara visible |
| `im1-odysseus` | IM-1 Odysseus — Malapert A | `1.440` | `-80.130` | Polo Sur, cara visible (antecedente de vuelco) |
| `shackleton-rim` | Cráter Shackleton (Borde aprox.) | `130.000` | `-89.450` | Polo Sur extremo, picos de luz casi eterna |
| `south-pole-895` | Polo Sur Lunar (89.5°S) | `0.000` | `-89.500` | Polo Sur extremo, horizonte rasante |
| `change-4` | Chang'e-4 — Cráter Von Kármán | `177.599` | `-45.445` | **Cara oculta** (Tierra siempre bajo el horizonte) |

---

## 2. Requisitos Funcionales (RF)

### `RF-01` — Ingesta y Parsing de Efemérides NASA JPL Horizons
* El sistema debe parsear archivos de texto generados por `ssd.jpl.nasa.gov/api/horizons.api` extrayendo únicamente las filas comprendidas entre los marcadores `$$SOE` (*Start of Ephemeris*) y `$$EOE` (*End of Ephemeris*).
* Debe emparejar cada marca de tiempo UTC (`YYYY-MMM-DD HH:MM`) de la efeméride del **Sol (`COMMAND='10'`)** y de la **Tierra (`COMMAND='399'`)** para construir objetos `HourlyTelemetry` con `solarAzimuthDeg`, `solarElevationDeg`, `earthAzimuthDeg` y `earthElevationDeg`.
* Debe rechazar o reportar de forma controlada archivos sin marcadores `$$SOE`/`$$EOE` o con valores no numéricos.

### `RF-02` — Procesamiento de Topografía Láser LOLA (Polo Sur)
* El sistema debe proveer un extractor que procese el Modelo Digital de Elevación (DEM) binario LOLA (`ldem_80s_80m.img` junto con su etiqueta PDS `ldem_80s_80m.lbl`, proyección estereográfica polar 80°S–90°S a 80 m/píxel).
* A partir del relieve, debe generar una malla simplificada para el visor 3D y calcular la **pendiente topográfica local en grados** para sitios en la zona polar ($lat \le -80^\circ$).

### `RF-03` — Motor de Viabilidad de Misión (5 Reglas de Negocio)
Dada una configuración de misión (`siteId`, `startUtc`, `durationHours`, `batteryCapacityKwh`, `basePowerConsumptionKw`, `solarPanelMaxKw`, `hasRelaySatellite`, `evaRoute`), el dominio debe simular hora por hora y aplicar las siguientes **5 Reglas de Negocio**:

#### Regla 1: Iluminación y Sombras Topográficas
* **$El_{\text{Sol}} \le 0^\circ$:** Estado `NIGHT`. Oscuridad total. No apto para descenso visual.
* **$0^\circ < El_{\text{Sol}} < 3^\circ$:** Estado `LOW_SHADOWS`. Luz solar rasante que genera sombras kilométricas peligrosas. Emite alerta `CAUTION` para el instante del alunizaje.
* **$El_{\text{Sol}} \ge 3^\circ$:** Estado `OPTIMAL`. Iluminación segura para sensores LiDAR y cámaras de aterrizaje.

#### Regla 2: Simulación Energética Hora por Hora (Balance Batería vs. Sol)
* La misión inicia con la batería al **100% de su capacidad** (`batteryCapacityKwh`).
* Para cada hora $h$ de la misión:
  * Si $El_{\text{Sol}}(h) > 0^\circ$: la generación solar es $P_{\text{gen}}(h) = \text{solarPanelMaxKw} \cdot \sin(\max(El_{\text{Sol}}(h), 5^\circ)\text{ o ángulo efectivo})$ (acotado al máximo del panel, modelando paneles adaptativos/verticales en zonas polares o incidencia sinusoidal). *(Nota de especificación exacta para el MVP: $P_{\text{gen}}(h) = \text{solarPanelMaxKw} \cdot \min(1, \frac{\sin(\text{rad}(El_{\text{Sol}}(h)))}{\sin(\text{rad}(15^\circ))})$ cuando $El_{\text{Sol}}(h) > 0^\circ$, para reflejar paneles verticales orientables optimizados para ángulos polares que alcanzan 100% desde $15^\circ$, y $0$ cuando $El_{\text{Sol}}(h) \le 0^\circ$).*
  * El cambio neto de energía en la hora es $\Delta E = P_{\text{gen}}(h) - \text{basePowerConsumptionKw}$.
  * El estado de carga ($SoC$) se acota siempre al rango $[0\%, 100\%]$.
* **Criterio de fallo crítico:** Si en **cualquier hora** de la misión $SoC(h) < 20\%$, la regla energética falla y el dictamen global pasa automáticamente a **`NO-GO`**.

#### Regla 3: Enlace de Comunicaciones (Direct-to-Earth vs. Satélite Relay)
* Un enlace directo con la Tierra (`DTE`) requiere $El_{\text{Tierra}} \ge 5^\circ$ para evitar interferencia multicamino del horizonte lunar.
* Si durante la misión existen horas con $El_{\text{Tierra}} < 5^\circ$ y **`hasRelaySatellite == false`**:
  * Si el 100% de la misión carece de línea de vista (ej. cara oculta en *Chang'e-4*), el dictamen es **`NO-GO`** (*Pérdida total de telemetría sin satélite Relay*).
  * Si la pérdida de enlace directo ocurre de forma intermitente (entre $1\%$ y $< 100\%$ de las horas), el dictamen emite **`CAUTION`** (pérdida temporal de telemetría) salvo que supere el $50\%$ de la misión, en cuyo caso es **`NO-GO`**.
* Si **`hasRelaySatellite == true`**, la cobertura de comunicación se considera del **100% (`GO`)** independientemente de $El_{\text{Tierra}}$.

#### Regla 4: Pendiente Topográfica de Alunizaje
* Según la pendiente del sitio (`terrainSlopeDeg`):
  * **Pendiente $\le 10^\circ$:** Terreno estable (`GO`).
  * **Pendiente $> 10^\circ$ y $\le 15^\circ$:** Riesgo moderado de inclinación (`CAUTION`).
  * **Pendiente $> 15^\circ$:** Riesgo crítico de vuelco del módulo (`NO-GO`).

#### Regla 5: Seguridad de Ruta EVA (*Walk-Back Limit* con Haversine Lunar)
* La distancia entre cada par de *waypoints* consecutivos $(A, B)$ trazados en el mapa 3D se calcula mediante la fórmula de **Haversine** usando el radio medio lunar **$R_{\text{Luna}} = 1737.4\text{ km}$**.
* La distancia total de exploración ($d_{\text{total}}$) considera ida y retorno (o la ruta cerrada trazada), y su duración estimada a velocidad nominal del rover/astronauta ($v_{\text{EVA}} = 3.0\text{ km/h}$ por defecto) debe cumplir:
  1. $d_{\text{total}} \le \text{maxEvaRangeKm}$ (autonomía máxima de oxígeno/batería portátil, por defecto $10\text{ km}$).
  2. La actividad EVA debe completarse dejando al menos **2 horas de margen** antes de entrar en una hora de noche lunar ($El_{\text{Sol}} \le 0^\circ$) o blackout total de comunicaciones. Si viola cualquiera de las dos condiciones, el estado EVA es **`NO-GO`**.

#### Consolidación del Dictamen e Índice de Viabilidad (0–100)
* **`NO-GO`:** Se asigna si cualquiera de las reglas críticas falla (batería $<20\%$, aterrizaje nocturno $El_{\text{Sol}} \le 0^\circ$, pérdida crítica de comunicaciones, pendiente $>15^\circ$, o ruta EVA insegura).
* **`CAUTION`:** Ninguna regla falla críticamente, pero existe al menos una advertencia (sombras rasantes $0^\circ\text{–}3^\circ$, pendiente $10^\circ\text{–}15^\circ$, cortes parciales DTE $\le 50\%$, o batería mínima entre $20\%\text{–}35\%$).
* **`GO`:** Todas las reglas se cumplen dentro de márgenes óptimos.

### `RF-04` — Recomendador de Ventanas Óptimas en 2027
* Dado un `siteId`, una `durationHours` y `hasRelaySatellite`, el sistema debe recorrer las 8,760 horas de 2027 mediante ventana deslizante y devolver las **3 mejores fechas de alunizaje** ordenadas por puntaje de viabilidad y horas de luz continua.

### `RF-05` — Visor Lunar 3D Interactivo (WebGL / Three.js)
* Debe renderizar el globo lunar en 3D con los 6 sitios clicables, vector de iluminación solar dinámico según la hora simulada, vista de relieve polar LOLA y herramienta de selección de *waypoints* sobre la superficie para dibujar rutas EVA en tiempo real.

### `RF-06` — Gestión Persistente de Planes de Misión (CRUD + SQLite)
* El usuario debe poder **Crear** (`POST`), **Listar/Leer** (`GET`), **Actualizar** (`PUT`) y **Eliminar** (`DELETE`) planes de misión almacenados en SQLite, asociando sitio, parámetros de energía, ruta de waypoints, dictamen calculado y notas técnicas.

### `RF-07` — Comparador de Sitios
* El sistema debe permitir comparar al menos dos sitios (ej. *Apolo 11* vs. *Cráter Shackleton*) mostrando horas totales de luz solar por mes en 2027 y disponibilidad de comunicación directa con la Tierra.

---

## 3. Requisitos No Funcionales (RNF) y Seguridad
* **`RNF-01` (Validación de Entradas):** Latitud en $[-90, 90]$, Longitud en $[-180, 180]$, duración entre `1` y `720` horas; sanitización de textos contra XSS y rechazo de JSON malformado con código HTTP `400`.
* **`RNF-02` (Seguridad SQL):** 100% de las consultas a SQLite deben ejecutarse con *prepared statements* parametrizados (`?`).
* **`RNF-03` (Cero Secretos):** Ninguna credencial o ruta privada en el repositorio; configuración exclusiva mediante variables de entorno documentadas en `.env.example`.
* **`RNF-04` (Asincronía y Rendimiento):** Operaciones de red y BD mediante `async/await` con manejo explícito de errores; cálculo completo de ventana 2027 ($8,760$ horas) en menos de `200 ms`.
* **`RNF-05` (Accesibilidad y Web Moderna):** Contraste adecuado en HUD oscuro, soporte de navegación por teclado y uso de elementos nativos (`<dialog>`, `<label>`, atributos `aria-live`).

---

## 4. Escenarios de Aceptación BDD (Dado / Cuando / Entonces)

### Escenario 1: Detección de Noche Lunar en el momento del alunizaje (Regla 1)
* **Dado** el sitio `apollo-11` en una hora UTC donde la elevación solar registrada por JPL Horizons es `-12.4°`
* **Cuando** el usuario evalúa una misión iniciando en esa hora
* **Entonces** la regla de iluminación retorna estado `NIGHT` y el dictamen global de la misión es `NO-GO` indicando imposibilidad de descenso visual.

### Escenario 2: Alerta de Sombras Largas en el Polo Sur (Regla 1)
* **Dado** el sitio `shackleton-rim` con elevación solar de `+1.5°` al aterrizar y `+2.1°` durante la ventana, con pendiente de `6.0°`, batería sobre `50%` y satélite Relay activo
* **Cuando** se evalúa la misión
* **Entonces** la regla de iluminación emite `LOW_SHADOWS` y el dictamen global resulta `CAUTION` advirtiendo sombras rasantes.

### Escenario 3: Fallo Energético por Descarga Crítica de Batería (Regla 2)
* **Dado** una misión de `48` horas con batería inicial de `100 kWh`, consumo constante de `2.5 kW/h` y `36` horas consecutivas de oscuridad total ($El_{\text{Sol}} \le 0^\circ$)
* **Cuando** el simulador ejecuta el balance horario
* **Entonces** la batería cae a `10%` ($< 20\%$ crítico) en la hora `36` y el dictamen final es `NO-GO` por agotamiento energético.

### Escenario 4: Bloqueo de Cara Oculta sin Satélite Relay (Regla 3)
* **Dado** el sitio `change-4` (Cráter Von Kármán) donde $El_{\text{Tierra}} < 0^\circ$ durante toda la ventana evaluada
* **Cuando** el usuario evalúa una misión con `hasRelaySatellite = false`
* **Entonces** el sistema marca falla de comunicaciones y retorna dictamen `NO-GO` exigiendo habilitar un satélite retransmisor.

### Escenario 5: Pendiente Topográfica Peligrosa (Regla 4)
* **Dado** un punto de alunizaje cuya pendiente calculada sobre LOLA es `17.2°`
* **Cuando** se ejecuta el motor de viabilidad
* **Entonces** la regla topográfica falla por superar el límite de `15°` y el dictamen es `NO-GO` por riesgo de vuelco.

### Escenario 6: Ruta EVA Segura vs. Exceso de Alcance (Regla 5)
* **Dado** dos *waypoints* en la superficie lunar separados por `1.8 km` sobre esfera lunar ($R = 1737.4\text{ km}$) para una ruta ida y vuelta (`3.6 km` totales, `1.2 h` a `3 km/h`) con `10` horas restantes de luz solar
* **Cuando** se evalúa la ruta EVA
* **Entonces** la distancia se valida con margen de retorno superior a 2 horas antes del ocaso y la regla EVA retorna `GO`.
* **Pero si** la ruta suma `12.5 km` (superando la autonomía máxima de `10 km`) o termina `0.5 h` antes del ocaso, la regla EVA retorna `NO-GO`.

### Escenario 7: Flujo Completo CRUD de Plan de Misión
* **Dado** un plan de misión válido evaluado en el visor 3D
* **Cuando** el usuario lo guarda mediante `POST /api/missions`, luego consulta `GET /api/missions`, actualiza las notas y activa el satélite Relay mediante `PUT /api/missions/:id`, y finalmente lo elimina con `DELETE /api/missions/:id`
* **Entonces** SQLite persiste cada cambio, recalcula el dictamen al actualizar y responde con los códigos HTTP correctos (`201`, `200`, `200`, `200`) sin exponer errores SQL internos.
