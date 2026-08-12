#!/usr/bin/env node
/**
 * Preflight — lo que hay que verificar ANTES de gastar una corrida.
 *
 * Existía como promesa en tres archivos ("el preflight verifica que…") y no
 * existía como código. Escrito el 2026-08-12.
 *
 * Verifica cuatro cosas, en orden de gravedad:
 *
 *   1. 🚨 QUE EL ALIAS RESUELVA AL ORG ID ESPERADO.
 *      Un typo de alias apunta a la sandbox de otro cliente y **la corrida sale
 *      bien igual**: otro agente, otras respuestas, ningún error. Es la guarda
 *      que `agent.json` documentaba sin implementar.
 *
 *   2. 🚨 QUE LA BOTVERSION ACTIVA SEA LA DE MAYOR NÚMERO (D1).
 *      `run-eval` resuelve por `ORDER BY VersionNumber DESC` **sin filtrar por
 *      `Status`**; producción sirve la activa. Cuando difieren, la suite mide
 *      una versión que ningún usuario alcanza y los dos endpoints devuelven
 *      exit 0 con respuestas plausibles.
 *
 *      ⚠️ Esto NO reemplaza el gate post-corrida de `assert.mjs`. Entre esta
 *      consulta y el `run-eval` hay una ventana de carrera; la verificación que
 *      cierra es la que lee `sessionContext.tags.bot_version_id` de la corrida
 *      misma. El preflight sirve para no gastar el presupuesto de entrada, y
 *      para producir el `botVersionId` que después se le pasa a
 *      `--expect-version`.
 *
 *   3. Si la org tiene Testing Center (D9). 1 de 3 orgs medidas no lo tenía.
 *      No es bloqueante: `run-eval` no lo necesita, y es el motor recomendado.
 *
 *   4. Qué versión de la CLI corre (D22, D23).
 *
 * 🚨 LO QUE ESTE SCRIPT NO PUEDE VERIFICAR: que los flows del agente no escriban.
 * Eso se responde leyendo el XML del flow, a mano, una vez por agente. Ver
 * `knowledge/05-safety.md`. No lo automatices a partir de la prosa del `.agent`:
 * en dos rondas distintas la descripción decía lo contrario de lo que hacía el
 * flow.
 *
 *   node lib/preflight.mjs --agent agents/<slug>/agent.json [--json]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { toolingVersions } from './tooling.mjs';

/**
 * Ejecutor de `sf`. Inyectable para que los tests no toquen ninguna org.
 *
 * ⚠️ Windows: `sf` es un wrapper y desde Git Bash SIEMPRE devuelve exit 1, aun
 * en `sf --version`. Esto se corre desde PowerShell.
 */
export function sfJson(args, { exec = execFileSync } = {}) {
  try {
    const out = exec('sf', [...args, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // stderr descartado a propósito: el
      shell: true,                          // aviso de update rompe el parseo
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(String(out).slice(String(out).indexOf('{')));
  } catch (e) {
    return { status: 1, error: e?.message ?? String(e) };
  }
}

// --------------------------------------------------------------------------

/** Chequeo 1 — el alias tiene que resolver al Org Id declarado. */
export function checkOrg(agent, { exec } = {}) {
  const alias = agent?.org?.alias;
  const esperado = agent?.org?.orgId;
  if (!alias || !esperado || /REEMPLAZAR/.test(String(esperado))) {
    return { ok: false, fatal: true, motivo: 'agent.json no declara org.alias y org.orgId — sin eso no hay guarda' };
  }

  const r = sfJson(['org', 'display', '--target-org', alias], { exec });
  const real = r?.result?.id ?? null;
  if (!real) return { ok: false, fatal: true, alias, esperado, motivo: `no se pudo resolver el alias \`${alias}\`` };

  // Salesforce devuelve el Id de 18 a veces y de 15 otras. El de 15 es prefijo
  // del de 18, así que se comparan por el prefijo común.
  const norm = (s) => String(s).slice(0, 15);
  const ok = norm(real) === norm(esperado);
  return {
    ok, fatal: !ok, alias, esperado, real,
    motivo: ok ? null : `el alias \`${alias}\` resuelve a ${real}, no a ${esperado}. ES OTRA ORG.`,
  };
}

/** Chequeo 2 — la activa tiene que ser la de mayor número (D1). */
export function checkVersion(agent, { exec } = {}) {
  const apiName = agent?.apiName;
  const alias = agent?.org?.alias;
  if (!apiName) return { ok: false, fatal: true, motivo: 'agent.json no declara apiName' };

  const q = 'SELECT Id, VersionNumber, Status FROM BotVersion WHERE BotDefinition.DeveloperName = ' +
            `'${apiName}' ORDER BY VersionNumber DESC`;
  const r = sfJson(['data', 'query', '-q', q, '--target-org', alias], { exec });
  const recs = r?.result?.records ?? [];
  if (!recs.length) return { ok: false, fatal: true, motivo: `no hay BotVersion para \`${apiName}\`` };

  const mayor = recs[0];
  const activas = recs.filter((v) => v.Status === 'Active');

  if (activas.length !== 1) {
    return {
      ok: false, fatal: true, total: recs.length,
      motivo: `se esperaba exactamente 1 versión Active y hay ${activas.length}. Resolver antes de correr.`,
    };
  }

  const activa = activas[0];
  const ok = activa.Id === mayor.Id;
  return {
    ok, fatal: !ok, total: recs.length,
    activa: { id: activa.Id, versionNumber: activa.VersionNumber },
    mayor: { id: mayor.Id, versionNumber: mayor.VersionNumber },
    // Esto es lo que después se le pasa a `assert.mjs --expect-version`.
    expectVersion: activa.Id,
    motivo: ok ? null
      : `la activa es la v${activa.VersionNumber} y la de mayor número es la v${mayor.VersionNumber}. ` +
        'run-eval va a medir la v' + mayor.VersionNumber + ', que NINGÚN usuario alcanza — y no va a fallar (D1).',
  };
}

/** Chequeo 3 — Testing Center (D9). Informativo: `run-eval` no lo necesita. */
export function checkTestingCenter(agent, { exec } = {}) {
  const r = sfJson(['org', 'list', 'metadata', '--metadata-type', 'AiEvaluationDefinition',
                    '--target-org', agent?.org?.alias], { exec });
  const disponible = r?.status === 0;
  return {
    ok: true, fatal: false, disponible,
    motivo: disponible ? null
      : 'la org no expone `AiEvaluationDefinition`: `test run` no está disponible acá. ' +
        'No bloquea: `run-eval` es el motor recomendado y no lo necesita (D9).',
  };
}

// --------------------------------------------------------------------------

export function preflight(agent, { exec } = {}) {
  const org = checkOrg(agent, { exec });
  // Si el alias apunta a otra org, lo demás mide la org equivocada: no se sigue.
  const version = org.fatal ? { ok: false, fatal: true, motivo: 'no se evaluó: la guarda de org falló' }
                            : checkVersion(agent, { exec });
  const tc = org.fatal ? { ok: true, fatal: false, disponible: null, motivo: 'no se evaluó' }
                       : checkTestingCenter(agent, { exec });
  const tooling = toolingVersions();

  return {
    ok: !org.fatal && !version.fatal && tooling.available,
    org, version, testingCenter: tc, tooling,
    expectVersion: version.expectVersion ?? null,
  };
}

// --------------------------------------------------------------------------

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const agentPath = argOf('--agent');
  if (!agentPath) {
    console.error('uso: node lib/preflight.mjs --agent agents/<slug>/agent.json [--json]');
    process.exit(2);
  }
  const agent = JSON.parse(fs.readFileSync(agentPath, 'utf8'));
  const r = preflight(agent);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }

  const marca = (c) => (c.fatal ? '🚨' : c.ok ? '✅' : '⚠️ ');
  console.log('─'.repeat(64));

  console.log(`${marca(r.org)} org: ${r.org.alias ?? '?'} → ${r.org.real ?? '?'}`);
  if (r.org.motivo) console.log(`     ${r.org.motivo}`);

  if (r.version.activa) {
    console.log(`${marca(r.version)} versión: activa v${r.version.activa.versionNumber} · ` +
                `mayor v${r.version.mayor.versionNumber} · ${r.version.total} en total`);
  } else {
    console.log(`${marca(r.version)} versión: no determinada`);
  }
  if (r.version.motivo) console.log(`     ${r.version.motivo}`);

  console.log(`${marca(r.testingCenter)} Testing Center: ${r.testingCenter.disponible === null ? '—' : r.testingCenter.disponible ? 'disponible' : 'NO disponible'}`);
  if (r.testingCenter.motivo) console.log(`     ${r.testingCenter.motivo}`);

  console.log(r.tooling.available
    ? `✅ herramienta: sf ${r.tooling.cli} · plugin-agent ${r.tooling.pluginAgent}`
    : '🚨 herramienta: NO DETECTADA — el resultado no es auditable');
  if (r.tooling.warning) console.log(`     ⚠️  ${r.tooling.warning}`);

  console.log('─'.repeat(64));
  if (r.expectVersion) {
    console.log(`\n➡️  pasarle esto a assert.mjs:  --expect-version ${r.expectVersion}`);
    console.log('   ⚠️  El preflight NO cierra D1 solo: entre esta consulta y la corrida hay');
    console.log('   ventana de carrera. La verificación que cierra es la de assert.mjs, que');
    console.log('   lee la versión de la corrida misma.');
  }
  process.exit(r.ok ? 0 : 1);
}
