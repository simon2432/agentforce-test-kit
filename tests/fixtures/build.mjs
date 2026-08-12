/**
 * Reconstruye los fixtures desde las corridas archivadas.
 *
 * No inventa nada: copia la salida cruda real y le saca sólo los campos que
 * `lib/` no lee (`conversationHistory`, `llmEvents`, `agentResponse`), que son
 * los que hacen que un crudo de `run-eval` pese 700 KB.
 *
 *   node tests/fixtures/build.mjs
 *
 * ⚠️ Este script lee de `evidencia/`, que NO es parte del producto y se borra
 * antes de compartir el repo. Los fixtures que genera SÍ se versionan, y por eso
 * `npm test` sigue funcionando sin `evidencia/`. Este script, no.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.resolve(import.meta.dirname);
const p = (...s) => path.join(ROOT, ...s);

// --- run-eval: adelgazado, mismos campos que lee extract.mjs ---------------
const re = JSON.parse(fs.readFileSync(p('evidencia/runs/alemana/2026-08-06-faseC2/run-eval-1.json'), 'utf8'));
for (const t of re.result.tests) {
  for (const o of t.outputs ?? []) {
    const pr = o.response?.planner_response;
    if (!pr) continue;
    delete pr.conversationHistory;
    delete pr.sessionProperties;
    if (pr.lastExecution) {
      delete pr.lastExecution.llmEvents;
      delete pr.lastExecution.agentResponse;
    }
    if (pr.sessionContext) {
      delete pr.sessionContext.agent_description;
      delete pr.sessionContext.channel_capabilities;
      // executionHistory se CONSERVA: es lo que prueba utilActions
      for (const h of pr.sessionContext.executionHistory ?? []) delete h.llmResponse;
    }
  }
}
fs.writeFileSync(path.join(OUT, 'run-eval-c2.json'), JSON.stringify(re, null, 1), 'utf8');

// --- test run: se copian enteros, ya son chicos ---------------------------
const copias = [
  ['evidencia/runs/alemana/2026-08-06-faseC2/test-run/test-result-4KBO30000000ea9OAA.json', 'test-run-c2.json'],
  ['evidencia/runs/alemana/2026-08-06-faseB/test-run-1/test-result-4KBO30000000eThOAI.json', 'test-run-discover.json'],
  ['evidencia/runs/alemana/2026-08-06-faseC2/test-run-metrics/test-result-4KBO30000000eblOAA.json', 'test-run-metrics-c2.json'],
  ['evidencia/agente-alemana/suites/routing.cases.yaml', 'routing.cases.yaml'],
  ['evidencia/agente-alemana/suites/discover.cases.yaml', 'discover.cases.yaml'],
];
for (const [src, dst] of copias) fs.copyFileSync(p(src), path.join(OUT, dst));

// --- agent.json / vocabulary.json: recorte a lo que report.mjs lee ---------
// Van recortados a propósito: `npm test` no puede depender de `evidencia/`,
// que se borra antes de compartir el repo.
const ag = JSON.parse(fs.readFileSync(p('evidencia/agente-alemana/agent.json'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'agent.json'), `${JSON.stringify({
  $comment: 'FIXTURE generado por build.mjs. Recorte de evidencia/agente-alemana/agent.json a los campos que lee lib/report.mjs.',
  slug: ag.slug, apiName: ag.apiName, label: ag.label,
  org: { alias: ag.org.alias, orgId: ag.org.orgId },
  quality: { respondingTopics: ag.quality.respondingTopics },
}, null, 2)}\n`, 'utf8');

const vo = JSON.parse(fs.readFileSync(p('evidencia/agente-alemana/vocabulary.json'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'vocabulary.json'), `${JSON.stringify({
  $comment: 'FIXTURE generado por build.mjs. Sólo las CLAVES de topics, que es lo único que lee clasificar().',
  agent: vo.agent, botVersionId: vo.botVersionId,
  topics: Object.fromEntries(Object.keys(vo.topics).map((k) => [k, {}])),
}, null, 2)}\n`, 'utf8');

for (const f of fs.readdirSync(OUT).filter((x) => /\.(json|yaml)$/.test(x))) {
  console.log(`  ${f.padEnd(26)} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`);
}
