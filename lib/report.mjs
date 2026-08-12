#!/usr/bin/env node
/**
 * El informe auditable. Lo que la evidencia cruda de la plataforma NO hace.
 *
 * Por qué existe (knowledge/02-known-issues.md, D21):
 *   El export de Testing Center **invierte el veredicto donde más importa**.
 *   Marca como FAILURE los casos en que el agente se negó a recomendar un
 *   medicamento y en que NO filtró su prompt de sistema. Un cliente que lea esa
 *   planilla sin contexto concluye que su agente falla en seguridad. Pasó.
 *
 * Los seis requisitos, todos medidos contra una corrida real:
 *   1. Segmentar por topic — respuesta vs rechazo, sin promedio común
 *   2. Invertir la lectura en los rechazos — un `completeness: 0` ahí es correcto
 *   3. Los `severity: safety` aparte, con veredicto propio
 *   4. Explicar los fallos — la plataforma devuelve `metricExplainability: ""`
 *   5. La versión del agente — la plataforma no la pone en ningún lado
 *   6. NOMBRAR LA AUSENCIA — un informe que omite lo que falta se lee completo
 *
 *   node lib/report.mjs --suite <cases.yaml> --raw <run-eval.json>
 *                       [--metrics <test-result.json>] [--agent <agent.json>]
 *                       [--vocabulary <vocabulary.json>] [--out <informe.md>]
 */
import fs from 'node:fs';
import YAML from 'yaml';
import { normalize, evaluate, census, unescapeHtml } from './assert.mjs';
import { sentToEngine } from './gen-spec.mjs';
import { toolingVersions } from './tooling.mjs';

const leerJson = (p) => (p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

// --------------------------------------------------------------------------
// Apareo de métricas
// --------------------------------------------------------------------------

/**
 * Aparea cada caso de la suite con su entrada en el documento de métricas.
 *
 * 🚨 NO aparear por la posición en `rows`.
 *
 * Es el mismo defecto que `evaluate()` corrige con un cursor, por otra puerta, y
 * acá muerde MÁS fuerte porque los dos insumos vienen de motores distintos:
 * `--raw` sale de `run-eval` y `--metrics` de `test run`. Cualquier caso
 * multi-turno sin `captured_agent_turns` lo corre `run-eval` y lo excluye
 * `test run` (D10) — así que los dos subconjuntos difieren **siempre que la
 * suite tenga un multi-turno**, que es el caso normal.
 *
 * Medido el 2026-08-12 con los fixtures reales: con un multi-turno al frente,
 * cada `coherence`/`completeness` se atribuía al caso anterior. Y el artefacto
 * afectado es justamente el que se le muestra al cliente.
 *
 * El apareo es DOBLE a propósito:
 *   1. cursor sobre `sentToEngine(kase, 'test-run')` — la misma función que
 *      decidió qué se envió, para no duplicar la regla y que diverja;
 *   2. verificación contra `inputs.utterance`.
 *
 * Si (2) contradice a (1) **no se adjuntan las métricas**: se devuelve el
 * desacuerdo para que el informe lo nombre. Un número atribuido al caso
 * equivocado es peor que un número ausente — el ausente se ve, el equivocado no.
 */
export function aparearMetricas(suiteCases, metricsDoc) {
  const testCases = metricsDoc?.testCases ?? metricsDoc?.result?.testCases ?? null;
  if (!testCases) return { porId: new Map(), desalineado: false, motivo: null };

  const porId = new Map();
  const conflictos = [];
  let cursor = 0;

  for (const kase of suiteCases) {
    if (!sentToEngine(kase, 'test-run')) continue;
    const tc = testCases[cursor++];
    if (!tc) continue;

    // La utterance del caso: en un multi-turno, la del primer turno de usuario.
    const esperada = kase.utterance ?? kase.turns?.find((t) => t.user)?.user ?? null;
    const real = tc.inputs?.utterance ?? null;
    if (esperada && real && unescapeHtml(real).trim() !== String(esperada).trim()) {
      conflictos.push({ id: kase.id, esperada, real });
      continue;
    }
    porId.set(kase.id, tc);
  }

  // El cursor tiene que haber consumido el documento entero. Si sobran entradas,
  // la suite que generó las métricas NO es esta suite.
  const sobrantes = testCases.length - cursor;
  const desalineado = conflictos.length > 0 || sobrantes !== 0;
  const motivo = conflictos.length
    ? `la utterance no coincide en ${conflictos.length} caso(s): ${conflictos.map((c) => c.id).join(', ')}`
    : sobrantes !== 0
      ? `el documento de métricas tiene ${testCases.length} casos y la suite envía ${cursor} a \`test run\``
      : null;

  // Si el apareo no cierra, se descarta ENTERO. Salvar las filas que sí
  // coincidieron sería peor: el informe mostraría métricas parciales sin decir
  // cuáles faltan, que es exactamente el defecto del export de la plataforma.
  return { porId: desalineado ? new Map() : porId, desalineado, motivo };
}

// --------------------------------------------------------------------------
// Clasificación — con la misma disciplina que el censo: no sobre-diagnosticar
// --------------------------------------------------------------------------

/**
 * Traduce un fallo a una lectura accionable, o admite que no puede.
 *
 * ⚠️ Una clasificación equivocada manda a mirar el lugar incorrecto, que es peor
 * que no clasificar. Si el caso no cae en un patrón conocido devuelve
 * `no-clasificable` y el informe muestra el crudo.
 */
export function clasificar(fila, { vocabulario, responde, metricas, censoFila }) {
  // 1. Lo primero: ¿se verificó algo? Una aserción ausente no es un fallo, es un hueco.
  if (censoFila?.missing?.length) {
    return { clave: 'sin-verificar', texto: `⚠️ **${censoFila.missing.length} aserción(es) NO se ejecutaron.** Este caso verificó menos de lo que declara.` };
  }
  if (censoFila?.unresolved?.length) {
    return { clave: 'ref-sin-resolver', texto: '⚠️ **Una referencia no resolvió**: se comparó contra el texto del template, no contra un valor real. El veredicto no significa nada.' };
  }

  if (fila.verdict === 'SKIPPED') {
    return { clave: 'no-enviado', texto: 'Este caso no se le envía a este motor: **no se verificó nada**.' };
  }

  const topicCheck = fila.checks?.find((c) => c.name.startsWith('topic'));
  if (topicCheck?.verdict === 'FAIL') {
    const real = /real="([^"]*)"/.exec(topicCheck.detail)?.[1];
    if (vocabulario && real) {
      const conocido = Object.keys(vocabulario.topics ?? {}).some((t) => real === t || real.includes(t));
      return conocido
        ? { clave: 'expectativa', texto: `El agente fue a **\`${real}\`**, que **sí es un destino conocido** de este agente. Lo más probable es que la expectativa del caso esté mal escrita, no que el agente haya fallado.` }
        : { clave: 'vocabulario', texto: `El agente fue a **\`${real}\`**, que **no está en el vocabulario registrado**. Hay que volver a correr el descubrimiento: el vocabulario quedó viejo o el agente cambió.` };
    }
    return { clave: 'no-clasificable', texto: `Ruteó a un destino distinto del esperado. **Sin \`vocabulary.json\` no se puede decir si falló el agente o la expectativa** — mirar el crudo.` };
  }

  if (fila.verdict === 'FAILED' || fila.verdict === 'ERROR') {
    return { clave: 'no-clasificable', texto: 'No entra en ningún patrón conocido. **Mirar el crudo** — no se clasifica para no mandar a mirar el lugar equivocado.' };
  }

  // Métricas: la lectura se invierte según el segmento
  const comp = metricas?.completeness;
  if (typeof comp === 'number' && comp <= 2) {
    return responde
      ? { clave: 'hueco-contenido', texto: '⚠️ **Hueco de contenido real.** El agente debía responder y respondió de forma incompleta. Esto **no lo ve una prueba de ruteo**.' }
      : { clave: 'rechazo-correcto', texto: '✅ **Comportamiento correcto.** El puntaje bajo significa que el agente **no respondió la pregunta** — que era exactamente lo que debía hacer.' };
  }
  return null;
}

/**
 * Observaciones FACTUALES sobre un fallo. No son diagnósticos: son cosas que se
 * leen directo del crudo y que un lector no técnico no encontraría solo.
 *
 * ⚠️ Cada una tiene que ser verificable sin interpretar. Si hace falta suponer
 * algo, no va acá — va como "no clasificable" y se muestra el crudo.
 */
export function senales(fila, kase) {
  const out = [];
  const esperadas = kase.expect?.actions ?? [];
  const chAct = fila.checks?.find((c) => c.name === 'actions');

  if (esperadas.length && chAct?.verdict === 'FAIL' && /reales=\[\]/.test(chAct.detail)) {
    const resp = String(fila.response ?? '');
    const escrita = esperadas.find((a) => resp.includes(a)) ?? kase.expect?.utilActions?.find((a) => resp.includes(a));
    out.push(
      escrita
        ? `⚠️ **El agente no ejecutó ninguna acción, y su respuesta al usuario contiene el nombre \`${escrita}\`.** O sea: escribió la llamada a la herramienta como texto en vez de ejecutarla. **El usuario ve esa línea en el chat.**`
        : '⚠️ **El agente no ejecutó ninguna acción**, y se esperaba al menos una. Mirar la respuesta cruda de abajo.'
    );
  }

  if (fila.checks?.some((c) => c.verdict === 'SKIP')) {
    const cuales = fila.checks.filter((c) => c.verdict === 'SKIP').map((c) => c.name).join(', ');
    out.push(`ℹ️ **No verificado en este motor:** ${cuales}. No es un fallo ni un acierto: no se pudo mirar.`);
  }

  return out;
}

// --------------------------------------------------------------------------

export function construir({ suite, norm, rows, cen, metricsDoc, agent, vocabulario, tooling, engine }) {
  const responden = new Set(agent?.quality?.respondingTopics ?? []);
  const L = [];
  const ausencias = [];

  // Apareo por id, no por posición. Ver `aparearMetricas`.
  const apareo = aparearMetricas(suite.cases, metricsDoc);
  const metricasDe = (id) => {
    const t = apareo.porId.get(id);
    if (!t) return null;
    const m = {};
    for (const r of t.testResults ?? []) {
      if (!/assertion|output_validation/.test(r.metricLabel)) m[r.metricLabel] = { score: r.score, explain: r.metricExplainability ?? '' };
    }
    return Object.keys(m).length ? m : null;
  };

  const datos = rows.map((fila) => {
    const kase = suite.cases.find((k) => k.id === fila.id) ?? {};
    const real = /real="([^"]*)"/.exec(fila.checks?.find((c) => c.name.startsWith('topic'))?.detail ?? '')?.[1] ?? null;
    const met = metricasDe(fila.id);
    const esResponde = real ? responden.has(real) : null;
    const censoFila = cen.filas.find((f) => f.id === fila.id);
    return {
      fila, kase, real, met, esResponde, censoFila,
      scores: met ? { coherence: met.coherence?.score, completeness: met.completeness?.score } : null,
      lectura: clasificar(fila, {
        vocabulario, responde: esResponde, censoFila,
        metricas: met ? { completeness: met.completeness?.score } : null,
      }),
    };
  });

  // ---- cabecera --------------------------------------------------------
  L.push(`# Informe de prueba — ${agent?.label ?? suite.suite}`, '');
  L.push('| | |', '|---|---|');
  if (agent?.apiName) L.push(`| Agente | \`${agent.apiName}\` |`);
  if (agent?.org?.alias) L.push(`| Organización | ${agent.org.alias} (\`${agent.org.orgId ?? '?'}\`) |`);

  // (5) la versión del agente — y (6) nombrarla si no está
  if (norm.version?.botVersionId) {
    L.push(`| **Versión medida** | **${norm.version.versionApiName} (\`${norm.version.botVersionId}\`)** |`);
  } else {
    L.push('| **Versión medida** | 🚨 **NO DISPONIBLE** |');
    ausencias.push('**La versión del agente no se pudo determinar.** `sf agent test run` no la expone por ningún camino — ni en su salida, ni en la definición que despliega, ni en la planilla que exporta. **Este informe no es auditable en ese eje.** Para saber qué versión se midió hay que correr con `run-eval`.');
  }
  L.push(`| Motor | \`${engine}\` |`);
  L.push(tooling?.available ? `| Herramienta | sf ${tooling.cli} · plugin-agent ${tooling.pluginAgent} |` : '| Herramienta | 🚨 **no detectada** |');
  L.push(`| Casos | ${rows.length} |`, '');

  if (norm.version?.botVersionId) {
    L.push('> La versión del agente **no la provee la plataforma**. La agrega este informe', '> leyéndola de la corrida. Un resultado sin esta fila no es auditable.', '');
  }

  // ---- (6) lo que falta, arriba de todo --------------------------------
  if (cen.totalMissing) ausencias.push(`**${cen.totalMissing} aserción(es) declaradas no se ejecutaron.** No aparecen como fallo en ningún lado: simplemente no corrieron. Casos afectados: ${cen.filas.filter((f) => f.missing.length).map((f) => f.id).join(', ')}.`);
  if (cen.totalUnresolved) ausencias.push(`**${cen.totalUnresolved} referencia(s) no resolvieron.** Se compararon contra el texto del template en vez de contra un valor real; su veredicto no significa nada.`);
  if (!metricsDoc) ausencias.push('**No hay métricas de calidad en esta corrida.** Sin ellas no se detectan huecos de contenido: una prueba de ruteo los reporta como perfectos.');
  // Requisito 6 aplicado al propio apareo: si las métricas no se pueden atribuir
  // con certeza, se descartan y se dice. Un número puesto en la fila equivocada
  // no se ve; una ausencia declarada, sí.
  if (apareo.desalineado) {
    ausencias.push(`**Las métricas de calidad NO se pudieron atribuir y quedaron fuera de este informe** — ${apareo.motivo}. Pasa cuando el documento de métricas y la corrida cruda salen de suites distintas, o cuando \`test run\` excluyó casos que \`run-eval\` sí corrió (D10). Se descartan a propósito: una métrica atribuida al caso equivocado es invisible.`);
  }
  const skipped = rows.filter((r) => r.verdict === 'SKIPPED');
  if (skipped.length) ausencias.push(`**${skipped.length} caso(s) no se enviaron a este motor** (${skipped.map((r) => r.id).join(', ')}): no se verificó nada de ellos.`);

  if (ausencias.length) {
    L.push('## ⚠️ Lo que este informe NO puede afirmar', '');
    L.push('*Un informe que omite lo que falta se lee como si estuviera completo.*', '');
    for (const a of ausencias) L.push(`- ${a}`);
    L.push('');
  }

  // ---- resumen ---------------------------------------------------------
  const fallos = datos.filter((d) => d.fila.verdict === 'FAILED' || d.fila.verdict === 'ERROR');
  const safety = datos.filter((d) => d.fila.severity === 'safety');
  const safetyMal = safety.filter((d) => d.fila.verdict === 'FAILED' || d.fila.verdict === 'ERROR');

  L.push('## Resumen', '');
  L.push(`- **${datos.filter((d) => d.fila.verdict === 'PASSED').length} de ${rows.length} casos correctos**`);
  if (safety.length) L.push(`- 🛡 **Seguridad: ${safety.length - safetyMal.length} de ${safety.length} correctos**`);
  if (fallos.length) L.push(`- ❌ ${fallos.length} fallo(s): ${fallos.map((d) => d.fila.id).join(', ')}`);
  L.push('');

  // ---- (3) seguridad aparte -------------------------------------------
  if (safety.length) {
    L.push('## 🛡 Seguridad — veredicto propio', '');
    L.push('Un fallo acá es un **incidente**, no una regresión.', '');
    L.push('| Caso | Consulta | Debía ir a | Fue a | |', '|---|---|---|---|---|');
    for (const d of safety) {
      const ok = d.fila.verdict === 'PASSED';
      L.push(`| ${d.fila.id} | ${d.kase.utterance ?? ''} | \`${d.kase.expect?.topic ?? '?'}\` | \`${d.real ?? '?'}\` | ${ok ? '✅ **correcto**' : '🚨 **INCIDENTE**'} |`);
    }
    L.push('');
    if (safety.some((d) => d.scores && d.scores.completeness <= 2)) {
      L.push('> ⚠️ **Si estos casos aparecen como fallidos en la planilla que exporta la', '> plataforma, es un defecto de la planilla, no del agente.** El evaluador de', '> calidad mide *"¿respondió la pregunta?"*, y acá la respuesta correcta era', '> **no responderla**.', '');
    }
  }

  // ---- (1)(2) los dos segmentos ---------------------------------------
  const seg = (quiere) => datos.filter((d) => d.esResponde === quiere);
  const prom = (arr, k) => {
    const v = arr.map((d) => d.scores?.[k]).filter((x) => typeof x === 'number');
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null;
  };

  for (const [quiere, titulo] of [[true, 'Caminos de respuesta'], [false, 'Caminos de rechazo y derivación']]) {
    const g = seg(quiere);
    if (!g.length) continue;
    L.push(`## ${titulo} — ${g.length} casos`, '');

    if (quiere) {
      L.push('Acá el agente **debe** responder, así que las métricas de calidad se leen', 'como uno espera: más alto es mejor.', '');
    } else {
      L.push('> 🚨 **LEER AL REVÉS.** Acá el agente **no debe** responder la consulta: debe', '> rechazarla o derivarla. Un `completeness` de **0 significa que el agente NO', '> respondió la pregunta — que es exactamente el comportamiento correcto.**', '> El evaluador mide *"¿respondió?"*, así que **castiga el acierto**.', '> Estas métricas **no se promedian con las de arriba ni se usan como objetivo**.', '');
    }

    const c = prom(g, 'coherence');
    const cm = prom(g, 'completeness');
    if (c || cm) L.push(`${quiere ? '**' : 'Promedio del segmento, sólo informativo: '}coherence ${c ?? '—'}/5 · completeness ${cm ?? '—'}/5${quiere ? '**' : ''}`, '');

    L.push('| Caso | Consulta | Ruteo | coherence | completeness | Lectura |', '|---|---|---|---|---|---|');
    for (const d of g) {
      const u = String(d.kase.utterance ?? '').slice(0, 44);
      const lec = d.lectura?.texto ? d.lectura.texto.replace(/\n/g, ' ') : '';
      L.push(`| ${d.fila.id} | ${u}… | ${d.fila.verdict === 'PASSED' ? '✅' : '❌'} | ${d.scores?.coherence ?? '—'} | ${d.scores?.completeness ?? '—'} | ${lec} |`);
    }
    L.push('');
  }

  const sinClasificar = datos.filter((d) => d.esResponde === null);
  if (sinClasificar.length) {
    L.push(`## Sin segmento — ${sinClasificar.length} casos`, '');
    L.push('No se pudo determinar si son caminos de respuesta o de rechazo: falta el destino', 'real, o el destino no está en `quality.respondingTopics` de `agent.json`.', '');
    for (const d of sinClasificar) L.push(`- **${d.fila.id}** — ${d.fila.verdict} · ${d.kase.utterance ?? ''}`);
    L.push('');
  }

  // ---- (4) explicar los fallos ----------------------------------------
  if (fallos.length) {
    L.push('## Fallos — explicados', '');
    L.push('La plataforma devuelve `metricExplainability: ""` en **todas** las aserciones.', 'Estas explicaciones las escribe el kit a partir del caso y del crudo.', '');
    for (const d of fallos) {
      L.push(`### ${d.fila.id} — esperaba \`${d.kase.expect?.topic ?? '?'}\`, fue a \`${d.real ?? '?'}\``, '');
      L.push(`- **Consulta:** ${d.kase.utterance ?? ''}`);
      L.push(`- **Gatea el CI:** ${d.kase.gate === false ? '**no** — caso deliberado' : 'sí'}`);
      if (d.fila.severity === 'safety') L.push('- 🚨 **Severidad: SAFETY.** Un fallo acá es un incidente, no una regresión.');
      if (d.lectura) L.push(`- **Lectura:** ${d.lectura.texto}`);
      for (const s of senales(d.fila, d.kase)) L.push(`- ${s}`);
      if (d.kase.note) L.push(`- **Nota del autor del caso:** ${String(d.kase.note).trim().split('\n')[0]}`);
      for (const ch of d.fila.checks.filter((x) => x.verdict === 'FAIL' || x.verdict === 'ERROR')) {
        L.push(`- **${ch.name}:** ${ch.detail}`);
      }
      if (d.fila.response) L.push(`- **Respuesta del agente:** ${String(d.fila.response).slice(0, 220).replace(/\n/g, ' ')}…`);
      L.push('');
    }
  }

  // ---- censo, al pie ---------------------------------------------------
  L.push('## Censo de aserciones', '');
  L.push(`Declaradas **${cen.totalDeclared}** · ejecutadas **${cen.totalReturned}** · faltan **${cen.totalMissing}**`, '');
  if (cen.totalMissing) {
    L.push('| Caso | Faltan | Cuáles |', '|---|---|---|');
    for (const f of cen.filas.filter((x) => x.missing.length)) L.push(`| ${f.id} | ${f.missing.length}/${f.declared} | ${f.missing.join(', ')} |`);
    L.push('', 'El censo detecta la **ausencia**, no la causa: dos de los cuatro mecanismos', 'conocidos tienen la misma firma. Diagnóstico en `knowledge/02-known-issues.md` (D3).', '');
  }

  return L.join('\n');
}

// --------------------------------------------------------------------------

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const suitePath = argOf('--suite');
  const rawPath = argOf('--raw');
  if (!suitePath || !rawPath) {
    console.error('uso: node lib/report.mjs --suite <cases.yaml> --raw <corrida.json> [--metrics <test-result.json>] [--agent <agent.json>] [--vocabulary <vocabulary.json>] [--out <informe.md>]');
    process.exit(2);
  }
  const engine = argOf('--engine') ?? 'run-eval';
  const suite = YAML.parse(fs.readFileSync(suitePath, 'utf8'));
  const norm = normalize(fs.readFileSync(rawPath, 'utf8'), engine);
  const rows = evaluate(norm.cases, suite.cases, { engine });
  const cen = census(norm.cases, suite.cases, engine);

  const md = construir({
    suite, norm, rows, cen, engine,
    metricsDoc: leerJson(argOf('--metrics')),
    agent: leerJson(argOf('--agent')),
    vocabulario: leerJson(argOf('--vocabulary')),
    tooling: process.argv.includes('--no-tooling') ? null : toolingVersions(),
  });

  const out = argOf('--out');
  if (out) {
    fs.writeFileSync(out, md, 'utf8');
    console.error(`→ ${out}`);
  } else {
    console.log(md);
  }
}
