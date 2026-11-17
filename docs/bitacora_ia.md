# Bitácora de Ingeniería Agentic (`docs/bitacora_ia.md`)

Registro transparente de herramientas de IA utilizadas, decisiones tomadas frente al agente, verificaciones manuales y errores detectados/corregidos (Semanas 1–2 y Sección 8 de la guía del proyecto).

---

## 1. Herramientas de IA Configuradas
* **Entorno principal:** Antigravity IDE con acceso controlado al workspace y lectura directa de los documentos base del curso.
* **Plugins / Skills activos:** `modern-web-guidance` (Google Chrome) para evitar patrones obsoletos de HTML/CSS/JS en la construcción del Frontend web.
* **Instrucciones persistentes:** Definidas en [`AGENTS.md`](../AGENTS.md) para forzar separación en capas MVVM, TDD, validación de seguridad y estética técnica no genérica.

---

## 2. Registro Cronológico de Decisiones y Verificaciones

### Sesión 1 — Análisis de Requisitos, Selección de Tema y Mitigación de Convergencia de IA
* **Qué se delegó al agente:**
  * Lectura íntegra y síntesis de los entregables obligatorios de `Proyecto_Final.pdf` y los 14 retos de `SpaceApps2026_Datos_y_Enlaces_de_Descarga.pdf`.
  * Análisis técnico comparativo entre Flutter y Web App Moderna (TypeScript + Three.js) para implementar un mapa lunar 3D con rutas.
  * Redacción inicial de `AGENTS.md`, `docs/propuesta.md`, `spec/spec.md`, `docs/arquitectura.md` y `docs/api.md` **antes** de escribir código fuente.
* **Decisiones humanas y criterio crítico aplicado:**
  1. **Control contra "proyectos clónicos por IA":** Al ser tema abierto entre compañeros, se identificó el riesgo de que múltiples proyectos generados por IA repitan las mismas 3 ideas literales del PDF y la misma estética genérica. Se decidió exigir:
     * Procesamiento real del archivo binario científico LOLA (`ldem_80s_80m.img`) en lugar de depender solo de los `.txt` simples.
     * Estética técnica inspirada en consolas espaciales (*NASA OpenMCT*) y prohibición explícita de plantillas genéricas en `AGENTS.md`.
     * Backend real con API REST + SQLite para el CRUD de misiones en lugar de almacenamiento efímero en memoria/navegador.
  2. **Profundización de Reglas de Negocio:** Se rechazó una regla trivial (`elevación > 0`) y se especificaron 5 reglas cuantitativas en `spec/spec.md` (sombras rasantes $<3^\circ$, balance horario con reserva crítica $<20\%$, comunicaciones DTE $\ge 5^\circ$ vs. Relay en cara oculta, límite de vuelco topográfico $>15^\circ$ y autonomía EVA con Haversine lunar).
  3. **Orden del ciclo de vida:** Se exigió construir y revisar primero la especificación (`spec/spec.md`) y la arquitectura (`docs/arquitectura.md`) antes de generar código de `src/`, respetando el criterio de trazabilidad SDD del curso.
  4. **Context Engineering preventivo (a iniciativa del estudiante):** Al notar que los dos PDFs base sumaban 44 páginas pesadas (con 13 retos de la NASA que no se usarán), el estudiante propuso destilar la rúbrica del curso y únicamente las fichas/URLs del Challenge #6 en un archivo Markdown ligero ([`docs/contexto_referencia.md`](contexto_referencia.md)) y archivar los PDFs en `_archivos_originales_profe/` (ignorado por Git y restringido en `AGENTS.md`). Esto reduce el consumo de tokens, mantiene foco limpio y evita alucinaciones en sesiones largas.

---

## 3. Errores / Limitaciones del Agente Detectados y Corregidos
*(Nota: El curso exige documentar al menos **3 casos reales** a lo largo del proyecto donde el agente se equivocó, propuso algo inseguro/inviable o falló en el entorno. Este registro se irá ampliando en cada fase.)*

### Caso #1 — Intento de inicializar Git dentro de una carpeta padre que ya era un repositorio y bloqueo de permisos del sandbox
* **Qué ocurrió:** Al intentar inicializar el repositorio en `Proyecto Final` usando `git init -b main` seguido de `git remote add origin`, el comando `git init` falló silenciosamente en el primer paso por permisos del usuario de sandbox (`Phillip\CodexSandboxUsers`) sobre la carpeta en OneDrive. Al ejecutarse el segundo comando (`git remote add`), Git buscó hacia arriba en el árbol de directorios y detectó el repositorio padre `ClaseApps2026` (apuntando a otro remoto `ClaseApps2026.git`).
* **Cómo se detectó:** Revisando la salida real del comando (`Permission denied` + `git rev-parse --show-toplevel` apuntando a `ClaseApps2026` en lugar de `Proyecto Final`).
* **Corrección aplicada:** Se detuvo la ejecución inmediatamente, se evitó modificar el repositorio padre de la asignatura y se ajustó el plan para usar operaciones de escritura seguras (`write_file`) y aislar `git init` explícitamente dentro de `Proyecto Final`.

### Caso #2 — Error de unidades (`<m/pix>` vs. km) y `OFFSET` al decodificar el archivo científico LOLA DEM (`ldem_80s_80m.lbl`)
* **Qué ocurrió:** Al implementar la primera versión de `LolaDemExtractor.ts` sin haber leído el archivo `.lbl` descargado, el agente asumió que `MAP_SCALE` venía en kilómetros/píxel (`0.08`) y lo multiplicó por `1000`, además de sumar `OFFSET = 1737400` a la elevación. Como resultado, las elevaciones aparecían en `1,737,892 m` y la pendiente media calculada en el Polo Sur cayó falsamente a `0.02°` (dividiendo por 80 km en lugar de 80 m).
* **Cómo se detectó:** Inspeccionando los resultados reales impresos por el script (`min=1737892 m`, `pendiente media=0.02°`) y leyendo línea por línea la etiqueta oficial `data/lola/ldem_80s_80m.lbl`, donde la NASA documenta explícitamente `MAP_SCALE = 80 <m/pix>` y `HEIGHT = (DN * SCALING_FACTOR)` (mientras `OFFSET` convierte a radio planetario).
* **Corrección aplicada:** Se corrigió `parseLolaPdsLabel()` para leer la unidad real (`<m/pix>` vs. `<km/pix>`), se pasó `offset = 0` para alturas relativas al geoide lunar y se re-extrajo la grilla real `48x48` del Polo Sur, obteniendo valores físicos reales (`-766.5 m` a `-238.5 m` y pendiente media de `6.27°`).

*(Pendiente registrar Caso #3 durante las fases de Frontend 3D, Backend/Seguridad o MCP).*
