# AGENTS.md — Instrucciones Persistentes para el Agente

Este documento define las reglas obligatorias de arquitectura, proceso, interfaz, pruebas y seguridad que cualquier agente de IA debe seguir al trabajar en **Artemis Lunar Navigator** (Proyecto Final — Programación Asistida de Aplicaciones, USFQ 2026-10).

---

## 1. Contexto del Proyecto
- **Nombre:** Artemis Lunar Navigator
- **Origen del tema:** NASA Space Apps Challenge 2026 — Reto #6 (*Lunar Landing Site Navigator*).
- **Propósito:** Sistema de planificación y evaluación de viabilidad de alunizaje para 2027 que combina:
  1. Efemérides reales de **NASA JPL Horizons** (8,760 horas de 2027 por sitio).
  2. Topografía real del Polo Sur Lunar (**LOLA DEM** `.img` / `.lbl` a 80 m/píxel).
  3. Un **Visor Lunar 3D en WebGL (Three.js)** con trazado de rutas EVA.
  4. Un **Motor de 5 Reglas de Negocio** de ingeniería espacial y un **CRUD persistente en SQLite**.

---

## 1.1 Ingeniería de Contexto (Obligatorio para Sesiones Largas)
- **Fuente única de verdad compacta:** Toda referencia a la rúbrica de evaluación, estructura exigida y URLs/formatos de datos de NASA Challenge #6 debe consultarse en `docs/contexto_referencia.md`.
- **PROHIBIDO leer los archivos `.pdf` de `_archivos_originales_profe/`** salvo petición explícita del estudiante. Cargar PDFs completos consume innecesariamente la ventana de contexto y aumenta el riesgo de alucinaciones.
- **PROHIBIDO crear carpetas nuevas fuera del árbol oficial** definido en `docs/contexto_referencia.md` (`docs/`, `spec/`, `src/{models,domain,services,viewmodels,views,server}`, `data/{horizons,lola}`, `test/`, `.github/workflows/`, `evidencias/`). Antes de crear cualquier archivo, verificar su ruta en dicho árbol para no duplicar ni inventar directorios.

---

## 2. Arquitectura y Principios de Código (Obligatorios)
1. **Stack aprobado:**
   - **Frontend:** TypeScript + Vite + Three.js (WebGL) + CSS moderno nativo.
   - **Backend:** Node.js + TypeScript + Express + SQLite (`better-sqlite3`).
   - **Tests y Calidad:** Vitest + ESLint + TypeScript strict mode (`strict: true`).
2. **Separación en Capas (MVVM + Cliente-Servidor):**
   - `src/models/`: Entidades y tipos puros (`LunarSite`, `HourlyTelemetry`, `Waypoint`, `EvaRoute`, `MissionPlan`). Sin lógica de UI ni llamadas de red.
   - `src/domain/`: Reglas de negocio puras y deterministas (`MissionEvaluator`, `LunarGeometryService`). **Cero dependencias del DOM o de Express.**
   - `src/services/`: Lectura y transformación de datos externos (`HorizonsParser`, `LolaDemExtractor`, cliente HTTP).
   - `src/viewmodels/`: Estado de presentación y orquestación asíncrona entre el Backend REST y la Vista.
   - `src/views/`: Componentes de interfaz DOM y escena 3D (`LunarScene3D`). Prohibido poner reglas matemáticas de negocio o SQL aquí.
   - `src/server/`: API REST (`routes`, `controllers`, `repositories` con SQLite).
3. **SOLID y Código Limpio:**
   - Funciones pequeñas, un propósito por clase/módulo, sin duplicación de lógica y con tipado estricto (prohibido usar `any` sin justificación).

---

## 3. Reglas de UI/UX y Prevención de Diseño Clónico ("Mode Collapse")
- **Estética técnica obligatoria:** Consola de telemetría aeroespacial inspirada en **NASA OpenMCT / SpaceX Dragon HUD**:
  - Fondos oscuros neutros (`#090d12`, `#11161d`), bordes finos técnicos, tipografía monoespaciada para coordenadas, ángulos, horas UTC y porcentajes de batería (`tabular-nums`).
  - **PROHIBIDO** usar tarjetas genéricas moradas/neón con gradientes redondeados típicos de plantillas automáticas de IA.
- **Google Chrome Modern Web Guidance:**
  - Usar elementos HTML nativos y semánticos (`<dialog>`, `<main>`, `<aside>`, `<section>`, `<dl>`).
  - Usar CSS moderno (Custom Properties, Grid/Flex, `@starting-style`, `color-mix()` o contenedores modernos) sin añadir librerías de UI innecesarias.
  - Garantizar accesibilidad básica: etiquetas `<label>` explícitas, foco visible por teclado y atributos ARIA en indicadores dinámicos (`GO` / `CAUTION` / `NO-GO`).

---

## 4. Flujo de Trabajo SDD, TDD y Git
1. **Spec-Driven Development (SDD):** Ninguna regla de negocio nueva o cambio en umbrales puede implementarse sin estar documentado antes en `spec/spec.md`.
2. **Test-Driven Development (TDD):** Toda función de `src/domain/` y `src/services/` (parser de JPL Horizons, Haversine lunar, simulación de batería, pendiente LOLA, comunicaciones y validador) debe tener pruebas unitarias en `test/` cubriendo casos normales y casos borde.
3. **Flujo Git:**
   - **Prohibido hacer `push` directo a `main`.** Todo cambio entra mediante ramas pequeñas (`feat/...`, `docs/...`, `fix/...`) y Pull Request con el pipeline de GitHub Actions en verde.
   - Cada decisión relevante o error corregido al agente debe registrarse en `docs/bitacora_ia.md`.

---

## 5. Reglas de Seguridad (No Negociables)
1. **Cero secretos en el repositorio:** Jamás escribir API keys, contraseñas o tokens en el código fuente. Usar `.env` (ignorado por Git) y mantener `.env.example` actualizado.
2. **Consultas SQL parametrizadas:** Todo acceso a SQLite debe usar *prepared statements* con placeholders (`?`). Prohibida la concatenación de strings en SQL.
3. **Validación estricta de entradas:** Validar rangos en Backend y Dominio:
   - Latitud: `[-90, 90]`, Longitud: `[-180, 180]`.
   - Duración de misión: entero positivo (`1` a `720` horas).
   - Sanitizar cadenas de texto (`nombreMision`, `notas`) para evitar inyección HTML/XSS.
4. **Verificación de dependencias:** Antes de instalar cualquier paquete npm, verificar que existe, tiene mantenimiento activo y no introduce vulnerabilidades críticas (`npm audit`).
