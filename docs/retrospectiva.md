# Retrospectiva del Proyecto (`docs/retrospectiva.md`)

Evaluación final del proceso de construcción, contraste metodológico entre *vibe coding* e ingeniería *agentic*, métricas finales verificadas y límites conocidos de **Artemis Lunar Navigator** (Fase 8 — Cierre y Release `v1.0`).

---

## 1. *Vibe Coding* vs. *Agentic Engineering*: Lecciones Aprendidas

Durante el desarrollo de **Artemis Lunar Navigator**, la diferencia entre pedir código "al vuelo" (*vibe coding*) y trabajar con un **harness de ingeniería *agentic*** fue decisiva para la calidad técnica del producto:

| Dimensión | Qué habría ocurrido con *Vibe Coding* | Qué ocurrió con *Agentic Engineering* en este proyecto |
| :--- | :--- | :--- |
| **Especificación y alcance** | Prompts sueltos generando reglas triviales (`elevación > 0`) y datos ficticios en memoria. | Se redactaron primero [`docs/propuesta.md`](propuesta.md), [`spec/spec.md`](../spec/spec.md) (escenarios BDD) y [`docs/arquitectura.md`](arquitectura.md) antes de escribir código en `src/`. |
| **Estética y UI** | Tarjetas genéricas oscuras con gradientes morados/neón (*mode collapse*) e `innerHTML` inseguro. | [`AGENTS.md`](../AGENTS.md) prohibió plantillas genéricas y el skill `modern-web-guidance` guió el diseño de una consola aeroespacial tipo NASA OpenMCT con `<dialog>`, CSS moderno y cero `innerHTML`. |
| **Contexto en sesiones largas** | Relectura repetida de 44 páginas de PDFs saturando la ventana de contexto y causando olvidos de rutas. | El estudiante creó [`docs/contexto_referencia.md`](contexto_referencia.md) como fuente única compacta de verdad y restringió el árbol oficial en `AGENTS.md`. |
| **Detección de errores físicos/matemáticos** | Errores silenciosos: alturas LOLA en `1,737,892 m` (`0.02°` de pendiente) y distorsión polar de `6.4%` cerca de Shackleton. | Las pruebas TDD en [`test/horizonsParser.test.ts`](../test/horizonsParser.test.ts) y [`test/lunarSceneMath.test.ts`](../test/lunarSceneMath.test.ts) expusieron ambos bugs de inmediato antes de hacer merge. |
| **Control de cambios y seguridad** | Pushes directos a `main`, posibles fugas de secretos o acoplamiento entre Three.js/SQLite y el dominio. | Ramas pequeñas (`feat/...`, `docs/...`), Pull Requests obligatorios con CI en verde, Hooks `PreToolUse` (`HOOK-GIT-01` a `HOOK-ARCH-05`) y `0` vulnerabilidades en producción. |

---

## 2. Métricas Finales Verificadas (Previo a Release `v1.0`)

| Indicador | Resultado Verificado | Herramienta / Comando |
| :--- | :--- | :--- |
| **Suite de pruebas automatizadas** | **8 archivos / 42 pruebas pasando (100% verde)** en `1.38 s` | `npm run test:coverage` (Vitest v5.1.0) |
| **Cobertura por capas (v8)** | `models`: **100% Stmts / 100% Funcs**<br>`domain`: **91.74% Stmts / 85.37% Branch / 100% Funcs**<br>`server`: **84.90% Stmts / 92.30% Funcs**<br>`services`: **77.77% Stmts / 96.15% Funcs**<br>`viewmodels`: **73.49% Stmts / 87.09% Funcs**<br>Global (incluye `LunarScene3D.ts` WebGL): **60.43% Stmts / 77.77% Funcs** | `vitest run --coverage` |
| **Análisis estático y tipos** | **0 errores, 0 warnings** (`strict: true`) | `npm run lint` (ESLint) y `npm run typecheck` (`tsc --noEmit`) |
| **Dependencias de producción** | **4 paquetes** (`better-sqlite3`, `cors`, `express`, `three`) — **0 vulnerabilidades** | `npm audit --omit=dev` |
| **Datasets NASA integrados** | **12 archivos JPL Horizons 2027** (8,760 h × 6 sitios) + **LOLA DEM** (`ldem_80s_80m.lbl` + grilla `48×48` a `80 m/px`) | `src/services/downloadNasaData.ts` |
| **Integración Continua (GitHub)** | **5 Pull Requests** revisados hacia `main` con rama `main` protegida y artefacto `build-and-coverage-report` | `.github/workflows/ci.yml` |
| **MCP y Bloque Avanzado** | **1 servidor MCP propio** (4 herramientas, dual Stdio + HTTP) + **5 Hooks `PreToolUse`** + **1 Skill FRR** | `npm run mcp:demo`, `npm run agent:governance` |

---

## 3. Qué Funcionó Bien, Qué Fue Retador y Límites Conocidos

### Qué funcionó mejor
* **Separación estricta MVVM + Dominio puro:** Permitió probar todas las reglas espaciales, la simulación de batería y los endpoints SQLite en milisegundos sin arrancar un navegador WebGL ni acoplar Three.js a la lógica de negocio.
* **Reutilización entre Backend REST, Servidor MCP y Skill FRR:** Tanto la API Express (`/api/missions`), como el servidor MCP (`/api/mcp` y `stdio`) y el Skill de auditoría (`runLunarMissionAuditSkill`) consumen exactamente el mismo `MissionEvaluator` y `validateMissionConfigInput`, evitando discrepancias de cálculo.

### Principales retos superados
1. **Aislamiento de repositorio en Windows/OneDrive (Caso #1 en `docs/bitacora_ia.md`):** Resolver permisos de sandbox y evitar contaminar el repositorio padre de la asignatura.
2. **Decodificación fiel de estándares planetarios PDS3 y geometría polar (Casos #2 y #3):** Leer directamente la etiqueta oficial `.lbl` y aplicar proyección acimutal equidistante esférica para eliminar el sesgo en latitudes cercanas a `-90°`.
3. **Renderizado WebGL seguro y accesible:** Evitar `innerHTML` en toda la interfaz, soportar navegación por teclado y modales nativos `<dialog>` manteniendo fluidez sobre la escena Three.js.

### Límites conocidos (Alcance MVP `v1.0`)
* **Cobertura de renderizado WebGL (`LunarScene3D.ts`, 10.18%):** Se cubrieron con pruebas unitarias todas las funciones matemáticas puras (`latLonToLunarCartesian`, `cartesianToLatLon`, `azElToDirectionVector`, `lolaGridPointToWorld`), dejando fuera de Vitest las llamadas directas al contexto WebGL/DOM de Three.js, que fueron verificadas visualmente en navegador vivo (`evidencias/06_app_visor_3d_y_ruta_eva.png` y `07_app_simulador_5_reglas_y_crud.png`).
* **Resolución topográfica local (`48×48` píxeles):** Cubre `3.84 km × 3.84 km` a `80 m/px`; misiones multipunto a escala regional requerirían un servidor de teselas progresivo en `v2.0`.
* **Vulnerabilidades transitivas solo en `devDependencies`:** Las 12 alertas `high` de `picomatch` (`GHSA-fc5q-39xc-vjpf`) afectan únicamente a herramientas de desarrollo (`vitest`, `vite`, `typescript-eslint`), con `0` vulnerabilidades en producción.

---

## 4. Plan de Defensa en Vivo (Semana 16)
1. **Demo en vivo (y video Plan B):** Selección de sitios (*Shackleton*, *Chang'e-4*, *Apolo 11*), alternancia entre Globo Lunar 3D y malla real LOLA `80 m/px`, trazado de ruta EVA con recalculo instantáneo de las 5 reglas, búsqueda de ventanas óptimas 2027 y CRUD completo persistido en SQLite.
2. **Recorrido por el ciclo de vida:** `spec/spec.md` -> `docs/arquitectura.md` -> PR con CI verde en GitHub -> servidor MCP (`npm run mcp:demo`) y Bloque Avanzado (`npm run agent:governance`).
3. **Explicación de código y modificación en vivo:** Dominio puro en `src/domain/MissionEvaluator.ts`, consultas parametrizadas en `src/server/SqliteMissionRepository.ts` y proyección polar en `src/views/LunarScene3D.ts`.
