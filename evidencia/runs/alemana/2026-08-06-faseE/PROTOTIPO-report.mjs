/**
 * PROTOTIPO de lib/report.mjs — el reporte auditable que falta.
 * Cumple los 5 requisitos que salieron de C.3.
 * Se corre sobre datos reales de C.2 y escribe Markdown.
 */
import fs from 'node:fs';
import YAML from 'yaml';

const ROOT = 'c:/Users/simon/Desktop/agentforce-test-kit/';
const C2 = ROOT + 'agents/alemana/runs/2026-08-06-faseC2/';

const suite = YAML.parse(fs.readFileSync(ROOT + 'agents/alemana/suites/routing.cases.yaml', 'utf8'));
const agent = JSON.parse(fs.readFileSync(ROOT + 'agents/alemana/agent.json', 'utf8'));
const runEval = JSON.parse(fs.readFileSync(C2 + 'run-eval-1.json', 'utf8'));
const metricsDoc = JSON.parse(
  fs.readFileSync(C2 + 'test-run-metrics/' + fs.readdirSync(C2 + 'test-run-metrics')[0], 'utf8')
);

// --- (5) la versión: la plataforma no la trae en test run; sale de run-eval ---
const version = runEval.result.tests
  .map((t) => (t.outputs ?? []).find((o) => o.type === 'agent.get_state')?.response?.planner_response?.sessionContext?.tags)
  .find((x) => x?.bot_version_id);

// --- (1) segmentación por topic -----------------------------------------------
const RESPONDEN = new Set(agent.quality.respondingTopics); // ["GeneralFAQ"]

const rows = suite.cases.map((k, i) => {
  const t = runEval.result.tests[i];
  const gs = (t.outputs ?? []).find((o) => o.type === 'agent.get_state');
  const topic = gs?.response?.planner_response?.lastExecution?.topic ?? null;
  const mode = k.expect?.match ?? 'exact';
  const ok = mode === 'contains' ? String(topic).includes(k.expect.topic) : String(topic) === String(k.expect?.topic);

  const mets = {};
  for (const r of metricsDoc.testCases[i]?.testResults ?? [])
    if (!/assertion|output_validation/.test(r.metricLabel))
      mets[r.metricLabel] = { score: r.score, explain: r.metricExplainability ?? '' };

  return {
    id: k.id, utterance: k.utterance, esperado: k.expect?.topic, real: topic, ok,
    severity: k.severity ?? 'routing', gate: k.gate !== false, nota: k.note?.trim().split('\n')[0],
    responde: RESPONDEN.has(topic), mets,
    respuesta: metricsDoc.testCases[i]?.generatedData?.generatedResponse ?? '',
  };
});

const responden = rows.filter((r) => r.responde);
const rechazan = rows.filter((r) => !r.responde);
const safety = rows.filter((r) => r.severity === 'safety');
const fallos = rows.filter((r) => !r.ok);
const prom = (arr, k) => {
  const v = arr.map((r) => r.mets[k]?.score).filter((x) => typeof x === 'number');
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—';
};

const L = [];
L.push(`# Informe de prueba — ${agent.label}`);
L.push('');
L.push('| | |');
L.push('|---|---|');
L.push(`| Agente | \`${agent.apiName}\` |`);
L.push(`| **Versión medida** | **${version.version_api_name} (\`${version.bot_version_id}\`)** |`);
L.push(`| Organización | ${agent.org.alias} (\`${agent.org.orgId}\`) |`);
L.push(`| Herramienta | sf 2.146.3 · plugin-agent 1.45.0 |`);
L.push(`| Casos | ${rows.length} |`);
L.push('');
L.push('> La versión del agente **no la provee la plataforma**: no aparece en la salida de');
L.push('> `test run` ni en el export de Testing Center. La agrega este informe leyéndola de');
L.push('> `run-eval`. Un resultado sin esta fila no es auditable.');
L.push('');
L.push('## Resumen');
L.push('');
L.push(`- **${rows.length - fallos.length} de ${rows.length} casos correctos**`);
L.push(`- 🛡 **Seguridad: ${safety.filter((r) => r.ok).length} de ${safety.length} correctos**`);
if (fallos.length) L.push(`- ❌ ${fallos.length} fallo(s): ${fallos.map((r) => r.id).join(', ')}`);
L.push('');

// --- (3) seguridad, con su propio veredicto -----------------------------------
L.push('## 🛡 Seguridad — veredicto propio');
L.push('');
L.push('Un fallo acá es un **incidente**, no una regresión.');
L.push('');
L.push('| Caso | Consulta | Debía ir a | Fue a | |');
L.push('|---|---|---|---|---|');
for (const r of safety)
  L.push(`| ${r.id} | ${r.utterance} | \`${r.esperado}\` | \`${r.real}\` | ${r.ok ? '✅ **correcto**' : '🚨 **INCIDENTE**'} |`);
L.push('');

// --- (1)(2) los dos segmentos -------------------------------------------------
L.push(`## Caminos de respuesta — ${responden.length} casos`);
L.push('');
L.push('Acá el agente **debe** responder, así que las métricas de calidad aplican con su');
L.push('lectura normal: más alto es mejor.');
L.push('');
L.push(`**coherence ${prom(responden, 'coherence')}/5 · completeness ${prom(responden, 'completeness')}/5**`);
L.push('');
L.push('| Caso | Consulta | Ruteo | coherence | completeness | Observación |');
L.push('|---|---|---|---|---|---|');
for (const r of responden) {
  const c = r.mets.completeness;
  const obs = c && c.score <= 2 ? `⚠️ **hueco de contenido real** — ${c.explain.slice(0, 110)}…` : '';
  L.push(`| ${r.id} | ${r.utterance.slice(0, 46)}… | ${r.ok ? '✅' : '❌'} | ${r.mets.coherence?.score ?? '—'} | ${c?.score ?? '—'} | ${obs} |`);
}
L.push('');
L.push(`## Caminos de rechazo y derivación — ${rechazan.length} casos`);
L.push('');
L.push('> 🚨 **LEER AL REVÉS.** Acá el agente **no debe** responder la consulta: debe');
L.push('> rechazarla o derivarla. Un `completeness` de **0 significa que el agente NO');
L.push('> respondió la pregunta — que es exactamente el comportamiento correcto.**');
L.push('> El evaluador de calidad mide "¿respondió?", así que **castiga el acierto**.');
L.push('> Estas métricas no deben promediarse con las de arriba ni usarse como objetivo.');
L.push('');
L.push(`Promedio del segmento, **sólo informativo**: coherence ${prom(rechazan, 'coherence')}/5 · completeness ${prom(rechazan, 'completeness')}/5`);
L.push('');
L.push('| Caso | Consulta | Ruteo | completeness | Qué dijo el evaluador | Lectura correcta |');
L.push('|---|---|---|---|---|---|');
for (const r of rechazan) {
  const c = r.mets.completeness;
  const lectura = c && c.score <= 2 ? '✅ **el agente rechazó bien**' : '—';
  L.push(`| ${r.id} | ${r.utterance.slice(0, 40)}… | ${r.ok ? '✅' : '❌'} | ${c?.score ?? '—'} | *"${(c?.explain ?? '').slice(0, 80)}…"* | ${lectura} |`);
}
L.push('');

// --- (4) explicar los fallos, porque la plataforma devuelve "" ----------------
L.push('## Fallos — explicados');
L.push('');
L.push('La plataforma devuelve `metricExplainability: ""` en **todas** las aserciones.');
L.push('Estas explicaciones las escribe el kit a partir del caso y del crudo.');
L.push('');
for (const r of fallos) {
  L.push(`### ${r.id} — esperaba \`${r.esperado}\`, fue a \`${r.real}\``);
  L.push('');
  L.push(`- **Consulta:** ${r.utterance}`);
  L.push(`- **Gatea el CI:** ${r.gate ? 'sí' : '**no** — caso deliberado'}`);
  if (r.nota) L.push(`- **Nota del autor del caso:** ${r.nota}`);
  L.push(`- **Respuesta del agente:** ${String(r.respuesta).slice(0, 150).replace(/\n/g, ' ')}…`);
  L.push('');
}

fs.writeFileSync(ROOT + 'agents/alemana/runs/2026-08-06-faseE/informe-ejemplo.md', L.join('\n'), 'utf8');
console.log(L.join('\n'));
