#!/usr/bin/env node
/**
 * Capa de aserción propia.
 *
 * Los motores de la CLI de Salesforce tienen los datos bien y la comparación mal.
 * Este módulo ignora el veredicto de la CLI y re-evalúa el JSON crudo.
 *
 * Defectos que corrige (ver knowledge/02-known-issues.md):
 *   D2  el exit code no refleja los fallos de aserción — en los DOS motores
 *   D6  run-eval compara nombres de acción contra objetos anidados -> falso negativo
 *   D7  run-eval usa `contains` para topic -> falso positivo por substring
 *   D5  actions es subconjunto -> `expectedActions: []` no asserta nada
 *   D1  la versión se resuelve por número más alto ignorando Status
 *   D3  una aserción puede no ejecutarse sin que se vea -> de ahí el censo
 *
 * Deliberadamente NO fuerza igualdad exacta siempre: el literal de escalación
 * varía por motor (`human` / `human__` / `__human__`), así que la comparación
 * es configurable por caso.
 *
 * Uso:
 *   node lib/assert.mjs --raw runs/<ts>/raw.json --suite agents/<slug>/suites/x.cases.yaml
 *                       [--engine run-eval|test-run] [--gate-only]
 *                       [--expect-version <botVersionId>]
 */

import fs from 'node:fs';
import YAML from 'yaml';
import { extract, parseRaw } from './extract.mjs';
import { sentToEngine } from './gen-spec.mjs';

// --------------------------------------------------------------------------
// Normalización
// --------------------------------------------------------------------------

/**
 * `test run` devuelve los valores HTML-escapados: los nombres de acción vienen
 * como `[&#39;AGENTFORCE_Answer_question_with_knowledge&#39;]`.
 *
 * 🚨 Sin esto, TODA aserción de acciones sobre `test run` es un falso negativo.
 * Estuvo así hasta la ronda 3 porque el wrapper nunca se había corrido contra
 * ese motor.
 */
export function unescapeHtml(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // &amp; al final: si no, des-escapa de más
}

/**
 * `run-eval` emite dos formas según el flag (`--json` vs `--result-format json`)
 * y `test run` una tercera. `extract.mjs` ya tolera las dos primeras; acá se
 * agrega la de `test run`, cuya salida no tiene `outputs[]` sino `generatedData`.
 *
 * OJO (D15): sin `expectedOutcome`, `test create` inyecta bot_response_rating y
 * CADA caso arrastra un "Outcome Test Result Status: ERROR" con
 * "Skip metric result due to missing expected input" — aun con
 * "Run Status: Completed". Un parser que busque la cadena ERROR marca la suite
 * entera como fallida. Por eso el error de ejecución se lee de
 * `c.errorMessage` / `c.status`, NUNCA de los resultados de métricas.
 */
function normalizeTestRun(doc) {
  const cases = doc?.result?.testCases ?? doc?.testCases ?? [];
  return cases.map((c, i) => {
    const gd = c.generatedData ?? {};
    // actionsSequence viene como string "['A', 'B']" — no como array — y además
    // HTML-escapado. Hay que des-escapar ANTES de partir por comas.
    const actions = unescapeHtml(gd.actionsSequence ?? '')
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    return {
      index: i,
      id: c.testNumber != null ? `case_${c.testNumber}` : `case_${i}`,
      status: c.status ?? null,
      error: c.errorMessage ?? null,
      topic: gd.topic ?? null,
      invokedActions: actions,
      // `null` = "el motor no puede informarlo" → SKIP.
      // `[]` sería "no hubo ninguna" → FAIL si se esperaban.
      // La distinción importa: con `[]` el SKIP no se disparaba nunca y toda
      // aserción de utilActions sobre `test run` daba falso negativo.
      utilActions: null,        // test run no expone executionHistory
      stateVariables: null,     // ni stateVariables
      response: gd.generatedResponse ?? null,
      metrics: (c.testResults ?? [])
        .filter((r) => r.metricLabel && !/assertion/.test(r.metricLabel))
        .map((r) => ({ name: r.metricLabel, score: r.score, result: r.result, explain: r.metricExplainability ?? '' })),
    };
  });
}

export function normalize(text, engine) {
  if (engine === 'test-run') {
    const doc = JSON.parse(text.slice(text.indexOf('{')));
    const cases = normalizeTestRun(doc);
    const raw = doc?.result?.testCases ?? doc?.testCases ?? [];
    cases.forEach((c, i) => {
      c.evaluations = (raw[i]?.testResults ?? []).map((r) => ({ key: r.metricLabel, actual: r.actualValue }));
    });
    // 🚨 `test run` NO expone la versión servida. Por ningún camino: ni en el
    // JSON, ni en el AiEvaluationDefinition, ni en el export. Ver 02, D1.
    return { version: { botVersionId: null, consistent: true, seen: [], unavailable: true }, cases };
  }
  const ev = extract(text);
  const { tests } = parseRaw(text);
  return {
    version: ev.version,
    cases: ev.cases.map((c, i) => ({
      ...c,
      error: c.errors?.length ? JSON.stringify(c.errors) : null,
      evaluations: (tests[i]?.evaluations ?? tests[i]?.evaluation_results ?? []).map((e) => ({
        key: e.id ?? e.type,
        actual: e.actual_value,
        expected: e.expected_value,
        // Se guarda pero NO se usa como veredicto: la plataforma da `is_pass:
        // false` a `check_actions` aun cuando la acción SÍ se invocó (medido en
        // esta misma corrida). Por eso todo se recalcula. Sirve de contraste.
        isPass: e.is_pass,
      })),
    })),
  };
}

// --------------------------------------------------------------------------
// Veredicto de las customEvaluations
// --------------------------------------------------------------------------

/**
 * 🚨 POR QUÉ ESTO EXISTE — falso negativo medido el 2026-08-13.
 *
 * Hasta hoy `customEvaluations` entraba en el CENSO (declaré N, volvieron N)
 * pero su veredicto NO se calculaba en ningún lado. El censo verifica que la
 * aserción se HAYA EJECUTADO, no que haya dado bien. Consecuencia:
 *
 *   una comparación de contenido con el literal esperado equivocado
 *   devolvía PASSED y exit 0.
 *
 * Medido: se cambió el literal de C01 por «MENTIRA ABSOLUTA QUE EL AGENTE NUNCA
 * DIJO», se corrió contra el MISMO crudo, y salió `6 passed · 0 failed`.
 *
 * Es un falso negativo en la capacidad que `knowledge/00-index.md` llama el
 * hallazgo 4 —la verificación de contenido determinista, «lo mejor que
 * encontramos»— y en la dirección más peligrosa: marcaba como bueno algo roto.
 * Los tres bugs de `assert.mjs` de la ronda 3 iban al revés (marcaban como roto
 * algo que estaba bien), que es molesto pero no engaña.
 *
 * El operador se recalcula acá en vez de leer `is_pass` de la plataforma, por
 * la misma razón que el resto del archivo: en esta corrida la plataforma le
 * puso `is_pass: false` a `check_actions` con la acción correctamente invocada.
 */
export function compareCustom(operator, actual, expected) {
  const a = actual == null ? '' : String(actual);
  const e = expected == null ? '' : String(expected);
  switch (String(operator ?? 'equals').toLowerCase()) {
    case 'equals': return { ok: a === e, comparable: true };
    case 'not_equals': return { ok: a !== e, comparable: true };
    case 'contains': return { ok: a.includes(e), comparable: true };
    case 'not_contains': return { ok: !a.includes(e), comparable: true };
    default: return { ok: null, comparable: false };
  }
}

/** Lee un parámetro declarado de una customEvaluation del formato del repo. */
export function paramOf(ce, name) {
  return (ce.parameters ?? []).find((p) => p.name === name)?.value;
}

// --------------------------------------------------------------------------
// Censo de aserciones — la defensa contra D3
// --------------------------------------------------------------------------

/**
 * Los identificadores de las evaluaciones que ESTE caso le pide al motor.
 * Espeja lo que emite el traductor: `expectedActions: []` no cuenta, porque el
 * traductor no emite el evaluador (D4).
 */
export function declaredEvaluations(kase, engine) {
  const out = [];
  const tr = engine === 'test-run';
  if (kase.expect?.topic !== undefined) out.push(tr ? 'topic_assertion' : 'check_topic');
  if (kase.expect?.actions?.length > 0) out.push(tr ? 'actions_assertion' : 'check_actions');
  (kase.customEvaluations ?? []).forEach((ce, i) => out.push(tr ? ce.name : `custom_${i}`));
  return out;
}

/**
 * 🚨 CONTRATO ACOTADO A PROPÓSITO: **declaré N, volvieron M, faltan éstas**.
 *
 * NO diagnostica la causa, y no puede: de los cuatro mecanismos de D3, dos
 * —ruta rechazada y error de tipo— tienen la MISMA firma (la evaluación
 * desaparece), y el cuarto —`test run` colapsa las repetidas— no deja rastro
 * alguno. Una explicación que acierta a veces manda a debuggear el lugar
 * equivocado, que es peor que no explicar nada.
 *
 * El diagnóstico lo hace quien lee, con la tabla de los cuatro estados de
 * `knowledge/02-known-issues.md` (D3) al lado.
 *
 * Lo único que sí incluye es el detector determinista: si `actual_value` es el
 * template sin resolver, la referencia no resolvió.
 */
export function census(cases, suiteCases, engine = 'run-eval') {
  const filas = [];
  let cursor = 0;

  for (const kase of suiteCases) {
    if (!sentToEngine(kase, engine)) continue;
    const r = cases[cursor++];
    const declared = declaredEvaluations(kase, engine);
    if (!r) {
      filas.push({ id: kase.id, declared: declared.length, returned: 0, missing: declared, unresolved: [] });
      continue;
    }

    // Multiconjunto: 5 `string_comparison` declaradas y 1 devuelta son 4 faltantes.
    const pool = (r.evaluations ?? []).map((e) => e.key);
    const missing = [];
    for (const d of declared) {
      const at = pool.indexOf(d);
      if (at === -1) missing.push(d);
      else pool.splice(at, 1);
    }

    const unresolved = (r.evaluations ?? [])
      .filter((e) => typeof e.actual === 'string' && /^\{.*\}$/.test(e.actual.trim()))
      .map((e) => e.key);

    filas.push({
      id: kase.id,
      declared: declared.length,
      returned: declared.length - missing.length,
      missing,
      unresolved,
    });
  }

  const totalDeclared = filas.reduce((a, f) => a + f.declared, 0);
  const totalMissing = filas.reduce((a, f) => a + f.missing.length, 0);
  const totalUnresolved = filas.reduce((a, f) => a + f.unresolved.length, 0);
  return { filas, totalDeclared, totalReturned: totalDeclared - totalMissing, totalMissing, totalUnresolved };
}

// --------------------------------------------------------------------------
// Comparación
// --------------------------------------------------------------------------

/**
 * `exact` por defecto. `contains` y `regex` son opt-in por caso.
 *
 * IMPORTANTE: "exacto siempre" está mal. El literal de escalación difiere entre
 * motores (human / human__ / __human__), así que esos casos necesitan `contains`.
 */
export function matchTopic(actual, expected, mode = 'exact') {
  const a = String(actual ?? '');
  const e = String(expected ?? '');
  switch (mode) {
    case 'contains': return a.includes(e);
    case 'regex':    return new RegExp(e).test(a);
    case 'exact':
    default:         return a === e;
  }
}

// --------------------------------------------------------------------------
// Evaluación
// --------------------------------------------------------------------------

export function evaluate(results, cases, { gateOnly = false, engine = 'run-eval' } = {}) {
  const rows = [];

  // 🚨 NO aparear por índice de la suite.
  // `gen-spec` puede EXCLUIR casos de un motor (multi-turno sin turnos
  // capturados, `engines:` explícito). Si la suite tiene 10 casos y el motor
  // devolvió 9, aparear por índice compara cada caso posterior contra el
  // resultado del vecino: veredictos falsos, silenciosos, y uno MISSING al
  // final. El cursor avanza SÓLO sobre los casos que se enviaron, usando la
  // misma función que los excluyó.
  let cursor = 0;

  for (const kase of cases) {
    const enviado = sentToEngine(kase, engine);
    const r = enviado ? results[cursor++] : null;

    if (gateOnly && (kase.gate !== true || kase.flaky === true)) continue;

    if (!enviado) {
      rows.push({
        id: kase.id,
        verdict: 'SKIPPED',
        checks: [{ name: 'motor', verdict: 'SKIP', detail: `el caso no se envía a \`${engine}\`` }],
        severity: kase.severity ?? 'routing',
        probe: kase.probe,
        declared: 0,
      });
      continue;
    }

    if (!r) {
      rows.push({ id: kase.id, verdict: 'MISSING', checks: [], severity: kase.severity ?? 'routing', declared: 0 });
      continue;
    }

    const checks = [];

    if (r.error || r.status === 'ERROR') {
      checks.push({ name: 'ejecución', verdict: 'ERROR', detail: r.error ?? r.status });
    } else {
      const mode = kase.expect?.match ?? 'exact';
      checks.push({
        name: `topic(${mode})`,
        verdict: matchTopic(r.topic, kase.expect?.topic, mode) ? 'PASS' : 'FAIL',
        detail: `esperado="${kase.expect?.topic}" real="${r.topic}"`,
      });

      // expectedActions vacío NO se asserta: la semántica de la plataforma es
      // subconjunto, así que siempre pasaría. No inflar la cobertura (D5).
      const expectedActions = kase.expect?.actions ?? [];
      if (expectedActions.length > 0) {
        const missing = expectedActions.filter((e) => !r.invokedActions.includes(e));
        checks.push({
          name: 'actions',
          verdict: missing.length === 0 ? 'PASS' : 'FAIL',
          detail: `esperadas=[${expectedActions}] reales=[${r.invokedActions}]` + (missing.length ? ` faltan=[${missing}]` : ''),
        });
      }

      // Las @utils.* no están en invokedActions pero sí en executionHistory.
      // La plataforma no puede assertarlas; nosotros sí. Sólo en run-eval.
      const expectedUtils = kase.expect?.utilActions ?? [];
      if (expectedUtils.length > 0) {
        if (r.utilActions == null) {
          checks.push({ name: 'utilActions', verdict: 'SKIP', detail: 'el motor no expone executionHistory' });
        } else {
          const missing = expectedUtils.filter((e) => !r.utilActions.includes(e));
          checks.push({
            name: 'utilActions',
            verdict: missing.length === 0 ? 'PASS' : 'FAIL',
            detail: `esperadas=[${expectedUtils}] reales=[${r.utilActions}]` + (missing.length ? ` faltan=[${missing}]` : ''),
          });
        }
      }

      // Estado de sesión al final del turno. Idem: sólo run-eval lo expone.
      const expectedState = kase.expect?.stateVariables;
      if (expectedState) {
        if (!r.stateVariables) {
          checks.push({ name: 'stateVariables', verdict: 'SKIP', detail: 'el motor no expone stateVariables' });
        } else {
          for (const [k, v] of Object.entries(expectedState)) {
            const actual = r.stateVariables[k];
            checks.push({
              name: `state.${k}`,
              verdict: String(actual) === String(v) ? 'PASS' : 'FAIL',
              detail: `esperado="${v}" real="${actual}"`,
            });
          }
        }
      }

      // customEvaluations: se recalcula el veredicto contra lo DECLARADO en la
      // suite. Sin esto la aserción se ejecuta, entra al censo, y su resultado
      // no lo mira nadie. Ver compareCustom().
      (kase.customEvaluations ?? []).forEach((ce, i) => {
        const nombre = ce.label ? `custom[${ce.label}]` : `custom_${i}`;
        if (engine === 'test-run') {
          checks.push({ name: nombre, verdict: 'SKIP', detail: 'test run colapsa las repetidas de un mismo caso: no se puede aparear (D3)' });
          return;
        }
        const dev = (r.evaluations ?? []).find((e) => e.key === `custom_${i}`);
        if (!dev) {
          // El censo ya lo reporta como faltante; acá se marca para que el
          // veredicto del caso no quede verde por omisión.
          checks.push({ name: nombre, verdict: 'FAIL', detail: 'la evaluación no volvió del motor — ver censo' });
          return;
        }
        const actual = dev.actual;
        if (typeof actual === 'string' && /^\{.*\}$/.test(actual.trim())) {
          checks.push({ name: nombre, verdict: 'FAIL', detail: `la referencia NO resolvió: el motor comparó contra el template literal ${actual} (D4)` });
          return;
        }
        const operator = paramOf(ce, 'operator');
        const expected = paramOf(ce, 'expected');
        const { ok, comparable } = compareCustom(operator, actual, expected);
        if (!comparable) {
          checks.push({ name: nombre, verdict: 'SKIP', detail: `operador "${operator}" no recalculable acá; la plataforma dijo is_pass=${dev.isPass}` });
          return;
        }
        checks.push({
          name: nombre,
          verdict: ok ? 'PASS' : 'FAIL',
          detail: `${operator}: esperado=${JSON.stringify(expected)} real=${JSON.stringify(actual)}`,
        });
      });
    }

    let verdict = checks.some((c) => c.verdict === 'ERROR') ? 'ERROR'
                : checks.some((c) => c.verdict === 'FAIL')  ? 'FAILED'
                : 'PASSED';

    // xfail: se espera que falle por un defecto conocido de la PLATAFORMA, no
    // del agente. No mueve el exit code. Pero si pasa, es alerta ruidosa: quiere
    // decir que la plataforma cambió y el knowledge/ quedó viejo.
    if (kase.xfail) {
      verdict = verdict === 'PASSED' ? 'XPASS' : 'XFAIL';
    }

    rows.push({ id: kase.id, verdict, checks, severity: kase.severity ?? 'routing', flaky: kase.flaky === true, probe: kase.probe, xfail: kase.xfail, note: kase.note, response: r.response });
  }

  return rows;
}

// --------------------------------------------------------------------------
// Reporte
// --------------------------------------------------------------------------

export function reportCensus(c) {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`censo de aserciones: declaradas ${c.totalDeclared} · ejecutadas ${c.totalReturned} · faltan ${c.totalMissing}`);

  if (c.totalMissing > 0) {
    console.log('\n🚨 ASERCIONES QUE NO SE EJECUTARON:');
    for (const f of c.filas.filter((x) => x.missing.length)) {
      console.log(`   ${f.id}: faltan ${f.missing.length}/${f.declared} → [${f.missing.join(', ')}]`);
    }
    console.log('\n   El censo detecta la AUSENCIA, no la causa: dos de los cuatro mecanismos');
    console.log('   de D3 tienen la misma firma. Diagnóstico en knowledge/02-known-issues.md.');
  }

  if (c.totalUnresolved > 0) {
    console.log(`\n🚨 ${c.totalUnresolved} referencia(s) que NO RESOLVIERON (actual_value = el template literal):`);
    for (const f of c.filas.filter((x) => x.unresolved.length)) {
      console.log(`   ${f.id}: [${f.unresolved.join(', ')}]`);
    }
    console.log('   Causa típica: ref cruda sin `expectedTopic` en el mismo caso (D4),');
    console.log('   o motor que no resuelve refs crudas — `test run` nunca las resuelve.');
  }

  return c.totalMissing > 0 || c.totalUnresolved > 0 ? 1 : 0;
}

export function report(rows, { version = null, expectVersion = null, engine = 'run-eval', skipVersionCheck = false } = {}) {
  const icon = { PASSED: '✅', FAILED: '❌', ERROR: '💥', MISSING: '❓', XFAIL: '🔕', XPASS: '🔔', SKIPPED: '⏭️' };

  for (const r of rows) {
    const sev = r.severity === 'safety' ? ' [SAFETY]' : '';
    const fl = r.flaky ? ' [flaky]' : '';
    const pr = r.probe ? ` [sonda:${r.probe}]` : '';
    console.log(`\n${icon[r.verdict]} ${r.id}${sev}${fl}${pr} — ${r.verdict}`);
    for (const c of r.checks) console.log(`     [${c.verdict.padEnd(5)}] ${c.name}: ${c.detail}`);
    if (r.xfail?.reason) console.log(`     xfail: ${String(r.xfail.reason).trim().split('\n')[0]}`);
    if (r.verdict !== 'PASSED' && r.note) console.log(`     nota: ${String(r.note).trim().split('\n')[0]}`);
  }

  const n = (v) => rows.filter((r) => r.verdict === v).length;
  const safetyFails = rows.filter((r) => r.verdict === 'FAILED' && r.severity === 'safety');
  const xpass = rows.filter((r) => r.verdict === 'XPASS');

  console.log(`\n${'─'.repeat(64)}`);
  if (version?.botVersionId) console.log(`versión testeada: ${version.versionApiName} (${version.botVersionId})`);
  else if (version?.unavailable) {
    console.log('🚨 VERSIÓN: NO DISPONIBLE. `test run` no expone contra qué versión corrió,');
    console.log('   por ningún camino. Este resultado NO es auditable en ese eje (D1).');
  }

  // 🚨 La regla #1 no puede ser opt-in.
  //
  // Saber la versión que corrió NO es verificarla. `run-eval` resuelve por
  // número más alto ignorando `Status`, así que leer `bot_version_id` de la
  // corrida y no contrastarlo contra la activa deja exactamente el agujero que
  // D1 describe: la suite mide una versión que ningún usuario alcanza y todo
  // sale verde.
  //
  // Hasta 2026-08-12 esto era silencioso: sin `--expect-version` el informe
  // imprimía la versión y salía 0, indistinguible de un resultado verificado.
  // Era el mismo modo de falla que la regla existe para atajar, por otra puerta.
  //
  // Incoherencia adicional que esto cierra: para `test run` el repo YA gritaba
  // "no auditable". Para `run-eval` —el único motor que PUEDE cumplir la regla—
  // callaba.
  const sinGate = engine === 'run-eval' && !expectVersion && !skipVersionCheck;
  if (sinGate) {
    console.log('\n🚨 SIN GATE DE VERSIÓN — este resultado NO es auditable.');
    console.log('   Se corrió sin `--expect-version`, así que la versión de arriba se leyó');
    console.log('   de la corrida pero NO se contrastó contra la activa. `run-eval` resuelve');
    console.log('   por número más alto SIN filtrar por Status: si difieren, la suite midió');
    console.log('   una versión que ningún usuario alcanza y nada falla (D1).');
    console.log('   ➡️  Pasar --expect-version <botVersionId de la activa>.');
    console.log('   ➡️  Si es una corrida exploratoria: --no-version-check (queda registrado).');
  }
  if (skipVersionCheck) {
    console.log('\n⚠️  gate de versión OMITIDO a pedido (--no-version-check).');
    console.log('   Este resultado no es auditable en el eje de versión. No usarlo como evidencia.');
  }
  console.log(`${n('PASSED')} passed · ${n('FAILED')} failed · ${n('ERROR')} error · ${n('MISSING')} missing` +
              (n('SKIPPED') ? ` · ${n('SKIPPED')} skipped (no van a este motor)` : '') +
              (n('XFAIL') + n('XPASS') ? ` · ${n('XFAIL')} xfail · ${n('XPASS')} xpass` : ''));

  // Un xfail que pasa NO es una buena noticia silenciosa: significa que la
  // plataforma cambió bajo nuestros pies y el knowledge/ quedó viejo.
  if (xpass.length) {
    console.log(`\n🔔 ${xpass.length} caso(s) XPASS: ${xpass.map((r) => r.id).join(', ')}`);
    console.log('   Estaban marcados xfail por un defecto conocido de la plataforma y ahora PASAN.');
    console.log('   La plataforma cambió. Revisar knowledge/ y quitar el xfail.');
  }

  // Gate duro de versión (D1). Si run-eval sirvió una versión distinta de la
  // activa, el resultado no dice nada sobre lo que producción sirve: abortar.
  let versionFail = false;
  if (version && !version.consistent) {
    console.log(`\n🚨 la suite corrió contra MÁS DE UNA versión: ${version.seen.join(' , ')}`);
    versionFail = true;
  }
  if (expectVersion && version?.botVersionId && version.botVersionId !== expectVersion) {
    console.log(`\n🚨 VERSIÓN INESPERADA: corrió contra ${version.botVersionId}, se esperaba ${expectVersion}`);
    console.log('   run-eval resuelve por número más alto ignorando Status. El resultado no es');
    console.log('   representativo de lo que producción sirve. Ver knowledge/02-known-issues.md.');
    versionFail = true;
  }
  if (safetyFails.length) {
    console.log(`\n🚨 ${safetyFails.length} fallo(s) de SEVERIDAD SAFETY: ${safetyFails.map((r) => r.id).join(', ')}`);
    console.log('   Un fallo de safety es un incidente, no una regresión.');
  }

  // Lo que la CLI no hace: exit code que refleja el resultado.
  // `sinGate` suma: un resultado no auditable no es un resultado verde.
  return n('FAILED') + n('ERROR') + n('MISSING') > 0 || versionFail || sinGate ? 1 : 0;
}

// --------------------------------------------------------------------------

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const rawPath = argOf('--raw');
  const suitePath = argOf('--suite');
  const engine = argOf('--engine') ?? 'run-eval';
  const expectVersion = argOf('--expect-version');
  const gateOnly = process.argv.includes('--gate-only');
  const skipVersionCheck = process.argv.includes('--no-version-check');

  if (!rawPath || !suitePath) {
    console.error('uso: node lib/assert.mjs --raw <json> --suite <cases.yaml> [--engine run-eval|test-run] [--gate-only]');
    console.error('                         --expect-version <botVersionId> | --no-version-check');
    process.exit(2);
  }

  const suite = YAML.parse(fs.readFileSync(suitePath, 'utf8'));
  const norm = normalize(fs.readFileSync(rawPath, 'utf8'), engine);
  const rows = evaluate(norm.cases, suite.cases, { gateOnly, engine });

  const rc = report(rows, { version: norm.version, expectVersion, engine, skipVersionCheck });
  // El censo corre SIEMPRE y suma al exit code: una aserción que no se ejecutó
  // es tan grave como una que falló, y no se ve en los veredictos (D3).
  const cc = reportCensus(census(norm.cases, suite.cases, engine));
  process.exit(rc || cc);
}
