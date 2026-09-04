#!/usr/bin/env node
/**
 * Extractor de evidencia de una corrida cruda.
 *
 * Sólo lee. No asserta nada — eso es `assert.mjs`. Su trabajo es dejar en
 * `runs/<ts>/` un resumen legible y auditable de qué pasó, incluyendo
 * CONTRA QUÉ VERSIÓN corrió.
 *
 * Por qué existe (ver knowledge/02-known-issues.md, D1):
 *   `run-eval` resuelve la versión por número más alto sin mirar `Status`.
 *   Si no se registra el `bot_version_id` de cada corrida, ningún resultado es
 *   auditable después: no hay forma de saber si midió lo que producción sirve.
 *
 * Uso:
 *   node lib/extract.mjs --raw runs/<ts>/run1.json [--engine run-eval|test-run]
 *                        [--out runs/<ts>/summary.json] [--quiet]
 */

import fs from 'node:fs';

// --------------------------------------------------------------------------
// Tolerancia de formato
// --------------------------------------------------------------------------

/**
 * `run-eval` emite DOS formas según el flag, y es beta ("any aspect of this
 * command can change without advanced notice"), así que se aceptan las dos:
 *   --json                → { status, result: { tests[], summary } }   <- la del repo
 *   --result-format json  → { results: [...] }                          <- payload crudo
 * Además recorta cualquier preámbulo de texto que la CLI escriba en stdout
 * antes del JSON.
 */
export function parseRaw(text) {
  const i = text.indexOf('{');
  if (i < 0) throw new Error('no hay JSON en la entrada');
  const doc = JSON.parse(text.slice(i));
  const tests = doc?.result?.tests ?? doc?.results ?? [];
  return { doc, tests, summary: doc?.result?.summary ?? null };
}

const evalsOf = (t) => t.evaluations ?? t.evaluation_results ?? [];
const outputOf = (t, type) => (t.outputs ?? []).find((o) => o?.type === type);

/**
 * El `agent.send_message` del turno MEDIDO.
 *
 * 🚨 BUG MEDIDO EL 2026-08-13. En un caso multi-turno, `run-eval` emite un
 * `agent.send_message` POR TURNO: los previos con `id: history_0`, `history_1`…
 * y el medido con `id: sm`. `outputOf()` usa `.find()`, así que devolvía **la
 * respuesta del primer turno** mientras `topic` y `stateVariables` venían del
 * último — el `agent.get_state` es uno solo y sí corresponde al turno medido.
 *
 * Síntoma observado en el caso E02 de la suite de estado: el estado decía
 * `encuestaNota: "5"` y `encuestaEtapa: esperando_comentario` (o sea, el "5" se
 * había procesado), pero la respuesta mostrada era «¿podés calificar tu
 * experiencia de 1 a 5?», que es la del turno anterior.
 *
 * No movía ningún veredicto —`assert.mjs` sólo usa `response` para mostrar— pero
 * falseaba la traza y el `durationMs`, que es justo donde uno va a mirar cuando
 * quiere entender una conversación.
 */
export function measuredMessage(t) {
  const msgs = (t.outputs ?? []).filter((o) => o?.type === 'agent.send_message');
  return msgs.find((o) => o?.id === 'sm') ?? msgs[msgs.length - 1];
}

/** Los turnos previos, en orden, tal como los respondió el agente. */
export function historyMessages(t) {
  return (t.outputs ?? [])
    .filter((o) => o?.type === 'agent.send_message' && o?.id !== 'sm')
    .map((o) => o.response ?? null);
}

/** Recorre cualquier estructura anidada y junta todos los function.name. */
export function extractActionNames(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => extractActionNames(n, out));
  } else if (node && typeof node === 'object') {
    if (node.function && typeof node.function.name === 'string') out.push(node.function.name);
    Object.values(node).forEach((v) => extractActionNames(v, out));
  }
  return [...new Set(out)];
}

// --------------------------------------------------------------------------
// Extracción
// --------------------------------------------------------------------------

export function extract(text) {
  const { tests, summary } = parseRaw(text);

  const rows = tests.map((t, i) => {
    const gs = outputOf(t, 'agent.get_state');
    const sm = measuredMessage(t);
    const cs = outputOf(t, 'agent.create_session');
    const pr = gs?.response?.planner_response ?? {};
    const le = pr.lastExecution ?? {};
    const sc = pr.sessionContext ?? {};

    const invoked = extractActionNames(le.invokedActions);

    // executionHistory registra TODAS las llamadas a herramienta, reales y
    // @utils.*. invokedActions sólo registra las reales. La diferencia entre
    // los dos conjuntos son exactamente las @utils.* (escalate, setVariables,
    // transition): ejecutadas de verdad, invisibles para expectedActions.
    const seen = [];
    for (const h of sc.executionHistory ?? []) {
      for (const inv of h.toolInvocations ?? []) if (inv.function?.name) seen.push(inv.function.name);
      if (h.actionName) seen.push(h.actionName);
    }
    const utils = [...new Set(seen)].filter((n) => !invoked.includes(n));

    const topicEv = evalsOf(t).find((e) => e.type === 'evaluator.planner_topic_assertion');

    return {
      index: i,
      id: t.id ?? `case_${i}`,
      status: t.status ?? null,
      sessionId: cs?.session_id ?? null,
      utterance: sc.tags?.user_utterance ?? le.userUtterance ?? null,
      topic: le.topic ?? null,
      expectedTopic: topicEv?.expected_value ?? null,
      invokedActions: invoked,
      utilActions: utils,
      actionIO: (le.invokedActions ?? []).flat().map((a) => ({
        name: a?.function?.name,
        input: a?.function?.input,
        output: a?.function?.output,
        latencyMs: a?.executionLatency,
      })),
      response: sm?.response ?? null,
      // Las respuestas de los turnos previos, para poder leer la conversación
      // entera en la traza sin abrir el crudo.
      historyResponses: historyMessages(t),
      messageType: le.message?.messageType ?? null,
      errors: le.errors ?? [],
      durationMs: sm?.duration_ms ?? null,
      // Estado de sesión al final del turno. Las variables del .agent conviven
      // acá con las internas (`__*__`, `AgentScriptInternal_*`); se filtran esas
      // para que el resumen archivado sea legible.
      stateVariables: sc.stateVariables
        ? Object.fromEntries(Object.entries(sc.stateVariables).filter(([k]) => !k.startsWith('__') && !k.startsWith('AgentScriptInternal_')))
        : null,
      // Las `linked` llegan NULL bajo test: es la razón estructural por la que
      // testear no dispara DML (knowledge/05-safety.md).
      contextVariables: sc.contextVariables ?? null,
    };
  });

  // La versión sale de la primera corrida que la exponga; se verifica que
  // TODOS los casos hayan corrido contra la misma (un cambio a mitad de suite
  // haría inauditable el resultado).
  const versions = new Set();
  for (const t of tests) {
    const tags = outputOf(t, 'agent.get_state')?.response?.planner_response?.sessionContext?.tags;
    if (tags?.bot_version_id) versions.add(`${tags.bot_version_id}|${tags.version_api_name}|${tags.planner_name}`);
  }
  const [botVersionId, versionApiName, plannerName] = [...versions][0]?.split('|') ?? [];

  return {
    version: { botVersionId, versionApiName, plannerName, consistent: versions.size <= 1, seen: [...versions] },
    // Se completa en el CLI con toolingVersions(). Un resultado sin las DOS
    // versiones —la del agente y la de la herramienta— no es auditable: la CLI
    // se auto-actualiza sola y cambia el comportamiento del cliente sin aviso.
    // Ver knowledge/02-known-issues.md, D22.
    tooling: null,
    summary,
    cases: rows,
  };
}

// --------------------------------------------------------------------------
// Reporte
// --------------------------------------------------------------------------

export function report(ev) {
  const v = ev.version;
  console.log(`versión: ${v.versionApiName ?? '?'} (${v.botVersionId ?? '?'}) · planner ${v.plannerName ?? '?'}`);
  if (ev.tooling?.available) {
    console.log(`herramienta: sf ${ev.tooling.cli} · plugin-agent ${ev.tooling.pluginAgent}`);
    if (ev.tooling.warning) console.log(`⚠️  ${ev.tooling.warning}`);
  } else if (ev.tooling) {
    console.log('⚠️  herramienta: NO DETECTADA — el resultado no queda auditable en ese eje');
  }
  if (!v.consistent) {
    console.log(`🚨 LA SUITE CORRIÓ CONTRA MÁS DE UNA VERSIÓN: ${v.seen.join(' , ')}`);
    console.log('   El resultado no es auditable. Ver knowledge/02-known-issues.md (D1).');
  }
  if (ev.summary) console.log(`summary: ${JSON.stringify(ev.summary)}`);
  console.log('─'.repeat(72));
  for (const c of ev.cases) {
    console.log(`${String(c.index + 1).padStart(2)}. ${c.topic ?? '(sin topic)'}`);
    console.log(`    utterance : ${c.utterance ?? '—'}`);
    if (c.invokedActions.length) console.log(`    acciones  : [${c.invokedActions}]`);
    if (c.utilActions.length) console.log(`    @utils.*  : [${c.utilActions}]  (no assertables: no están en invokedActions)`);
    if (c.messageType) console.log(`    msgType   : ${c.messageType}`);
    if (c.errors?.length) console.log(`    errores   : ${JSON.stringify(c.errors)}`);
  }
}

// --------------------------------------------------------------------------

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (import.meta.url.startsWith('file:') && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const rawPath = argOf('--raw');
  if (!rawPath) {
    console.error('uso: node lib/extract.mjs --raw <json> [--out <json>] [--quiet]');
    process.exit(2);
  }
  const ev = extract(fs.readFileSync(rawPath, 'utf8'));
  // La versión de la herramienta se captura acá, no en extract(), para que la
  // función siga siendo pura y testeable sin shell.
  if (!process.argv.includes('--no-tooling')) {
    const { toolingVersions } = await import('./tooling.mjs');
    ev.tooling = toolingVersions();
  }
  const out = argOf('--out') ?? rawPath.replace(/\.json$/, '.summary.json');
  fs.writeFileSync(out, JSON.stringify(ev, null, 2), 'utf8');
  if (!process.argv.includes('--quiet')) report(ev);
  console.log(`\n→ ${out}`);
  // Sin versión no hay auditoría posible: es un error de extracción, no de aserción.
  process.exit(ev.version.botVersionId && ev.version.consistent ? 0 : 1);
}
