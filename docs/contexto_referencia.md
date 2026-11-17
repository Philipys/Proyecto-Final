# Contexto de Referencia Compacto (`docs/contexto_referencia.md`)

> **Propósito (Context Engineering — Semana 7):** Este documento condensa los requisitos oficiales de la asignatura (`Proyecto_Final.pdf`) y exclusivamente los datos, especificaciones y URLs del **Challenge #6: Lunar Landing Site Navigator** (`SpaceApps2026_Datos_y_Enlaces_de_Descarga.pdf`, págs. 17–19).  
> Sirve como **fuente única de verdad ligera** para los agentes de IA en futuras sesiones, evitando releer PDFs extensos (~44 páginas en total) y previniendo saturación de contexto o alucinaciones.

---

## Sección A — Requisitos Oficiales del Proyecto Final (USFQ 2026-10)

### 1. Condiciones Generales y Modalidad Individual
* **Evaluación integral:** No se evalúa solo que funcione; se evalúa **cómo se construyó** (especificación, arquitectura, implementación con agentes, pruebas, CI/CD, seguridad y entrega) y que el estudiante entienda y defienda cualquier parte del código en vivo.
* **Proyecto individual (acordado con el docente):** El alcance funcional se acota como MVP viable para 1 persona, **pero exige los mismos requisitos técnicos y entregables** del repositorio.
* **Regla de oro:** *"Si no está en el repositorio, no existe para la evaluación."*
* **Costo cero y privacidad:** Todo corre localmente o en planes gratuitos; prohibido usar datos personales reales. Prohibido hacer un proyecto que sea solo un chatbot sobre una API.

### 2. Núcleo Obligatorio por Semanas y Evidencia en el Repositorio

| Semanas | Tema | Qué exige el proyecto | Evidencia en el repo |
| :---: | :--- | :--- | :--- |
| **1–2** | Rol de IA, vibe coding vs. agentic engineering | Uso consciente: qué delegas y qué verificas. Nada «a ciegas». Al menos **3 errores reales del agente** documentados. | `docs/bitacora_ia.md` |
| **3** | SDLC agentic, harness, Git básico | Flujo con ramas pequeñas e instrucciones persistentes para el agente. | `AGENTS.md`; ramas y PRs |
| **4** | Cliente-servidor, REST/APIs, asincronía, BD | Frontend + datos persistentes. API REST con endpoints y JSON documentados. Asincronía bien manejada. | `docs/api.md`; código |
| **5–6** | Arquitectura (POO, SOLID, clean), MVVM, persistencia | Separación en capas y patrón (MVVM o equivalente). Base de datos local (SQLite) o nube gratuita. | `docs/arquitectura.md` (con diagrama) |
| **7** | Context Engineering + SDD | Especificación antes del código: requisitos, criterios de aceptación y escenarios BDD. | `spec/spec.md` |
| **8** | Calidad: TDD, linting, refactor, PRs, code review | Pruebas automatizadas (unitarias + al menos 1 flujo principal), linter limpio, reporte de cobertura y revisión de PRs. | `test/`; PRs; reporte cobertura |
| **9** | CI/CD | Pipeline en GitHub Actions en cada PR (análisis, pruebas, compilación); `main` protegida; entrega de artefacto (build web / APK). | `.github/workflows/`; `evidencias/` |
| **10** | MCP | Usar al menos un servidor MCP en el desarrollo y/o construir uno propio que exponga una función del proyecto. | `docs/mcp.md`; código MCP |
| **13–14** | Seguridad agentic y evaluación | Cero secretos en repo (`.env.example`), validación de entradas, mínimo privilegio, revisión de dependencias, modelo de amenazas breve. | `docs/seguridad.md`; `.env.example` |
| **15–16** | Integración, documentación y defensa | `README.md` claro (descripción, instalación, ejecución, capturas, licencia y créditos), release `v1.0` con artefacto, retrospectiva y demo en vivo (+ video plan B). | `README.md`, `docs/retrospectiva.md`, tag `v1.0` |

### 3. Bloque Avanzado (Elegir e Implementar AL MENOS UNO)
1. **Skill propio (Semana 12):** Un *Agent Skill* para una tarea recurrente del proyecto, con pruebas de que se activa y mejora el resultado.
2. **Orquestación multi-agente (Semanas 3, 11):** Flujo con orquestador y agentes especializados aplicado a un caso real y comparado con un solo agente.
3. **Evaluación y control humano / HITL (Semana 14):** Checkpoint *Human-in-the-Loop*, métricas de observabilidad y esquema de evaluación.
4. **Hooks de calidad o seguridad (Semanas 7, 8, 13):** Hooks que ejecuten linter/pruebas tras ediciones o bloqueen acciones peligrosas, con evidencia.

### 4. Investigación (10 pts — `docs/investigacion.md`)
Aplicar algo **no visto en clase** (ej. WebGL 3D con Three.js + procesamiento binario LOLA DEM + pruebas E2E/accesibilidad) documentando:
1. Qué se investigó y por qué es relevante.
2. Fuentes oficiales citadas.
3. Cómo cambió el código (enlaces a commits/PRs).
4. Resultados y límites (qué funcionó, qué no y qué se haría distinto).
5. Verificación (pruebas/demo y qué errores del agente se corrigieron).

### 5. Árbol Oficial de Carpetas del Proyecto (Pág. 5 PDF + Rutas Fijas del Proyecto)
> **Regla estricta para agentes:** Respetar exactamente esta estructura de carpetas. **No crear directorios inventados o duplicados fuera de este árbol**; verificar siempre aquí antes de generar un archivo nuevo.

```text
Proyecto-Final/
├── README.md                 # qué es, cómo instalarlo y ejecutarlo, capturas, autor, licencia
├── AGENTS.md                 # instrucciones persistentes para el agente
├── .env.example              # variables necesarias, sin valores reales
├── .gitignore                # ignora node_modules, .env, *.sqlite, _archivos_originales_profe/
├── docs/
│   ├── propuesta.md          # Fase 1: problema, usuarios y MVP (1 página)
│   ├── arquitectura.md       # Fase 3: capas, patrón MVVM, persistencia y diagrama
│   ├── api.md                # Semana 4: endpoints REST, payloads JSON y esquema SQLite
│   ├── seguridad.md          # Fase 7 / Sem 13-14: modelo de amenazas, secretos, entradas, dependencias
│   ├── mcp.md                # Semana 10: servidor MCP usado y/o construido
│   ├── investigacion.md      # Sección 6: qué se investigó, fuentes, aplicación, límites y verificación
│   ├── bitacora_ia.md        # Sección 8: herramientas, qué se verificó a mano y >= 3 errores del agente
│   ├── retrospectiva.md      # Fase 8: lecciones aprendidas y límites conocidos
│   └── contexto_referencia.md# Fuente compacta de verdad (Context Engineering)
├── spec/
│   └── spec.md               # Fase 2: especificación SDD y escenarios BDD antes del código
├── src/
│   ├── models/               # Entidades y tipos puros (LunarSite, HourlyTelemetry, MissionPlan...)
│   ├── domain/               # Motor de 5 reglas (MissionEvaluator) y geometría (LunarGeometryService)
│   ├── services/             # HorizonsParser, LolaDemExtractor, cliente API
│   ├── viewmodels/           # Estado y lógica de presentación MVVM (NavigatorViewModel)
│   ├── views/                # UI HUD y escena 3D Three.js (LunarScene3D)
│   └── server/               # Backend Express REST API + repositorio SQLite
├── data/
│   ├── horizons/             # Los 12 archivos .txt de NASA JPL Horizons 2027 (6 sitios: Sol y Tierra)
│   └── lola/                 # Etiqueta ldem_80s_80m.lbl y grilla procesada de relieve del Polo Sur
├── test/                     # Fase 5: pruebas automatizadas unitarias y de flujo principal (Vitest)
├── .github/workflows/        # Fase 6: pipeline CI/CD (ci.yml)
└── evidencias/               # Capturas de protección de main, CI, cobertura, MCP y bloque avanzado
```

### 6. Las 8 Fases del Ciclo de Vida (Sección 5) y Reglas del Repo (Sección 7–8)
1. **Idea y alcance** (`docs/propuesta.md`) · 2. **Especificación SDD** (`spec/spec.md`, escenarios BDD) · 3. **Arquitectura** (`docs/arquitectura.md`, diagrama) · 4. **Implementación asistida** (`AGENTS.md`, ramas pequeñas, PRs) · 5. **Pruebas y calidad** (`test/`, TDD, linter, code review) · 6. **CI/CD** (workflow en verde + artefacto) · 7. **Seguridad** (`docs/seguridad.md`) · 8. **Cierre y retrospectiva** (`README.md`, release `v1.0`, `docs/retrospectiva.md`).
* **Reglas obligatorias del repositorio y uso responsable de IA:** Repo público o con acceso al profesor; `main` protegida (solo merge por PR con CI verde, cero push directo); verificar que las dependencias existan, se mantengan y no tengan CVEs; incluir licencia y créditos; el estudiante **debe poder explicar y modificar en vivo cualquier archivo entregado** (código no explicado = no verificado).

### 7. Hitos (Semanas 10–16), Defensa (Semana 16), Ponderación y Checklist
* **Hitos:** Sem 10–11 (`docs/propuesta.md` + link repo) · Sem 12 (Aprobación MVP) · Sem 13 (`spec/`, `docs/arquitectura.md`, `AGENTS.md`) · Sem 14 (Esqueleto + CI verde + primer flujo + MCP inicial) · Sem 15 (Revisión de avance con núcleo casi completo) · Sem 16 (Release `v1.0`, docs completas y Defensa / Prueba 2).
* **Defensa en vivo (Semana 16):** (1) Demo en vivo del flujo principal + video grabado como Plan B; (2) Recorrido por el ciclo de vida (`spec/`, arquitectura, un PR real, CI/CD y uso de MCP); (3) Preguntas individuales y modificación en vivo del código; (4) Presentación de `docs/investigacion.md` y lecciones *vibe coding* vs. *agentic engineering*.
* **Ponderación (100 pts):** Ciclo de vida y proceso (**20**) · Producto funcional y arquitectura (**20**) · Calidad y automatización (**15**) · Uso de agentes/MCP/Bloque avanzado (**15**) · Seguridad (**10**) · Investigación (**10**) · Documentación y defensa (**10**).
* **Checklist obligatorio:**
  - [ ] Repo público (o con acceso al profesor) y rama `main` protegida.
  - [ ] `README.md` con descripción, instalación, ejecución, capturas, licencia y créditos.
  - [ ] `spec/` con requisitos, criterios de aceptación y escenarios BDD.
  - [ ] `docs/arquitectura.md` con diagrama y decisiones (justificación de stack web vs. Flutter).
  - [ ] Pruebas automatizadas y CI en verde; artefacto generado.
  - [ ] Al menos un servidor MCP usado o construido, documentado en `docs/mcp.md`.
  - [ ] Un elemento del Bloque Avanzado con evidencia.
  - [ ] `docs/seguridad.md` y cero secretos en historial Git.
  - [ ] `docs/investigacion.md` con fuentes, aplicación y resultados.
  - [ ] `docs/bitacora_ia.md` con al menos tres errores del agente documentados.
  - [ ] Release `v1.0` publicado con artefacto.

---

## Sección B — Ficha y Enlaces Oficiales del Reto #6: *Lunar Landing Site Navigator*

* **Página oficial del challenge:** `spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator`
* **Objetivo original:** Aplicación web/móvil/visualización 2D-3D para evaluar rápidamente sitios y fechas de alunizaje en 2027.
* **Portales de referencia:**
  * LROC Quickmap: `https://quickmap.lroc.asu.edu/`
  * NASA Moon Trek: `https://trek.nasa.gov/moon/`
  * JPL Horizons System: `https://ssd.jpl.nasa.gov/horizons/`
  * CSA Moon Exploration: `https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/`
  * PGDA DEMs LOLA mayor resolución (5–20 m): `https://pgda.gsfc.nasa.gov/products/90`

### 1. Formato de los Datasets
* **Dataset 1 — JPL Horizons (`2027`, paso `1h`):**
  * Efemérides sin atmósfera vista desde la Luna (`CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`).
  * `COMMAND='10'` = Sol · `COMMAND='399'` = Tierra.
  * Tabla CSV delimitada entre marcadores `$$SOE` y `$$EOE`: fecha/hora UTC, azimut (°) y elevación (°). `Elevación > 0` indica astro sobre el horizonte.
* **Dataset 2 — LOLA DEM Polo Sur (`80°S a 90°S`, `80 m/píxel`):**
  * Modelo Digital de Elevación láser del *Lunar Reconnaissance Orbiter* en proyección estereográfica polar.
  * `ldem_80s_80m.img` (binario de alturas, ~110.2 MB) + `ldem_80s_80m.lbl` (etiqueta PDS con formato y proyección, ~5 KB).

### 2. Tabla Completa de Enlaces Directos de Descarga (Sin Cuenta)

| Archivo | Descripción | Sitio / Parámetros | Enlace directo oficial |
| :--- | :--- | :--- | :--- |
| `ldem_80s_80m.lbl` | Etiqueta PDS LOLA (5 KB) | Polo Sur 80°S–90°S | `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_80m.lbl` |
| `ldem_80s_80m.img` | DEM binario LOLA 80 m/px (110.2 MB) | Polo Sur 80°S–90°S | `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_80m.img` |
| `Apollo11_Mar_Tranquilidad_Sol_2027_cada1h.txt` | Sol 2027 (433 KB) | `lon 23.473E, lat 0.674` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='23.473,0.674,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `Apollo11_Mar_Tranquilidad_Tierra_2027_cada1h.txt` | Tierra 2027 (433 KB) | `lon 23.473E, lat 0.674` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='399'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='23.473,0.674,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `Chandrayaan3_69S_Sol_2027_cada1h.txt` | Sol 2027 (433 KB) | `lon 32.319E, lat -69.373` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='32.319,-69.373,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `Chandrayaan3_69S_Tierra_2027_cada1h.txt` | Tierra 2027 (433 KB) | `lon 32.319E, lat -69.373` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='399'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='32.319,-69.373,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `IM1_Odysseus_Malapert_A_Sol_2027_cada1h.txt` | Sol 2027 (433 KB) | `lon 1.44E, lat -80.13` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='1.44,-80.13,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `IM1_Odysseus_Malapert_A_Tierra_2027_cada1h.txt` | Tierra 2027 (433 KB) | `lon 1.44E, lat -80.13` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='399'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='1.44,-80.13,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `Shackleton_borde_aprox_Sol_2027_cada1h.txt` | Sol 2027 (433 KB) | `lon 130.0E, lat -89.45` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='130.0,-89.45,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `Shackleton_borde_aprox_Tierra_2027_cada1h.txt` | Tierra 2027 (433 KB) | `lon 130.0E, lat -89.45` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='399'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='130.0,-89.45,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `Polo_Sur_89_5S_Sol_2027_cada1h.txt` | Sol 2027 (433 KB) | `lon 0.0E, lat -89.5` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='0.0,-89.5,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `Polo_Sur_89_5S_Tierra_2027_cada1h.txt` | Tierra 2027 (433 KB) | `lon 0.0E, lat -89.5` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='399'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='0.0,-89.5,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `ChangE4_Von_Karman_Sol_2027_cada1h.txt` | Sol 2027 (433 KB) | `lon 177.599E, lat -45.445` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='177.599,-45.445,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
| `ChangE4_Von_Karman_Tierra_2027_cada1h.txt` | Tierra 2027 (433 KB) | `lon 177.599E, lat -45.445` | `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='399'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='177.599,-45.445,0'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'` |
