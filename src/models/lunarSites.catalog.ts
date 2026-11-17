import type { LunarSite, LunarSiteId } from './lunar.types.js';

export const LUNAR_SITES: readonly LunarSite[] = [
  {
    id: 'apollo-11',
    name: 'Apolo 11 — Mar de la Tranquilidad',
    latitudeDeg: 0.674,
    longitudeDeg: 23.473,
    terrainSlopeDeg: 2.1,
    isFarSide: false,
    description:
      'Sitio ecuatorial histórico en cara visible. Ciclos largos (~14 días de Sol y ~14 días de noche lunar extrema).',
    solarFileName: 'Apollo11_Mar_Tranquilidad_Sol_2027_cada1h.txt',
    earthFileName: 'Apollo11_Mar_Tranquilidad_Tierra_2027_cada1h.txt',
  },
  {
    id: 'chandrayaan-3',
    name: 'Chandrayaan-3 — Shiv Shakti',
    latitudeDeg: -69.373,
    longitudeDeg: 32.319,
    terrainSlopeDeg: 4.8,
    isFarSide: false,
    description:
      'Latitud alta austral en cara visible. Referencia de alunizaje exitoso de alta latitud en terrenos moderados.',
    solarFileName: 'Chandrayaan3_69S_Sol_2027_cada1h.txt',
    earthFileName: 'Chandrayaan3_69S_Tierra_2027_cada1h.txt',
  },
  {
    id: 'im1-odysseus',
    name: 'IM-1 Odysseus — Malapert A',
    latitudeDeg: -80.13,
    longitudeDeg: 1.44,
    terrainSlopeDeg: 11.8,
    isFarSide: false,
    description:
      'Región polar sur en cara visible. Antecedente real de riesgo topográfico por pendiente pronunciada (~12°).',
    solarFileName: 'IM1_Odysseus_Malapert_A_Sol_2027_cada1h.txt',
    earthFileName: 'IM1_Odysseus_Malapert_A_Tierra_2027_cada1h.txt',
  },
  {
    id: 'shackleton-rim',
    name: 'Cráter Shackleton (Borde aprox.)',
    latitudeDeg: -89.45,
    longitudeDeg: 130.0,
    terrainSlopeDeg: 6.4,
    isFarSide: false,
    description:
      'Borde polar sur candidato Artemis. Elevada persistencia solar con ángulos rasantes que proyectan sombras largas.',
    solarFileName: 'Shackleton_borde_aprox_Sol_2027_cada1h.txt',
    earthFileName: 'Shackleton_borde_aprox_Tierra_2027_cada1h.txt',
  },
  {
    id: 'south-pole-895',
    name: 'Polo Sur Lunar (89.5°S)',
    latitudeDeg: -89.5,
    longitudeDeg: 0.0,
    terrainSlopeDeg: 7.5,
    isFarSide: false,
    description:
      'Zona polar extrema con horizonte solar y terrestre rasante. Requiere control estricto de batería y antena.',
    solarFileName: 'Polo_Sur_89_5S_Sol_2027_cada1h.txt',
    earthFileName: 'Polo_Sur_89_5S_Tierra_2027_cada1h.txt',
  },
  {
    id: 'change-4',
    name: "Chang'e-4 — Cráter Von Kármán",
    latitudeDeg: -45.445,
    longitudeDeg: 177.599,
    terrainSlopeDeg: 3.4,
    isFarSide: true,
    description:
      'Cara oculta lunar. Sin visibilidad directa hacia la Tierra: exige satélite retransmisor (Relay) obligatorio.',
    solarFileName: 'ChangE4_Von_Karman_Sol_2027_cada1h.txt',
    earthFileName: 'ChangE4_Von_Karman_Tierra_2027_cada1h.txt',
  },
];

export function getLunarSiteById(siteId: LunarSiteId): LunarSite | undefined {
  return LUNAR_SITES.find((site) => site.id === siteId);
}
