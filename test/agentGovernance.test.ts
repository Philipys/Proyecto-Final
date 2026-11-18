import { describe, expect, it } from 'vitest';
import {
  evaluatePreToolUseHook,
  runGovernanceCliDemo,
  runLunarMissionAuditSkill,
} from '../src/server/agentGovernance.js';

describe('Bloque Avanzado — Hooks de Seguridad/Calidad y Skill Auditoría Lunar', () => {
  it('HOOK-GIT-01: bloquea push directo a main/master o force-push y aprueba ramas feat/*', () => {
    const pushMain = evaluatePreToolUseHook({
      hookEventName: 'PreToolUse',
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'git push origin main' },
      },
    });
    expect(pushMain.decision).toBe('deny');
    expect(pushMain.ruleId).toBe('HOOK-GIT-01');

    const forcePush = evaluatePreToolUseHook({
      hookEventName: 'PreToolUse',
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'git push --force origin feat/mcp-and-advanced-block' },
      },
    });
    expect(forcePush.decision).toBe('deny');
    expect(forcePush.ruleId).toBe('HOOK-GIT-01');

    const featPush = evaluatePreToolUseHook({
      hookEventName: 'PreToolUse',
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'git push origin feat/mcp-and-advanced-block' },
      },
    });
    expect(featPush.decision).toBe('allow');
    expect(featPush.ruleId).toBe('HOOK-OK');
  });

  it('HOOK-SEC-02: bloquea SQL destructivo (DROP TABLE / DELETE sin WHERE) y borrado recursivo de data/', () => {
    const dropTable = evaluatePreToolUseHook({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'sqlite3 data/lunar.sqlite "DROP TABLE missions;"' },
      },
    });
    expect(dropTable.decision).toBe('deny');
    expect(dropTable.ruleId).toBe('HOOK-SEC-02');

    const rmData = evaluatePreToolUseHook({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'rm -rf data/horizons' },
      },
    });
    expect(rmData.decision).toBe('deny');
    expect(rmData.ruleId).toBe('HOOK-SEC-02');
  });

  it('HOOK-SEC-03: bloquea secretos/tokens reales y escritura directa de .env con credenciales', () => {
    const githubPat = evaluatePreToolUseHook({
      toolCall: {
        name: 'write_file',
        args: {
          Path: 'src/server/secret.ts',
          Content: 'export const GH_TOKEN = "ghp_1234567890abcdefghijklmnop";',
        },
      },
    });
    expect(githubPat.decision).toBe('deny');
    expect(githubPat.ruleId).toBe('HOOK-SEC-03');

    const openAiKey = evaluatePreToolUseHook({
      toolCall: {
        name: 'edit_file',
        args: {
          Path: 'src/server/app.ts',
          Replacement: 'const key = "sk-1234567890abcdefghijklmnop";',
        },
      },
    });
    expect(openAiKey.decision).toBe('deny');
    expect(openAiKey.ruleId).toBe('HOOK-SEC-03');

    const dotEnvSecret = evaluatePreToolUseHook({
      toolCall: {
        name: 'write_file',
        args: {
          Path: '.env',
          Content: 'API_KEY=super_secret_token_123456',
        },
      },
    });
    expect(dotEnvSecret.decision).toBe('deny');
    expect(dotEnvSecret.ruleId).toBe('HOOK-SEC-03');
  });

  it('HOOK-SQL-04 y HOOK-ARCH-05: exige SQL parametrizado en src/server/ y pureza absoluta en src/domain/', () => {
    const badSql = evaluatePreToolUseHook({
      toolCall: {
        name: 'edit_file',
        args: {
          Path: 'src/server/SqliteMissionRepository.ts',
          Replacement: 'this.db.prepare(`SELECT * FROM missions WHERE id = ${id}`);',
        },
      },
    });
    expect(badSql.decision).toBe('deny');
    expect(badSql.ruleId).toBe('HOOK-SQL-04');

    const safeSql = evaluatePreToolUseHook({
      toolCall: {
        name: 'edit_file',
        args: {
          Path: 'src/server/SqliteMissionRepository.ts',
          Replacement: 'this.db.prepare("SELECT * FROM missions WHERE id = ?").get(id);',
        },
      },
    });
    expect(safeSql.decision).toBe('allow');

    const impureDomainImport = evaluatePreToolUseHook({
      toolCall: {
        name: 'edit_file',
        args: {
          Path: 'src/domain/MissionEvaluator.ts',
          Replacement: "import * as THREE from 'three';",
        },
      },
    });
    expect(impureDomainImport.decision).toBe('deny');
    expect(impureDomainImport.ruleId).toBe('HOOK-ARCH-05');

    const impureDomainDom = evaluatePreToolUseHook({
      toolCall: {
        name: 'write_file',
        args: {
          Path: 'src/domain/NewRule.ts',
          Content: 'export function readDom() { return document.title; }',
        },
      },
    });
    expect(impureDomainDom.decision).toBe('deny');
    expect(impureDomainDom.ruleId).toBe('HOOK-ARCH-05');
  });

  it('Skill FRR (runLunarMissionAuditSkill): audita misión NO-GO en cara oculta y remedia a GO', async () => {
    const report = await runLunarMissionAuditSkill({
      siteId: 'change-4',
      startUtc: '2027-01-01T00:00:00Z',
      durationHours: 72,
      batteryCapacityKwh: 120,
      baseConsumptionKw: 1.5,
      solarPanelMaxKw: 3.5,
      hasRelaySatellite: false,
    });

    expect(report.initialEvaluation.verdict).toBe('NO-GO');
    expect(report.remediatedConfig.hasRelaySatellite).toBe(true);
    expect(report.remediatedEvaluation.verdict).toBe('GO');
    expect(report.scoreDelta).toBeGreaterThan(0);
    expect(report.optimalWindows2027).toHaveLength(3);
    expect(report.siteComparison.siteA.site.id).toBe('change-4');
    expect(report.siteComparison.siteB.site.id).toBe('shackleton-rim');
    expect(report.recommendations.some((r) => r.includes('Relay'))).toBe(true);
  });

  it('Skill FRR: remedia alunizaje nocturno en Apolo 11 moviendo la fecha a la mejor ventana 2027', async () => {
    const nightReport = await runLunarMissionAuditSkill({
      siteId: 'apollo-11',
      startUtc: '2027-01-01T00:00:00Z',
      durationHours: 72,
      batteryCapacityKwh: 120,
      baseConsumptionKw: 1.5,
      solarPanelMaxKw: 3.5,
      hasRelaySatellite: true,
    });

    expect(nightReport.initialEvaluation.verdict).toBe('NO-GO');
    expect(nightReport.initialEvaluation.rules.lighting.landingState).toBe('NIGHT');
    expect(nightReport.remediatedConfig.startUtc).not.toBe('2027-01-01T00:00:00Z');
    expect(nightReport.remediatedEvaluation.verdict).toBe('GO');
    expect(nightReport.scoreDelta).toBeGreaterThan(0);

    const cliDemo = await runGovernanceCliDemo();
    expect(cliDemo).toContain('HOOK-GIT-01');
    expect(cliDemo).toContain('FLIGHT READINESS REVIEW');
    expect(cliDemo).toContain('Dictamen tras remediación: GO');
  });
});
