# Propuesta de Proyecto Final — Artemis Lunar Navigator

**Asignatura:** Programación Asistida de Aplicaciones (USFQ · Semestre 2026-10)  
**Modalidad:** Proyecto individual (acordado con el docente; alcance planteado como MVP acotado pero completo en todos los requisitos técnicos del curso)  
**Repositorio:** `https://github.com/Philipys/Proyecto-Final`  
**Tema de referencia:** NASA Space Apps Challenge 2026 — Challenge #6 (*Lunar Landing Site Navigator*)

---

## 1. Definición del Problema
Planificar un alunizaje en el año **2027** —especialmente en el **Polo Sur Lunar** donde se concentran las misiones Artemis— es un problema crítico de ingeniería de sistemas. A diferencia de la Tierra, la Luna carece de atmósfera que difumine la luz y posee una rotación lenta (~29.5 días terrestres por día lunar):

* En zonas ecuatoriales (*Apolo 11*), un módulo experimenta ~14 días continuos de Sol seguidos de ~354 horas de noche extrema ($-170^\circ\text{C}$).
* En el Polo Sur (*Cráter Shackleton*, *Malapert A*, *Polo Sur 89.5°S*), el Sol orbita casi rasante al horizonte ($-5^\circ$ a $+5^\circ$), generando sombras kilométricas peligrosas para los sensores de descenso y haciendo determinante cada grado de inclinación del terreno.
* En la cara oculta (*Chang'e-4* en el cráter Von Kármán), la Tierra jamás supera el horizonte, imposibilitando las comunicaciones directas sin un satélite retransmisor (*Relay*).

Actualmente, un estudiante o planificador principiante debe cruzar manualmente archivos de efemérides astronómicas sin interfaz gráfica (JPL Horizons) y modelos binarios de elevación láser (LOLA DEM) para responder una pregunta concreta: **¿Es viable alunizar en este sitio, en esta fecha de 2027, con esta batería y recorrer esta ruta EVA?**

---

## 2. Usuarios Objetivo
1. **Estudiantes e investigadores de ingeniería aeroespacial / ciencias planetarias** que necesitan evaluar visual e interactivamente ventanas de alunizaje para 2027.
2. **Divulgadores y docentes STEM** que requieren comparar de forma clara sitios históricos (*Apolo 11*, *Chang'e-4*, *Chandrayaan-3*, *IM-1 Odysseus*) frente a futuros sitios Artemis en el Polo Sur.

---

## 3. Solución Propuesta y Alcance del MVP
**Artemis Lunar Navigator** es una aplicación web de consola técnica (inspirada en NASA OpenMCT) que integra **efemérides reales de NASA JPL Horizons (2027)** y **datos topográficos reales LOLA (`ldem_80s_80m.img`)** dentro de un **visor lunar 3D interactivo en WebGL (Three.js)** acoplado a un **Motor de Viabilidad de Misiones** y persistencia en **SQLite**.

### Funcionalidades del MVP (Flujo completo de usuario)
1. **Globo Lunar 3D + Terreno LOLA + Trazador EVA:**
   * Visualización 3D interactiva de la Luna con los **6 sitios reales del dataset NASA**, iluminación solar dinámica sincronizada con la fecha/hora seleccionada y clic en superficie para trazar *waypoints* de caminata espacial (EVA).
   * Extracción de relieve y pendientes reales del Polo Sur a partir del binario científico LOLA (`ldem_80s_80m.img` / `.lbl`), superando el uso exclusivo de archivos de texto planos.
2. **Simulador del Cielo Lunar y Motor de 5 Reglas de Negocio:**
   * Evaluación hora por hora durante toda la duración de la misión sobre las 8,760 horas de 2027: (1) Iluminación y sombras rasantes, (2) Balance energético batería vs. paneles solares, (3) Enlace de comunicaciones DTE o satélite Relay, (4) Pendiente segura de aterrizaje, y (5) Autonomía de retorno EVA (*Haversine lunar*).
   * Emisión de dictamen cuantitativo (`GO` / `CAUTION` / `NO-GO`) y **buscador automático de las 3 mejores ventanas de alunizaje** en 2027.
3. **Bitácora Persistente de Misiones (CRUD + API REST + SQLite):**
   * Creación, consulta, actualización, comparación lado a lado y eliminación de **Planes de Misión** almacenados en base de datos SQLite local mediante una API REST documentada.

---

## 4. Diferenciadores Técnicos y Viabilidad sin Costo
* **Costo cero y sin datos personales:** Todos los datasets (JPL Horizons y LOLA PDS) son públicos, gratuitos y no requieren cuenta ni datos de usuarios reales.
* **Stack justificado:** **TypeScript + Vite + Three.js (Frontend MVVM)** y **Node.js + Express + SQLite (Backend REST)**, permitiendo renderizado 3D nativo en navegador, análisis estático estricto y pruebas automatizadas rápidas en CI/CD.
