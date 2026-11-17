import type {
  LunarSite,
  LunarSiteId,
  MissionEvaluation,
  MissionPlan,
  RuleVerdict,
  SiteComparisonResponse,
} from '../models/lunar.types.js';
import type {
  NavigatorState,
  NavigatorViewModel,
} from '../viewmodels/NavigatorViewModel.js';
import { LunarScene3D } from './LunarScene3D.js';

function verdictSymbol(verdict: RuleVerdict): string {
  if (verdict === 'GO') return '● GO';
  if (verdict === 'CAUTION') return '▲ CAUTION';
  return '■ NO-GO';
}

function getEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Elemento HUD requerido no encontrado en DOM: #${id}`);
  }
  return el as unknown as T;
}

function installClosedByFallback(dialog: HTMLDialogElement): void {
  if ('closedBy' in HTMLDialogElement.prototype) {
    return;
  }

  const isOutside = (event: PointerEvent): boolean => {
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };

  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (event) => {
    pressedOutside = isOutside(event);
  });
  dialog.addEventListener('pointerup', (event) => {
    if (pressedOutside && isOutside(event)) {
      dialog.close();
    }
    pressedOutside = false;
  });
}

/**
 * Vista principal de la consola HUD estilo NASA OpenMCT.
 * Se suscribe a `NavigatorViewModel` y delega el render WebGL a `LunarScene3D`.
 */
export class HudConsoleView {
  private readonly viewModel: NavigatorViewModel;
  private readonly scene3D: LunarScene3D;
  private unsubscribe: (() => void) | null = null;
  private lastRenderedState: NavigatorState | null = null;
  private pendingDeleteMissionId: string | null = null;

  // Referencias cacheadas del DOM
  private readonly globalVerdictBadge = getEl<HTMLDivElement>('global-verdict-badge');
  private readonly globalVerdictText = getEl<HTMLSpanElement>('global-verdict-text');
  private readonly globalScoreText = getEl<HTMLSpanElement>('global-score-text');
  private readonly statusBanner = getEl<HTMLParagraphElement>('status-banner');
  private readonly errorBanner = getEl<HTMLParagraphElement>('error-banner');

  private readonly sitesList = getEl<HTMLUListElement>('sites-list');
  private readonly paramsForm = getEl<HTMLFormElement>('mission-params-form');
  private readonly inputStartUtc = getEl<HTMLInputElement>('input-start-utc');
  private readonly inputDurationHours = getEl<HTMLInputElement>('input-duration-hours');
  private readonly inputBatteryKwh = getEl<HTMLInputElement>('input-battery-kwh');
  private readonly inputConsumptionKw = getEl<HTMLInputElement>('input-consumption-kw');
  private readonly inputSolarKw = getEl<HTMLInputElement>('input-solar-kw');
  private readonly inputRelay = getEl<HTMLInputElement>('input-relay-satellite');
  private readonly paramsValidationError = getEl<HTMLParagraphElement>('params-validation-error');

  private readonly bestWindowsList = getEl<HTMLUListElement>('best-windows-list');
  private readonly refreshWindowsBtn = getEl<HTMLButtonElement>('refresh-windows-btn');

  private readonly activeSiteLabel = getEl<HTMLSpanElement>('active-site-label');
  private readonly modeGlobeBtn = getEl<HTMLButtonElement>('mode-globe-btn');
  private readonly modeLolaBtn = getEl<HTMLButtonElement>('mode-lola-btn');
  private readonly evaDrawBtn = getEl<HTMLButtonElement>('eva-draw-btn');
  private readonly evaUndoBtn = getEl<HTMLButtonElement>('eva-undo-btn');
  private readonly evaClearBtn = getEl<HTMLButtonElement>('eva-clear-btn');
  private readonly resetCameraBtn = getEl<HTMLButtonElement>('reset-camera-btn');

  private readonly canvasHost = getEl<HTMLDivElement>('lunar-canvas-host');
  private readonly viewportModeTag = getEl<HTMLSpanElement>('viewport-mode-tag');
  private readonly viewportHoverCoords = getEl<HTMLSpanElement>('viewport-hover-coords');

  private readonly hourOffsetSlider = getEl<HTMLInputElement>('hour-offset-slider');
  private readonly timelineHourDisplay = getEl<HTMLSpanElement>('timeline-hour-display');
  private readonly timelineUtcDisplay = getEl<HTMLTimeElement>('timeline-utc-display');

  private readonly telSolarEl = getEl<HTMLElement>('tel-solar-el');
  private readonly telSolarAz = getEl<HTMLElement>('tel-solar-az');
  private readonly telEarthEl = getEl<HTMLElement>('tel-earth-el');
  private readonly telTerrainSlope = getEl<HTMLElement>('tel-terrain-slope');
  private readonly telEvaDistance = getEl<HTMLElement>('tel-eva-distance');
  private readonly telMinBattery = getEl<HTMLElement>('tel-min-battery');
  private readonly energyChartSvg = getEl<SVGSVGElement>('energy-chart-svg');

  private readonly rulesList = getEl<HTMLUListElement>('rules-list');
  private readonly wpCount = getEl<HTMLSpanElement>('wp-count');
  private readonly waypointsList = getEl<HTMLOListElement>('waypoints-list');

  private readonly crudForm = getEl<HTMLFormElement>('mission-crud-form');
  private readonly inputMissionName = getEl<HTMLInputElement>('input-mission-name');
  private readonly inputMissionNotes = getEl<HTMLTextAreaElement>('input-mission-notes');
  private readonly crudValidationError = getEl<HTMLParagraphElement>('crud-validation-error');
  private readonly saveMissionBtn = getEl<HTMLButtonElement>('save-mission-btn');
  private readonly cancelEditBtn = getEl<HTMLButtonElement>('cancel-edit-btn');
  private readonly savedMissionsList = getEl<HTMLUListElement>('saved-missions-list');

  private readonly openComparatorBtn = getEl<HTMLButtonElement>('open-comparator-btn');
  private readonly comparatorDialog = getEl<HTMLDialogElement>('comparator-dialog');
  private readonly closeComparatorBtn = getEl<HTMLButtonElement>('close-comparator-btn');
  private readonly comparatorForm = getEl<HTMLFormElement>('comparator-form');
  private readonly selectCompareA = getEl<HTMLSelectElement>('select-compare-a');
  private readonly selectCompareB = getEl<HTMLSelectElement>('select-compare-b');
  private readonly comparatorSummary = getEl<HTMLDivElement>('comparator-summary');
  private readonly comparisonTable = getEl<HTMLTableElement>('comparison-table');
  private readonly comparisonTableBody = getEl<HTMLTableSectionElement>('comparison-table-body');
  private readonly thSiteASun = getEl<HTMLTableCellElement>('th-site-a-sun');
  private readonly thSiteADte = getEl<HTMLTableCellElement>('th-site-a-dte');
  private readonly thSiteBSun = getEl<HTMLTableCellElement>('th-site-b-sun');
  private readonly thSiteBDte = getEl<HTMLTableCellElement>('th-site-b-dte');

  private readonly deleteConfirmDialog = getEl<HTMLDialogElement>('delete-confirm-dialog');
  private readonly deleteConfirmMessage = getEl<HTMLParagraphElement>('delete-confirm-message');

  constructor(viewModel: NavigatorViewModel) {
    this.viewModel = viewModel;
    this.scene3D = new LunarScene3D(this.canvasHost, {
      onSelectSite: (siteId) => {
        void this.viewModel.selectSite(siteId);
      },
      onAddWaypoint: (waypoint) => {
        this.viewModel.addWaypoint(waypoint);
      },
      onHoverCoordinates: (info) => {
        this.viewportHoverCoords.textContent = info ?? 'LISTO PARA INSPECCIÓN';
      },
    });
  }

  mount(): void {
    this.bindEvents();
    this.unsubscribe = this.viewModel.subscribe((state) => {
      this.render(state);
    });
    this.render(this.viewModel.getState());
  }

  dispose(): void {
    this.unsubscribe?.();
    this.scene3D.dispose();
  }

  private bindEvents(): void {
    installClosedByFallback(this.comparatorDialog);
    installClosedByFallback(this.deleteConfirmDialog);

    // Limpiar errors en input y validar en blur (guía forms)
    const paramInputs = [
      this.inputStartUtc,
      this.inputDurationHours,
      this.inputBatteryKwh,
      this.inputConsumptionKw,
      this.inputSolarKw,
    ];
    for (const input of paramInputs) {
      input.addEventListener('input', () => {
        input.removeAttribute('aria-invalid');
        this.paramsValidationError.hidden = true;
      });
      input.addEventListener('blur', () => {
        this.validateMissionParamsForm(false);
      });
    }

    this.paramsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!this.validateMissionParamsForm(true)) {
        return;
      }
      const startValue = this.inputStartUtc.value.trim();
      const startUtc = `${startValue.slice(0, 13)}:00:00Z`;
      void this.viewModel.updateConfig({
        startUtc,
        durationHours: Number.parseInt(this.inputDurationHours.value, 10),
        batteryCapacityKwh: Number.parseFloat(this.inputBatteryKwh.value),
        baseConsumptionKw: Number.parseFloat(this.inputConsumptionKw.value),
        solarPanelMaxKw: Number.parseFloat(this.inputSolarKw.value),
        hasRelaySatellite: this.inputRelay.checked,
      });
    });

    this.inputRelay.addEventListener('change', () => {
      void this.viewModel.updateConfig({
        hasRelaySatellite: this.inputRelay.checked,
      });
    });

    this.refreshWindowsBtn.addEventListener('click', () => {
      void this.viewModel.refreshBestWindows();
    });

    this.modeGlobeBtn.addEventListener('click', () => {
      this.viewModel.setViewMode3D('GLOBE');
    });

    this.modeLolaBtn.addEventListener('click', () => {
      this.viewModel.setViewMode3D('LOLA_DEM');
    });

    this.evaDrawBtn.addEventListener('click', () => {
      this.viewModel.toggleEvaDrawMode();
    });

    this.evaUndoBtn.addEventListener('click', () => {
      this.viewModel.removeLastWaypoint();
    });

    this.evaClearBtn.addEventListener('click', () => {
      this.viewModel.clearWaypoints();
    });

    this.resetCameraBtn.addEventListener('click', () => {
      this.scene3D.resetCamera();
    });

    this.hourOffsetSlider.addEventListener('input', () => {
      this.viewModel.setActiveHourOffset(Number.parseInt(this.hourOffsetSlider.value, 10));
    });

    // Formulario CRUD
    this.inputMissionName.addEventListener('input', () => {
      this.inputMissionName.removeAttribute('aria-invalid');
      this.crudValidationError.hidden = true;
      this.viewModel.setDraftMetadata(
        this.inputMissionName.value,
        this.inputMissionNotes.value,
      );
    });
    this.inputMissionName.addEventListener('blur', () => {
      this.validateCrudForm(false);
    });
    this.inputMissionNotes.addEventListener('input', () => {
      this.viewModel.setDraftMetadata(
        this.inputMissionName.value,
        this.inputMissionNotes.value,
      );
    });

    this.crudForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!this.validateCrudForm(true)) {
        return;
      }
      this.viewModel.setDraftMetadata(
        this.inputMissionName.value,
        this.inputMissionNotes.value,
      );
      if (this.viewModel.getState().editingMissionId) {
        void this.viewModel.updateSelectedMission();
      } else {
        void this.viewModel.saveNewMission();
      }
    });

    this.cancelEditBtn.addEventListener('click', () => {
      this.crudValidationError.hidden = true;
      this.inputMissionName.removeAttribute('aria-invalid');
      this.viewModel.cancelEditingMission();
    });

    // Comparador de sitios (<dialog>)
    this.openComparatorBtn.addEventListener('click', () => {
      this.comparatorDialog.showModal();
      if (!this.viewModel.getState().comparison) {
        void this.viewModel.loadSiteComparison();
      }
    });

    this.closeComparatorBtn.addEventListener('click', () => {
      this.comparatorDialog.close();
    });

    this.comparatorDialog.addEventListener('close', () => {
      this.comparatorDialog.returnValue = '';
    });

    this.comparatorForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const siteA = this.selectCompareA.value as LunarSiteId;
      const siteB = this.selectCompareB.value as LunarSiteId;
      void this.viewModel.loadSiteComparison(siteA, siteB);
    });

    // Confirmación destructiva (<dialog>)
    this.deleteConfirmDialog.addEventListener('close', () => {
      const choice = this.deleteConfirmDialog.returnValue;
      this.deleteConfirmDialog.returnValue = '';
      const targetId = this.pendingDeleteMissionId;
      this.pendingDeleteMissionId = null;

      if (choice === 'confirm' && targetId) {
        void this.viewModel.deleteMission(targetId);
      }
    });
  }

  private validateMissionParamsForm(focusFirstInvalid: boolean): boolean {
    const startVal = this.inputStartUtc.value.trim();
    const duration = Number(this.inputDurationHours.value);
    const battery = Number(this.inputBatteryKwh.value);
    const consumption = Number(this.inputConsumptionKw.value);
    const solar = Number(this.inputSolarKw.value);

    let firstInvalid: HTMLInputElement | null = null;
    let message = '';

    if (!startVal || !startVal.startsWith('2027-')) {
      firstInvalid = this.inputStartUtc;
      message = 'La fecha de alunizaje debe pertenecer al año 2027.';
    } else if (!Number.isInteger(duration) || duration < 1 || duration > 720) {
      firstInvalid = this.inputDurationHours;
      message = 'La duración debe ser un entero entre 1 y 720 horas.';
    } else if (!Number.isFinite(battery) || battery <= 0 || battery > 10000) {
      firstInvalid = this.inputBatteryKwh;
      message = 'La capacidad de batería debe estar entre 1 y 10000 kWh.';
    } else if (!Number.isFinite(consumption) || consumption <= 0 || consumption > 1000) {
      firstInvalid = this.inputConsumptionKw;
      message = 'El consumo base debe ser mayor a 0 y hasta 1000 kW.';
    } else if (!Number.isFinite(solar) || solar < 0 || solar > 1000) {
      firstInvalid = this.inputSolarKw;
      message = 'La potencia solar máxima debe estar entre 0 y 1000 kW.';
    }

    if (firstInvalid) {
      firstInvalid.setAttribute('aria-invalid', 'true');
      this.paramsValidationError.textContent = message;
      this.paramsValidationError.hidden = false;
      if (focusFirstInvalid) {
        firstInvalid.focus();
      }
      return false;
    }

    this.paramsValidationError.hidden = true;
    return true;
  }

  private validateCrudForm(focusInvalid: boolean): boolean {
    const name = this.inputMissionName.value.trim();
    if (name.length === 0) {
      this.inputMissionName.setAttribute('aria-invalid', 'true');
      this.crudValidationError.textContent =
        'Ingresa un nombre para identificar el plan de misión.';
      this.crudValidationError.hidden = false;
      if (focusInvalid) {
        this.inputMissionName.focus();
      }
      return false;
    }

    this.inputMissionName.removeAttribute('aria-invalid');
    this.crudValidationError.hidden = true;
    return true;
  }

  private render(state: NavigatorState): void {
    const prev = this.lastRenderedState;
    this.lastRenderedState = state;

    this.renderHeaderAndBanners(state);
    this.renderSitesList(state.sites, state.selectedSiteId);
    this.syncParamsInputs(state, prev);
    this.renderBestWindows(state);
    this.renderViewportControlsAndTelemetry(state);
    this.renderRulesAndWaypoints(state);
    this.renderCrudSection(state);
    this.syncComparatorSelects(state.sites, state.comparisonSiteA, state.comparisonSiteB);

    if (state.comparison !== prev?.comparison && state.comparison) {
      this.renderComparisonData(state.comparison);
    }

    this.scene3D.renderState({
      sites: state.sites,
      selectedSiteId: state.selectedSiteId,
      viewMode3D: state.viewMode3D,
      evaDrawMode: state.evaDrawMode,
      waypoints: state.missionConfig.waypoints ?? [],
      currentHourTelemetry: state.currentHourTelemetry,
      lolaDem: state.lolaDem,
    });
  }

  private renderHeaderAndBanners(state: NavigatorState): void {
    if (state.evaluation) {
      this.globalVerdictBadge.dataset.verdict = state.evaluation.verdict;
      const parts = verdictSymbol(state.evaluation.verdict).split(' ');
      const iconSpan = this.globalVerdictBadge.firstElementChild;
      if (iconSpan) {
        iconSpan.textContent = parts[0] ?? '◆';
      }
      this.globalVerdictText.textContent = parts[1] ?? state.evaluation.verdict;
      this.globalScoreText.textContent = `${state.evaluation.viabilityScore}/100`;
    } else {
      this.globalVerdictBadge.dataset.verdict = 'PENDING';
      this.globalVerdictText.textContent = 'EVALUANDO';
      this.globalScoreText.textContent = '--/100';
    }

    this.statusBanner.textContent = state.statusBanner ?? 'Consola operativa.';
    if (state.errorMessage) {
      this.errorBanner.textContent = state.errorMessage;
      this.errorBanner.hidden = false;
    } else {
      this.errorBanner.textContent = '';
      this.errorBanner.hidden = true;
    }
  }

  private renderSitesList(sites: readonly LunarSite[], selectedId: LunarSiteId): void {
    const items: HTMLLIElement[] = [];

    for (const site of sites) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'site-card-btn';
      btn.setAttribute('aria-pressed', String(site.id === selectedId));
      btn.addEventListener('click', () => {
        void this.viewModel.selectSite(site.id);
      });

      const top = document.createElement('div');
      top.className = 'site-card-top';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = site.name;

      const sideTag = document.createElement('span');
      sideTag.className = site.isFarSide ? 'tag-chip tag-chip-farside' : 'tag-chip';
      sideTag.textContent = site.isFarSide ? 'CARA OCULTA' : 'CARA VISIBLE';

      top.append(nameSpan, sideTag);

      const meta = document.createElement('div');
      meta.className = 'site-card-meta';
      meta.textContent = `LAT ${site.latitudeDeg.toFixed(2)}° · LON ${site.longitudeDeg.toFixed(2)}° · PEND ${site.terrainSlopeDeg.toFixed(1)}°`;

      btn.append(top, meta);
      li.appendChild(btn);
      items.push(li);
    }

    this.sitesList.replaceChildren(...items);
  }

  private syncParamsInputs(state: NavigatorState, prev: NavigatorState | null): void {
    if (prev && prev.missionConfig === state.missionConfig) {
      return;
    }
    const cfg = state.missionConfig;
    const expectedLocalDt = cfg.startUtc.slice(0, 16);
    if (this.inputStartUtc.value !== expectedLocalDt) {
      this.inputStartUtc.value = expectedLocalDt;
    }
    this.inputDurationHours.value = String(cfg.durationHours);
    this.inputBatteryKwh.value = String(cfg.batteryCapacityKwh);
    this.inputConsumptionKw.value = String(cfg.baseConsumptionKw);
    this.inputSolarKw.value = String(cfg.solarPanelMaxKw);
    this.inputRelay.checked = cfg.hasRelaySatellite;
  }

  private renderBestWindows(state: NavigatorState): void {
    if (state.bestWindows.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'window-item';
      empty.textContent = 'Sin ventanas calculadas todavía.';
      this.bestWindowsList.replaceChildren(empty);
      return;
    }

    const items: HTMLLIElement[] = [];
    for (const win of state.bestWindows) {
      const li = document.createElement('li');
      li.className = 'window-item';

      const meta = document.createElement('div');
      meta.className = 'window-meta';

      const dateEl = document.createElement('span');
      dateEl.className = 'window-date';
      dateEl.textContent = `${win.startUtc.replace(':00:00Z', ':00Z')} (${verdictSymbol(win.verdict)})`;

      const statsEl = document.createElement('span');
      statsEl.className = 'window-stats';
      statsEl.textContent = `Score ${win.viabilityScore} · Sol ${win.daylightHours}h · Bat mín ${win.minBatteryPct.toFixed(0)}%`;

      meta.append(dateEl, statsEl);

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn btn-secondary';
      applyBtn.textContent = 'Aplicar';
      applyBtn.setAttribute('aria-label', `Aplicar ventana óptima ${win.startUtc}`);
      applyBtn.addEventListener('click', () => {
        void this.viewModel.applyOptimalWindow(win.startUtc);
      });

      li.append(meta, applyBtn);
      items.push(li);
    }

    this.bestWindowsList.replaceChildren(...items);
  }

  private renderViewportControlsAndTelemetry(state: NavigatorState): void {
    const activeSite = state.sites.find((s) => s.id === state.selectedSiteId);
    this.activeSiteLabel.textContent = activeSite ? activeSite.name : state.selectedSiteId;

    this.modeGlobeBtn.setAttribute('aria-pressed', String(state.viewMode3D === 'GLOBE'));
    this.modeLolaBtn.setAttribute('aria-pressed', String(state.viewMode3D === 'LOLA_DEM'));
    this.evaDrawBtn.setAttribute('aria-pressed', String(state.evaDrawMode));
    this.evaUndoBtn.disabled = (state.missionConfig.waypoints?.length ?? 0) === 0;
    this.evaClearBtn.disabled = (state.missionConfig.waypoints?.length ?? 0) === 0;

    this.viewportModeTag.textContent =
      state.viewMode3D === 'LOLA_DEM'
        ? 'MODO: RELIEVE LOLA DEM POLO SUR (80 m/px)'
        : 'MODO: GLOBO SELENOGRÁFICO 3D';

    const maxOffset = Math.max(0, state.telemetryWindow.length - 1);
    this.hourOffsetSlider.max = String(maxOffset);
    this.hourOffsetSlider.value = String(state.activeHourOffset);

    const paddedOffset = String(state.activeHourOffset).padStart(3, '0');
    this.timelineHourDisplay.textContent = `T+${paddedOffset}h`;

    const hourTel = state.currentHourTelemetry;
    if (hourTel) {
      this.timelineUtcDisplay.textContent = hourTel.utcIso;
      this.timelineUtcDisplay.setAttribute('datetime', hourTel.utcIso);
      this.telSolarEl.textContent = `${hourTel.solarElevationDeg.toFixed(2)}°`;
      this.telSolarAz.textContent = `${hourTel.solarAzimuthDeg.toFixed(1)}°`;
      this.telEarthEl.textContent = `${hourTel.earthElevationDeg.toFixed(2)}°`;
    } else {
      this.timelineUtcDisplay.textContent = state.missionConfig.startUtc;
      this.telSolarEl.textContent = '--°';
      this.telSolarAz.textContent = '--°';
      this.telEarthEl.textContent = '--°';
    }

    const slope =
      state.evaluation?.rules.terrain.slopeDeg ??
      activeSite?.terrainSlopeDeg ??
      0;
    this.telTerrainSlope.textContent = `${slope.toFixed(1)}°`;
    this.telEvaDistance.textContent = `${(state.evaluation?.rules.eva.roundTripKm ?? 0).toFixed(2)} km`;
    this.telMinBattery.textContent =
      state.evaluation !== null
        ? `${state.evaluation.rules.energy.minBatteryPct.toFixed(1)}%`
        : '--%';

    this.renderBatteryChart(state.evaluation, state.activeHourOffset);
  }

  private renderBatteryChart(
    evaluation: MissionEvaluation | null,
    activeHourOffset: number,
  ): void {
    const svgNs = 'http://www.w3.org/2000/svg';
    const width = 640;
    const height = 130;
    const padX = 28;
    const padY = 14;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    const nodes: SVGElement[] = [];
    const title = document.createElementNS(svgNs, 'title');

    if (!evaluation || evaluation.rules.energy.hourlySocPct.length === 0) {
      title.textContent = 'Sin datos de estado de carga de batería.';
      this.energyChartSvg.replaceChildren(title);
      return;
    }

    const socSeries = evaluation.rules.energy.hourlySocPct;
    title.textContent = `Batería mínima ${evaluation.rules.energy.minBatteryPct.toFixed(1)}%, final ${evaluation.rules.energy.finalBatteryPct.toFixed(1)}% durante ${socSeries.length} horas.`;
    nodes.push(title);

    // Línea umbral crítico 20%
    const criticalY = padY + plotH * (1 - 0.2);
    const critLine = document.createElementNS(svgNs, 'line');
    critLine.setAttribute('x1', String(padX));
    critLine.setAttribute('x2', String(width - padX));
    critLine.setAttribute('y1', criticalY.toFixed(1));
    critLine.setAttribute('y2', criticalY.toFixed(1));
    critLine.setAttribute('stroke', '#ef4444');
    critLine.setAttribute('stroke-width', '1.2');
    critLine.setAttribute('stroke-dasharray', '4 4');
    nodes.push(critLine);

    const critLabel = document.createElementNS(svgNs, 'text');
    critLabel.setAttribute('x', '4');
    critLabel.setAttribute('y', String(criticalY + 4));
    critLabel.setAttribute('fill', '#ef4444');
    critLabel.setAttribute('font-size', '10');
    critLabel.textContent = '20%';
    nodes.push(critLabel);

    const denom = Math.max(1, socSeries.length - 1);
    const pts = socSeries
      .map((pct, idx) => {
        const x = padX + (idx / denom) * plotW;
        const y = padY + plotH * (1 - Math.max(0, Math.min(100, pct)) / 100);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    const polyline = document.createElementNS(svgNs, 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#38bdf8');
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('points', pts);
    nodes.push(polyline);

    // Marcador de hora simulada actual
    const clampedIdx = Math.max(0, Math.min(activeHourOffset, socSeries.length - 1));
    const markerX = padX + (clampedIdx / denom) * plotW;
    const markerPct = socSeries[clampedIdx] ?? 100;
    const markerY = padY + plotH * (1 - Math.max(0, Math.min(100, markerPct)) / 100);

    const cursorLine = document.createElementNS(svgNs, 'line');
    cursorLine.setAttribute('x1', markerX.toFixed(1));
    cursorLine.setAttribute('x2', markerX.toFixed(1));
    cursorLine.setAttribute('y1', String(padY));
    cursorLine.setAttribute('y2', String(height - padY));
    cursorLine.setAttribute('stroke', '#fde047');
    cursorLine.setAttribute('stroke-width', '1');
    nodes.push(cursorLine);

    const cursorDot = document.createElementNS(svgNs, 'circle');
    cursorDot.setAttribute('cx', markerX.toFixed(1));
    cursorDot.setAttribute('cy', markerY.toFixed(1));
    cursorDot.setAttribute('r', '4');
    cursorDot.setAttribute('fill', '#fde047');
    nodes.push(cursorDot);

    this.energyChartSvg.replaceChildren(...nodes);
  }

  private renderRulesAndWaypoints(state: NavigatorState): void {
    const evalResult = state.evaluation;
    if (!evalResult) {
      this.rulesList.replaceChildren();
    } else {
      const ruleEntries: { title: string; status: RuleVerdict; reason: string }[] = [
        {
          title: '1. Iluminación y Sombras',
          status: evalResult.rules.lighting.status,
          reason: evalResult.rules.lighting.reason,
        },
        {
          title: '2. Balance Energético',
          status: evalResult.rules.energy.status,
          reason: evalResult.rules.energy.reason,
        },
        {
          title: '3. Enlace DTE / Relay',
          status: evalResult.rules.communications.status,
          reason: evalResult.rules.communications.reason,
        },
        {
          title: '4. Pendiente LOLA',
          status: evalResult.rules.terrain.status,
          reason: evalResult.rules.terrain.reason,
        },
        {
          title: '5. Ruta EVA (Haversine)',
          status: evalResult.rules.eva.status,
          reason: evalResult.rules.eva.reason,
        },
      ];

      const ruleNodes = ruleEntries.map((entry) => {
        const li = document.createElement('li');
        li.className = 'rule-card';
        li.dataset.status = entry.status;

        const header = document.createElement('div');
        header.className = 'rule-card-header';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'rule-title';
        titleSpan.textContent = entry.title;

        const statusSpan = document.createElement('span');
        statusSpan.className = 'rule-status-tag';
        statusSpan.dataset.status = entry.status;
        statusSpan.textContent = verdictSymbol(entry.status);

        header.append(titleSpan, statusSpan);

        const reasonP = document.createElement('p');
        reasonP.className = 'rule-reason';
        reasonP.textContent = entry.reason;

        li.append(header, reasonP);
        return li;
      });

      this.rulesList.replaceChildren(...ruleNodes);
    }

    const waypoints = state.missionConfig.waypoints ?? [];
    this.wpCount.textContent = String(waypoints.length);

    if (waypoints.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Activa "Trazar Ruta EVA" y haz clic en el visor 3D.';
      this.waypointsList.replaceChildren(li);
      return;
    }

    const wpNodes = waypoints.map((wp, idx) => {
      const li = document.createElement('li');
      const elevStr = wp.elevationM !== undefined ? ` · ${wp.elevationM.toFixed(0)} m` : '';
      li.textContent = `WP${idx + 1}: ${wp.latitudeDeg.toFixed(3)}°, ${wp.longitudeDeg.toFixed(3)}°${elevStr}`;
      return li;
    });
    this.waypointsList.replaceChildren(...wpNodes);
  }

  private renderCrudSection(state: NavigatorState): void {
    if (this.inputMissionName.value !== state.draftMissionName) {
      this.inputMissionName.value = state.draftMissionName;
    }
    if (this.inputMissionNotes.value !== state.draftMissionNotes) {
      this.inputMissionNotes.value = state.draftMissionNotes;
    }

    const isEditing = state.editingMissionId !== null;
    this.saveMissionBtn.textContent = isEditing
      ? 'Actualizar Plan en SQLite'
      : 'Guardar Plan en SQLite';
    this.cancelEditBtn.hidden = !isEditing;

    if (state.missions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'mission-card';
      empty.textContent = 'Aún no hay planes de misión persistidos en SQLite.';
      this.savedMissionsList.replaceChildren(empty);
      return;
    }

    const nodes = state.missions.map((plan) => this.buildMissionCard(plan));
    this.savedMissionsList.replaceChildren(...nodes);
  }

  private buildMissionCard(plan: MissionPlan): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'mission-card';

    const header = document.createElement('div');
    header.className = 'mission-card-header';

    const title = document.createElement('span');
    title.className = 'mission-card-title';
    title.textContent = plan.name;

    const status = document.createElement('span');
    status.className = 'rule-status-tag';
    status.dataset.status = plan.evaluation.verdict;
    status.textContent = `${verdictSymbol(plan.evaluation.verdict)} (${plan.evaluation.viabilityScore})`;

    header.append(title, status);

    const meta = document.createElement('div');
    meta.className = 'mission-card-meta';
    const wpCount = plan.config.waypoints?.length ?? 0;
    meta.textContent = `${plan.config.siteId} · ${plan.config.startUtc.slice(0, 16)}Z · ${plan.config.durationHours}h · ${wpCount} WP`;

    li.append(header, meta);

    if (plan.notes.trim().length > 0) {
      const notes = document.createElement('p');
      notes.className = 'mission-card-notes';
      notes.textContent = plan.notes;
      li.appendChild(notes);
    }

    const actions = document.createElement('div');
    actions.className = 'mission-card-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'Editar';
    editBtn.setAttribute('aria-label', `Editar plan ${plan.name}`);
    editBtn.addEventListener('click', () => {
      void this.viewModel.startEditingMission(plan);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.setAttribute('aria-label', `Eliminar plan ${plan.name}`);
    deleteBtn.addEventListener('click', () => {
      this.pendingDeleteMissionId = plan.id;
      this.deleteConfirmMessage.textContent = `¿Confirmas eliminar el plan "${plan.name}" y sus waypoints EVA de SQLite?`;
      this.deleteConfirmDialog.showModal();
    });

    actions.append(editBtn, deleteBtn);
    li.appendChild(actions);

    return li;
  }

  private syncComparatorSelects(
    sites: readonly LunarSite[],
    siteA: LunarSiteId,
    siteB: LunarSiteId,
  ): void {
    if (this.selectCompareA.options.length !== sites.length) {
      const buildOptions = (): HTMLOptionElement[] =>
        sites.map((site) => {
          const opt = document.createElement('option');
          opt.value = site.id;
          opt.textContent = site.name;
          return opt;
        });
      this.selectCompareA.replaceChildren(...buildOptions());
      this.selectCompareB.replaceChildren(...buildOptions());
    }
    this.selectCompareA.value = siteA;
    this.selectCompareB.value = siteB;
  }

  private renderComparisonData(comparison: SiteComparisonResponse): void {
    const buildSummaryCard = (
      label: string,
      summary: SiteComparisonResponse['siteA'],
    ): HTMLDivElement => {
      const card = document.createElement('div');
      card.className = 'compare-summary-card';

      const heading = document.createElement('h3');
      heading.textContent = `${label}: ${summary.site.name}`;

      const p1 = document.createElement('p');
      p1.textContent = `Luz solar 2027: ${summary.daylightHours} h / ${summary.totalHours} h (${summary.optimalLightingHours} h óptimas ≥ 3°)`;

      const p2 = document.createElement('p');
      p2.textContent = `Enlace DTE ≥ 5°: ${summary.directEarthLinkHours} h (${summary.directEarthLinkPct}%) · Pendiente ${summary.site.terrainSlopeDeg}°`;

      card.append(heading, p1, p2);
      return card;
    };

    this.comparatorSummary.replaceChildren(
      buildSummaryCard('Sitio A', comparison.siteA),
      buildSummaryCard('Sitio B', comparison.siteB),
    );

    const aSunLabel = `${comparison.siteA.site.id} Luz (h)`;
    const aDteLabel = `${comparison.siteA.site.id} DTE (%)`;
    const bSunLabel = `${comparison.siteB.site.id} Luz (h)`;
    const bDteLabel = `${comparison.siteB.site.id} DTE (%)`;

    this.thSiteASun.textContent = aSunLabel;
    this.thSiteADte.textContent = aDteLabel;
    this.thSiteBSun.textContent = bSunLabel;
    this.thSiteBDte.textContent = bDteLabel;

    this.comparisonTable.style.setProperty('--label-2', `"${aSunLabel}"`);
    this.comparisonTable.style.setProperty('--label-3', `"${aDteLabel}"`);
    this.comparisonTable.style.setProperty('--label-4', `"${bSunLabel}"`);
    this.comparisonTable.style.setProperty('--label-5', `"${bDteLabel}"`);

    const rows = comparison.siteA.monthly.map((monthA, idx) => {
      const monthB = comparison.siteB.monthly[idx];
      const tr = document.createElement('tr');

      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = monthA.month;

      const td1 = document.createElement('td');
      td1.textContent = String(monthA.daylightHours);

      const td2 = document.createElement('td');
      td2.textContent = `${monthA.directEarthLinkPct.toFixed(1)}%`;

      const td3 = document.createElement('td');
      td3.textContent = String(monthB?.daylightHours ?? 0);

      const td4 = document.createElement('td');
      td4.textContent = `${(monthB?.directEarthLinkPct ?? 0).toFixed(1)}%`;

      tr.append(th, td1, td2, td3, td4);
      return tr;
    });

    this.comparisonTableBody.replaceChildren(...rows);
  }
}
