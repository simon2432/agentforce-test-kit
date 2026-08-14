#!/usr/bin/env node
/**
 * Traza — qué se envió y qué se recibió, por línea de testeo.
 *
 * POR QUÉ EXISTE
 * El repo tenía los dos extremos y nada en el medio: el crudo (500 KB de JSON,
 * ilegible) y los informes derivados (`RESUMEN.md` dice qué se verificó pero no
 * con qué datos; `informe.md` está armado alrededor de las métricas de calidad y
 * trunca la consulta). Para leer una corrida había que abrir el crudo.
 *
 * 🚨 «LO ENVIADO» SALE DEL `spec.yaml`, NO DE LA SUITE.
 * El spec es el registro inmutable de lo que se le mandó al motor. La suite es
 * un archivo vivo: si se edita después de la corrida, deja de describirla. Esa
 * diferencia ya mordió una vez acá — dos corridas de seguridad con resultados
 * derivados idénticos donde una había fallado, y sólo el `spec.yaml` lo mostraba.
 * Sin `--spec`, la traza lo declara en vez de rellenarlo con la suite.
 *
 * ⚠️ ESTO NO ES UN VEREDICTO. Es una vista. El veredicto lo calcula `assert.mjs`.
 *
 * Uso:
 *   node lib/traza.mjs --raw <run>/raw.json [--raw <otro>.json ...] \
 *                      [--spec <run>/spec.yaml] [--suite <cases.yaml>] \
 *                      [--agent agents/<slug>/agent.json] [--detalle] --out <run>/traza.md
 *
 *   --detalle  agrega, por caso, el input/output completo de cada acción, las
 *              stateVariables y las contextVariables. Sin el flag la traza es
 *              una tabla y las respuestas: para ver todo ya está el crudo.
 */

import fs from 'node:fs';
import YAML from 'yaml';
import { extract } from './extract.mjs';
import { normalize, evaluate } from './assert.mjs';

// --------------------------------------------------------------------------
// Formato
// --------------------------------------------------------------------------

/** Una celda de tabla markdown no soporta `|` ni saltos de línea. */
export function celda(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v).replace(/\r?\n+/g, ' ⏎ ').replace(/\|/g, '\\|').trim();
}

/** Recorta para la tabla. El texto completo va en la sección de respuestas. */
export function corto(v, n = 52) {
  const s = celda(v);
  if (s === '—') return s;
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/** Saca las claves internas del runtime (`__action_execution_status__`, etc). */
export const limpio = (o) =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !k.startsWith('__')));

/**
 * Un valor de input/output en una línea. Si queda una sola clave se muestra el
 * valor pelado, que es el caso normal y el que uno quiere leer.
 */
export function unaLinea(o, max = 90) {
  const l = limpio(o);
  const claves = Object.keys(l);
  if (!claves.length) return null;
  if (claves.length === 1) {
    const v = l[claves[0]];
    return corto(typeof v === 'string' ? v : JSON.stringify(v), max);
  }
  // Varias claves: se muestra la de texto más largo, que es la que lleva la
  // señal. El resto suele ser metadata (`generationId`, `outputLanguage`,
  // `isPreviewOnly`) y en la vista simple es ruido. Todo entero: `--detalle`.
  const textos = claves.filter((k) => typeof l[k] === 'string');
  const k = (textos.length ? textos : claves)
    .sort((a, b) => String(l[b]).length - String(l[a]).length)[0];
  return `${k}: ${corto(typeof l[k] === 'string' ? l[k] : JSON.stringify(l[k]), max)}`;
}

const MARCA = { PASSED: '✅', FAILED: '❌', ERROR: '💥', MISSING: '❓', XFAIL: '🟡', XPASS: '🔔' };

/** El centinela del descubrimiento: falla a propósito para revelar el real. */
const SENTINELA = '__DISCOVERY__';

/**
 * Coincidencia calculada SPEC vs CRUDO — los dos inmutables.
 *
 * 🚨 Es el único indicador de esta traza inmune a la deriva de suite. El
 * veredicto de `assert.mjs` se recalcula contra el archivo de suite **actual**:
 * si la suite se editó después de la corrida, un caso que falló entonces
 * aparece hoy en verde.
 *
 *   '✔'  el topic esperado y el real son idénticos
 *   '≈'  el esperado es SUBCADENA del real. `run-eval` compara con `contains`,
 *        así que esto PASA en el motor — y es justo el accidente contra el que
 *        el repo exige nombres completos (`GeneralFAQ`, no `FAQ`)
 *   '✘'  no coincide
 *   '🔍' centinela de descubrimiento: falla por diseño
 */
export function coincidencia(esperado, real) {
  if (!esperado) return null;
  if (esperado === SENTINELA) return '🔍';
  if (esperado === real) return '✔';
  if (real && String(real).includes(esperado)) return '≈';
  return '✘';
}

// --------------------------------------------------------------------------
// Lectura de lo ENVIADO
// --------------------------------------------------------------------------

/**
 * Lo que se le mandó al motor, caso por caso, leído del spec.
 * Devuelve `null` si no hay spec: la traza lo declara en vez de inventarlo.
 */
export function leerSpec(texto) {
  if (!texto) return null;
  const spec = YAML.parse(texto);
  return (spec?.testCases ?? []).map((tc) => ({
    utterance: tc.utterance ?? null,
    turnosPrevios: (tc.conversationHistory ?? []).map((m) => m.message),
    expectedTopic: tc.expectedTopic ?? null,
    expectedActions: tc.expectedActions ?? null,
    contextVariables: tc.contextVariables ?? null,
    customEvaluations: (tc.customEvaluations ?? []).map((ce) => ({
      label: ce.label ?? ce.name,
      operator: (ce.parameters ?? []).find((p) => p.name === 'operator')?.value,
      actual: (ce.parameters ?? []).find((p) => p.name === 'actual')?.value,
      expected: (ce.parameters ?? []).find((p) => p.name === 'expected')?.value,
    })),
  }));
}

// --------------------------------------------------------------------------
// Construcción
// --------------------------------------------------------------------------

const accionesDe = (c) => [...c.invokedActions, ...c.utilActions.map((u) => `${u}*`)].join(', ');

/**
 * @param {Array<{archivo:string, ev:object, veredictos?:object}>} corridas
 * @param {Array|null} enviado  filas de leerSpec(), o null
 */
export function construir({ corridas, enviado = null, agente = null, engine = 'run-eval', suitePath = null, specPath = null, detalle = false }) {
  const base = corridas[0];
  const ev = base.ev;
  const L = [];
  const idDe = (i) => base.veredictos?.[i]?.id ?? `caso_${i + 1}`;

  // ---- Cabecera ----------------------------------------------------------
  L.push(`# Traza — ${agente?.label ?? 'agente'}${suitePath ? ` · ${suitePath.split(/[\\/]/).pop().replace('.cases.yaml', '')}` : ''}`, '');
  const cab = [
    agente?.apiName ? `\`${agente.apiName}\`` : null,
    `versión **${ev.version.versionApiName ?? '?'}** (\`${ev.version.botVersionId ?? 'NO DISPONIBLE'}\`)`,
    `motor \`${engine}\``,
    `${ev.cases.length} líneas${corridas.length > 1 ? ` × ${corridas.length} corridas` : ''}`,
  ].filter(Boolean);
  L.push(cab.join(' · '), '');

  // ---- Sólo lo que está mal. Nada de advertencias de rutina. -------------
  const avisos = [];
  if (!ev.version.botVersionId) avisos.push('🚨 La corrida **no expone la versión** del agente: no es auditable en ese eje.');
  if (!ev.version.consistent) avisos.push(`🚨 **Corrió contra más de una versión:** ${ev.version.seen.join(' · ')}.`);
  if (!enviado) avisos.push('⚠️ Sin `--spec`: la columna «esperaba» queda vacía. No se completa con la suite porque la suite pudo cambiar después de la corrida.');
  if (avisos.length) L.push(...avisos.map((a) => `> ${a}`), '');

  // ---- Guía de lectura ---------------------------------------------------
  // Una tabla de siglas obliga a quien la lee a reconstruir el vocabulario.
  // Doce líneas una vez por archivo salen más baratas que esa reconstrucción.
  L.push('**Cómo leer esto** — cada fila es un mensaje que se le mandó al agente y lo que hizo con él.', '');
  L.push('| Columna | Qué es |', '|---|---|');
  L.push('| **Mensaje enviado** | La consulta que recibió el agente, tal cual se le mandó |');
  L.push('| **Subagente esperado** | A dónde debía llegar la consulta. La plataforma lo llama *topic* |');
  L.push('| **Acción esperada** | Qué acción debía invocar, **si el caso lo verifica**. Es el *alias* del `.agent`, no el target: `consultar_faq`, no `apex://BiciStoreFaq` |');
  if (enviado) L.push('| **≟** | Compara lo esperado con lo real, leyendo el `spec.yaml` contra el crudo — los dos inmutables |');
  L.push('| **Subagente usado** · **Acción usada** | Lo que el agente hizo de verdad |');
  L.push('| **Respondió** | Extracto de lo que le contestó al usuario. ⚠️ El texto **no se asserta**: no es reproducible |');
  L.push('| **ms** | Lo que tardó ese turno |');
  if (base.veredictos) L.push('| **V** | Veredicto que calcula `assert.mjs` para ese caso |');
  L.push('');
  L.push('> Un **—** en «acción esperada» significa que el caso **no verifica acciones**, no que el agente ' +
         'no haya invocado ninguna. Declarar una lista vacía no assertaría nada: en `run-eval` la ' +
         'comparación es por subconjunto y la lista vacía está contenida en cualquier cosa.', '');

  // ---- La tabla ----------------------------------------------------------
  const hayV = Boolean(base.veredictos);
  const cols = ['#', 'Caso', 'Mensaje enviado', 'Subagente esperado', 'Acción esperada', '≟', 'Subagente usado', 'Acción usada', 'Respondió', 'ms'];
  if (hayV) cols.splice(2, 0, 'V');
  L.push(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);

  const deriva = [];
  const laxos = [];
  ev.cases.forEach((c, i) => {
    const env = enviado?.[i];
    const ver = base.veredictos?.[i];
    const coin = coincidencia(env?.expectedTopic, c.topic);
    if (coin === '✘' && ver?.verdict === 'PASSED') deriva.push({ id: idDe(i), esperado: env.expectedTopic, real: c.topic });
    if (coin === '≈') laxos.push({ id: idDe(i), esperado: env.expectedTopic, real: c.topic });

    const n = env?.turnosPrevios?.length ?? 0;
    const previos = n ? `_(+${n} turno${n > 1 ? 's' : ''} previo${n > 1 ? 's' : ''})_ ` : '';
    const codigo = (x) => (x ? `\`${x}\`` : '—');
    const lista = (xs) => (xs?.length ? xs.map((x) => `\`${x}\``).join(', ') : '—');

    const fila = [
      String(i + 1),
      `\`${idDe(i)}\``,
      previos + corto(env?.utterance ?? c.utterance, 40),
      codigo(env?.expectedTopic),
      lista(env?.expectedActions),
      coin ?? '—',
      codigo(c.topic),
      lista([...c.invokedActions, ...c.utilActions.map((u) => `${u}*`)]),
      corto(c.response, 40),
      c.durationMs ?? '—',
    ];
    if (hayV) fila.splice(2, 0, coin === '✘' && ver?.verdict === 'PASSED' ? '🚩' : (MARCA[ver?.verdict] ?? '·'));
    L.push(`| ${fila.join(' | ')} |`);
  });
  L.push('');
  L.push('**`acción*`** = es una `@utils.*` (`setVariables`, `transition`, `escalate`). Se ejecuta de verdad, ' +
         'pero la plataforma no la lista en `invokedActions`: sólo aparece en el historial de ejecución, ' +
         'así que `expectedActions` es ciego a ella.');
  if (enviado) {
    L.push('', '**`≟`** — `✔` esperado y real idénticos · `≈` el esperado es **subcadena** del real, que en ' +
           '`run-eval` **pasa igual** porque compara con `contains` · `✘` no coincide · `🔍` centinela de ' +
           'descubrimiento, que falla por diseño para revelar el destino real.');
  }
  L.push('');

  // ---- Avisos que sí importan -------------------------------------------
  if (deriva.length) {
    L.push('### 🚩 Deriva de suite', '');
    L.push('El `spec.yaml` y el veredicto no dicen lo mismo: **la suite se editó después de esta corrida**, ' +
           'así que el verde de `V` describe la suite de hoy, no lo que pasó ese día.', '');
    L.push('| Caso | Se mandó esperando | El agente devolvió |', '|---|---|---|');
    deriva.forEach((d) => L.push(`| \`${d.id}\` | \`${celda(d.esperado)}\` | \`${celda(d.real)}\` |`));
    L.push('');
  }
  if (laxos.length) {
    L.push('### ⚠️ Coincidencias por subcadena', '');
    L.push('El esperado es un fragmento del real y `run-eval` compara con `contains`: **pasa igual**.', '');
    L.push('| Caso | Esperado | Real |', '|---|---|---|');
    laxos.forEach((d) => L.push(`| \`${d.id}\` | \`${celda(d.esperado)}\` | \`${celda(d.real)}\` |`));
    L.push('');
  }

  // ---- Estabilidad: sólo el resultado, y el detalle si algo falla --------
  if (corridas.length > 1) {
    const inestables = [];
    ev.cases.forEach((_, i) => {
      const topics = corridas.map((r) => r.ev.cases[i]?.topic ?? '—');
      const accs = corridas.map((r) => [...(r.ev.cases[i]?.invokedActions ?? []), ...(r.ev.cases[i]?.utilActions ?? [])].join('+') || '—');
      if (new Set(topics).size > 1 || new Set(accs).size > 1) inestables.push({ id: idDe(i), topics, accs });
    });
    const total = ev.cases.length * corridas.length;
    L.push('### Estabilidad entre corridas', '');
    if (!inestables.length) {
      L.push(`✅ **${total}/${total} observaciones idénticas** en topic y acciones.`, '');
    } else {
      L.push(`🚨 **${inestables.length} línea(s) inestables** de ${ev.cases.length}. Un camino que cambia entre corridas no se puede gatear con una sola.`, '');
      L.push('| Caso | Topic por corrida | Acciones por corrida |', '|---|---|---|');
      inestables.forEach((d) => L.push(`| \`${d.id}\` | ${celda(d.topics.join(' ⟂ '))} | ${celda(d.accs.join(' ⟂ '))} |`));
      L.push('');
    }
    L.push('⚠️ Estabilidad de ruteo no es estabilidad de comportamiento: el mismo destino puede resolverse ' +
           'consultando la acción o contestando de memoria. Eso lo detecta la verificación de contenido.', '');
  }

  // ---- Caso por caso -----------------------------------------------------
  L.push('## Caso por caso', '');
  ev.cases.forEach((c, i) => {
    const env = enviado?.[i];
    const ver = base.veredictos?.[i];
    L.push(`### \`${idDe(i)}\`${ver ? ` — ${MARCA[ver.verdict] ?? ''} ${ver.verdict}` : ''}`, '');

    // Los turnos previos primero: son el contexto en el que hay que leer todo
    // lo demás. `run-eval` los EJECUTA, no los inyecta.
    (env?.turnosPrevios ?? []).forEach((t, k) => {
      L.push(`- **Turno previo ${k + 1}** — se ejecuta de verdad, no se simula`);
      L.push(`  - 👤 «${celda(t)}»`);
      L.push(`  - 🤖 ${corto(c.historyResponses?.[k], 130)}`);
    });

    L.push(`- **Mensaje enviado:** «${celda(env?.utterance ?? c.utterance)}»`);

    // Esperado contra real, nombrando cada cosa.
    if (env?.expectedTopic) {
      const ok = coincidencia(env.expectedTopic, c.topic);
      L.push(`- **Subagente** — esperado \`${celda(env.expectedTopic)}\` · usado \`${celda(c.topic)}\` ${ok}`);
    } else {
      L.push(`- **Subagente usado:** \`${celda(c.topic)}\`${enviado ? ' _(el caso no declara subagente esperado)_' : ''}`);
    }

    if (env?.expectedActions?.length) {
      const faltan = env.expectedActions.filter((a) => !c.invokedActions.includes(a));
      L.push(`- **Acción** — esperada \`${env.expectedActions.join(', ')}\` · usada ${c.invokedActions.length ? `\`${c.invokedActions.join(', ')}\`` : '_ninguna_'} ${faltan.length ? '✘' : '✔'}`);
    } else if (c.invokedActions.length) {
      L.push(`- **Acción usada:** \`${c.invokedActions.join(', ')}\` _(el caso no verifica acciones)_`);
    }
    if (c.utilActions.length) {
      L.push(`- **\`@utils.*\` ejecutadas:** \`${c.utilActions.join(', ')}\` — invisibles a \`expectedActions\``);
    }

    // La salida de la acción es el dato duro: en un camino determinista es
    // byte-exacto y es lo único assertable de contenido.
    for (const a of c.actionIO ?? []) {
      const inp = unaLinea(a.input, 60);
      const out = unaLinea(a.output, 110);
      if (inp) L.push(`- **Entrada de \`${a.name}\`:** «${inp}»`);
      L.push(`- **Salida de \`${a.name}\`:** ${out ? `«${out}»` : '—'}`);
    }

    if (env?.customEvaluations?.length) {
      for (const ce of env.customEvaluations) {
        L.push(`- **Aserción de contenido:** _${celda(ce.label)}_ — esperaba \`${celda(ce.operator)}\` «${corto(ce.expected, 80)}»`);
      }
    }

    L.push('- **Respondió al usuario** — ⚠️ este texto no se asserta:');
    L.push(`> ${celda(c.response ?? '(sin respuesta)').replace(/ ⏎ /g, '\n> ')}`, '');
  });

  // ---- Detalle opcional --------------------------------------------------
  if (detalle) {
    L.push('---', '', '## Detalle', '');
    ev.cases.forEach((c, i) => {
      L.push(`### \`${idDe(i)}\``, '');
      for (const a of c.actionIO ?? []) {
        L.push(`**\`${a.name}\`** — ${a.latencyMs ?? '?'} ms`, '');
        L.push('```json', JSON.stringify({ input: a.input, output: a.output }, null, 2), '```');
      }
      if (c.stateVariables) {
        const vivas = Object.fromEntries(Object.entries(c.stateVariables).filter(([, v]) => v !== null && v !== false));
        if (Object.keys(vivas).length) L.push('_stateVariables_', '```json', JSON.stringify(vivas, null, 2), '```');
      }
      if (c.contextVariables) {
        const todasNull = Object.values(c.contextVariables).every((v) => v === null);
        L.push(`_contextVariables_ — ${todasNull ? '**las `linked` en NULL: la razón estructural por la que testear no dispara DML**' : '🚨 **hay valores no nulos: revisar**'}`);
        L.push('```json', JSON.stringify(c.contextVariables, null, 2), '```');
      }
      L.push('');
    });
  }

  L.push('---', `_\`lib/traza.mjs\` desde el crudo archivado${detalle ? '' : ' · `--detalle` agrega acciones y variables completas'}. No sustituye a \`assert.mjs\`._`);
  return L.join('\n');
}

// --------------------------------------------------------------------------

function argsOf(flag) {
  const out = [];
  process.argv.forEach((a, i) => { if (a === flag) out.push(process.argv[i + 1]); });
  return out;
}
const argOf = (flag) => argsOf(flag)[0];

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const raws = argsOf('--raw');
  const out = argOf('--out');
  if (!raws.length || !out) {
    console.error('uso: node lib/traza.mjs --raw <raw.json> [--raw <otro.json> ...] [--spec <spec.yaml>]');
    console.error('                        [--suite <cases.yaml>] [--agent <agent.json>] [--detalle] --out <traza.md>');
    process.exit(2);
  }
  const engine = argOf('--engine') ?? 'run-eval';
  const specPath = argOf('--spec');
  const suitePath = argOf('--suite');
  const agentPath = argOf('--agent');

  const corridas = raws.map((archivo) => {
    const texto = fs.readFileSync(archivo, 'utf8');
    const ev = extract(texto);
    let veredictos = null;
    if (suitePath) {
      const suite = YAML.parse(fs.readFileSync(suitePath, 'utf8'));
      veredictos = evaluate(normalize(texto, engine).cases, suite.cases, { engine });
    }
    return { archivo, ev, veredictos };
  });

  const md = construir({
    corridas,
    enviado: specPath ? leerSpec(fs.readFileSync(specPath, 'utf8')) : null,
    agente: agentPath ? JSON.parse(fs.readFileSync(agentPath, 'utf8')) : null,
    engine, suitePath, specPath,
    detalle: process.argv.includes('--detalle'),
  });

  fs.writeFileSync(out, md, 'utf8');
  console.log(`traza: ${corridas[0].ev.cases.length} líneas × ${corridas.length} corrida(s) → ${out}`);
  // Sin versión no hay auditoría posible. Mismo criterio que extract.mjs.
  process.exit(corridas[0].ev.version.botVersionId ? 0 : 1);
}
