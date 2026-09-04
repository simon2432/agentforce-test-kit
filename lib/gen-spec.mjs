#!/usr/bin/env node
/**
 * Genera los specs nativos de cada motor desde el formato del repo.
 *
 * Por qué el repo tiene formato propio (knowledge/04-spec-formats.md):
 *   - los formatos multi-turno de los motores son incompatibles (D10)
 *   - `run-eval` es beta y puede cambiar
 *   - el formato nativo no tiene dónde poner severidad, flakiness ni modo de
 *     comparación
 *
 * Uso:
 *   node lib/gen-spec.mjs --suite agents/<slug>/suites/<n>.cases.yaml \
 *                         --agent Bici_Store --engine run-eval --out <archivo>
 */

import fs from 'node:fs';
import YAML from 'yaml';

// --------------------------------------------------------------------------
// Guarda de seguridad — knowledge/05-safety.md
// --------------------------------------------------------------------------

const SF_ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

/**
 * Un Id real en `context` es el ÚNICO vector que reactiva DML sobre registros de
 * negocio: el lookup encuentra la MessagingSession y el DML deja de afectar 0
 * filas. Sin Id, las variables `linked` llegan null (observado en la Fase 1).
 *
 * 🚨 ESTA GUARDA NO TIENE ESCAPE, A PROPÓSITO.
 *
 * Hasta 2026-08-12 aceptaba un `allowOverride` que ningún flag del CLI exponía:
 * un parámetro muerto que sólo servía para que alguien lo encontrara y lo usara.
 * Una puerta trasera sin uso, en la única guarda que separa una suite de prueba
 * de un UPDATE sobre registros de negocio reales, no se justifica por comodidad.
 *
 * Si algún día hiciera falta sembrar un Id real, el camino no es un flag: es
 * escribir por qué en `knowledge/05-safety.md` y que la decisión quede firmada.
 *
 * Devuelve la lista de infractores en vez de matar el proceso, para que se pueda
 * testear. Quien la llama decide qué hacer — `loadSuite` aborta.
 */
export function findRealIds(cases) {
  const offenders = [];
  for (const kase of cases ?? []) {
    for (const [k, v] of Object.entries(kase.context ?? {})) {
      if (typeof v === 'string' && SF_ID.test(v)) offenders.push(`${kase.id}.context.${k} = "${v}"`);
    }
  }
  return offenders;
}

/** Aborta el proceso si hay un Id real. Sin escape. */
export function assertNoRealIds(cases) {
  const offenders = findRealIds(cases);
  if (!offenders.length) return;
  console.error('\n🚨 ABORTADO: context variables con forma de Id de Salesforce.\n');
  offenders.forEach((o) => console.error(`   ${o}`));
  console.error('\nEs el único vector que puede hacer que una prueba modifique datos reales.');
  console.error('No hay flag para saltear esto. Ver knowledge/05-safety.md.');
  process.exit(2);
}

export function loadSuite(path) {
  const suite = YAML.parse(fs.readFileSync(path, 'utf8'));
  assertNoRealIds(suite.cases ?? []);
  return suite;
}

// --------------------------------------------------------------------------
// Generación
// --------------------------------------------------------------------------

/**
 * ¿Este caso se le manda a este motor?
 *
 * 🚨 FUENTE ÚNICA DE VERDAD. `assert.mjs` importa esta función para alinear los
 * resultados con los casos. Si el generador excluye un caso y el asertor no lo
 * sabe, **todos los casos posteriores se comparan contra el resultado del
 * vecino** — un veredicto falso y silencioso. Duplicar esta regla la hace
 * divergir; por eso vive acá y se importa.
 */
export function sentToEngine(kase, engine) {
  if (kase.engines && !kase.engines.includes(engine)) return false;
  // `test run` EXIGE alternancia user/agent terminando en agent (D10), y el repo
  // no fabrica turnos de agente: sin `captured_agent_turns` el caso no se envía.
  if (engine === 'test-run' && kase.turns?.length && !kase.captured_agent_turns?.length) return false;
  return true;
}

const applies = sentToEngine;

/**
 * 🚩 EL CENTINELA DE DESCUBRIMIENTO.
 *
 * Un descubrimiento "sin asserts" NO devuelve vocabulario. `needsPlannerState()`
 * del traductor sólo emite el paso `agent.get_state` si el caso trae
 * `expectedTopic`, `expectedActions` no vacío, o un `customEvaluations` cuyo
 * `actual` esté en PLANNER_PATHS. Sin ninguno de los tres no se pide el estado
 * del planner, y sin él no hay `lastExecution.topic` que leer.
 *
 * ➡️ Se pone un `expectedTopic` que sabemos que va a fallar, para que la
 *    aserción SE EJECUTE y el veredicto revele el `actual_value` real.
 *    No es un rodeo: es la única forma de que el descubrimiento devuelva algo.
 *
 * El valor lleva caracteres que ningún topic real puede tener, para que tampoco
 * pase por accidente con el operador `contains` de `run-eval`.
 */
export const DISCOVERY_SENTINEL = '__DISCOVERY__';

/**
 * run-eval: `conversationHistory` sólo con `role: user` — descarta los `agent`
 * y EJECUTA los turnos. `metrics` se ignora en silencio, así que no se emite.
 */
export function toRunEval(suite, agentApiName, { discover = false } = {}) {
  return {
    name: suite.suite,
    subjectType: 'AGENT',
    subjectName: agentApiName,
    testCases: (suite.cases ?? []).filter((k) => applies(k, 'run-eval')).map((k) => {
      const tc = { utterance: k.utterance };
      if (k.context) tc.contextVariables = Object.entries(k.context).map(([name, value]) => ({ name, value: String(value) }));
      if (k.turns?.length) tc.conversationHistory = k.turns.map((m) => ({ role: 'user', message: m }));
      tc.expectedTopic = discover ? DISCOVERY_SENTINEL : k.expect?.topic;
      // `actions: []` se emite igual: forma parte de la sonda de D5 (no asserta
      // nada, pero queremos ver que la plataforma lo da PASS).
      if (!discover && k.expect?.actions) tc.expectedActions = k.expect.actions;
      if (!discover && k.customEvaluations) tc.customEvaluations = k.customEvaluations;
      return tc;
    }),
  };
}

/**
 * test run: `metrics` sí funciona. `conversationHistory` EXIGE alternancia
 * user/agent terminando en agent (D10), y el repo NO fabrica turnos de agente:
 * sin `captured_agent_turns` el caso se excluye de este motor.
 */
export function toTestRun(suite, agentApiName, { metrics = null, discover = false } = {}) {
  const skipped = [];
  const testCases = [];
  for (const k of suite.cases ?? []) {
    if (!applies(k, 'test-run')) {
      if (k.turns?.length && !k.captured_agent_turns?.length) {
        skipped.push(`${k.id} (multi-turno sin captured_agent_turns — ver knowledge/04-spec-formats.md)`);
      } else {
        skipped.push(`${k.id} (excluido por engines: [${k.engines}])`);
      }
      continue;
    }
    const tc = { utterance: k.utterance };
    if (k.context) tc.contextVariables = Object.entries(k.context).map(([name, value]) => ({ name, value: String(value) }));
    if (k.turns?.length) {
      tc.conversationHistory = [];
      k.turns.forEach((m, i) => {
        tc.conversationHistory.push({ role: 'user', message: m });
        tc.conversationHistory.push({ role: 'agent', message: k.captured_agent_turns[i].message });
      });
    }
    tc.expectedTopic = discover ? DISCOVERY_SENTINEL : k.expect?.topic;
    if (!discover && k.expect?.actions) tc.expectedActions = k.expect.actions;
    if (!discover && k.customEvaluations) tc.customEvaluations = k.customEvaluations;
    if (metrics) tc.metrics = metrics;
    testCases.push(tc);
  }
  if (skipped.length) console.error('⚠️  casos excluidos de test-run:\n   ' + skipped.join('\n   '));
  return { name: suite.suite, description: suite.description, subjectType: 'AGENT', subjectName: agentApiName, testCases };
}

// --------------------------------------------------------------------------

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const suitePath = argOf('--suite');
  const agent = argOf('--agent');
  const engine = argOf('--engine') ?? 'run-eval';
  const out = argOf('--out');
  const metrics = argOf('--metrics')?.split(',');

  const discover = process.argv.includes('--discover');

  if (!suitePath || !agent || !out) {
    console.error('uso: node lib/gen-spec.mjs --suite <cases.yaml> --agent <ApiName> --engine run-eval|test-run --out <archivo> [--metrics coherence,completeness] [--discover]');
    console.error('     --discover  fuerza el centinela __DISCOVERY__ en todos los casos y descarta');
    console.error('                 acciones y customEvaluations. Es el modo del paso obligatorio de');
    console.error('                 descubrimiento: sin un expectedTopic no se pide el estado del');
    console.error('                 planner y la corrida no devuelve NINGÚN topic.');
    process.exit(2);
  }

  const suite = loadSuite(suitePath);
  const spec = engine === 'test-run' ? toTestRun(suite, agent, { metrics, discover }) : toRunEval(suite, agent, { discover });
  if (discover) console.error(`🔍 modo descubrimiento: expectedTopic = ${DISCOVERY_SENTINEL} en los ${spec.testCases.length} casos.`);
  // lineWidth: 0 desactiva el plegado. Las refs crudas de customEvaluations son
  // largas y el plegado por defecto las parte con `\` de continuación: sigue
  // siendo YAML válido, pero un path partido es lo último que uno quiere tener
  // que leer al diagnosticar un assert que no resolvió (D15).
  fs.writeFileSync(out, YAML.stringify(spec, { lineWidth: 0 }), 'utf8');
  console.log(`${engine}: ${spec.testCases.length} casos → ${out}`);
}
