/**
 * Tests de `lib/report.mjs` — el informe auditable.
 *
 * El requisito que más se testea acá es el 6: **nombrar la ausencia**. Un
 * informe que omite lo que falta se lee como si estuviera completo, y ése es
 * exactamente el defecto del export de la plataforma.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { normalize, evaluate, census } from '../lib/assert.mjs';
import { construir, clasificar, senales, aparearMetricas } from '../lib/report.mjs';

const FX = path.resolve(import.meta.dirname, 'fixtures');
const leer = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function informe(rawFile, engine, { metrics = null, vocabulario = undefined } = {}) {
  const suite = YAML.parse(fs.readFileSync(path.join(FX, 'routing.cases.yaml'), 'utf8'));
  const norm = normalize(fs.readFileSync(path.join(FX, rawFile), 'utf8'), engine);
  const rows = evaluate(norm.cases, suite.cases, { engine });
  return construir({
    suite, norm, rows, engine,
    cen: census(norm.cases, suite.cases, engine),
    metricsDoc: metrics ? leer(path.join(FX, metrics)) : null,
    agent: leer(path.join(FX, 'agent.json')),
    vocabulario: vocabulario === undefined ? leer(path.join(FX, 'vocabulary.json')) : vocabulario,
    tooling: { available: true, cli: 'x', pluginAgent: 'y' },
  });
}

// ---------------------------------------------------------------------------
describe('requisito 5 — la versión del agente', () => {
  test('con `run-eval` la incluye', () => {
    const md = informe('run-eval-c2.json', 'run-eval');
    assert.match(md, /\*\*v29 \(`0X9O30000004h1ZKAQ`\)\*\*/);
  });
});

describe('requisito 6 — nombrar la ausencia, no callarla', () => {
  test('con `test run` dice que la versión NO se pudo determinar', () => {
    const md = informe('test-run-c2.json', 'test-run');
    assert.match(md, /Lo que este informe NO puede afirmar/);
    assert.match(md, /NO DISPONIBLE/);
    assert.match(md, /no la expone por ningún camino/);
  });

  test('sin métricas, lo dice — y explica qué se pierde', () => {
    const md = informe('run-eval-c2.json', 'run-eval');
    assert.match(md, /No hay métricas de calidad en esta corrida/);
    assert.match(md, /una prueba de ruteo los reporta como perfectos/);
  });

  test('con todo presente, NO inventa una sección de ausencias', () => {
    const md = informe('run-eval-c2.json', 'run-eval', { metrics: 'test-run-metrics-c2.json' });
    assert.equal(/Lo que este informe NO puede afirmar/.test(md), false);
  });
});

describe('requisitos 1 y 2 — segmentar e invertir la lectura', () => {
  const md = () => informe('run-eval-c2.json', 'run-eval', { metrics: 'test-run-metrics-c2.json' });

  test('separa los dos segmentos y no los promedia juntos', () => {
    const m = md();
    assert.match(m, /## Caminos de respuesta — 7 casos/);
    assert.match(m, /## Caminos de rechazo y derivación — 5 casos/);
    assert.match(m, /no se promedian con las de arriba/);
  });

  test('en el segmento de rechazo la instrucción de leer al revés está ANTES de la tabla', () => {
    const m = md();
    assert.ok(m.indexOf('LEER AL REVÉS') < m.indexOf('| R10 |'), 'la advertencia va antes que los números');
  });

  test('un completeness bajo se lee distinto según el segmento', () => {
    const rechazo = clasificar({ verdict: 'PASSED', checks: [] }, { responde: false, metricas: { completeness: 0 } });
    const respuesta = clasificar({ verdict: 'PASSED', checks: [] }, { responde: true, metricas: { completeness: 0 } });
    assert.equal(rechazo.clave, 'rechazo-correcto');
    assert.equal(respuesta.clave, 'hueco-contenido');
  });
});

describe('requisito 3 — seguridad aparte', () => {
  test('los casos safety tienen su propia tabla, con veredicto propio', () => {
    const md = informe('run-eval-c2.json', 'run-eval', { metrics: 'test-run-metrics-c2.json' });
    assert.match(md, /## 🛡 Seguridad — veredicto propio/);
    assert.match(md, /Seguridad: 2 de 2 correctos/);
    // y avisa que la planilla cruda los muestra al revés
    assert.match(md, /es un defecto de la planilla, no del agente/);
  });
});

describe('clasificación — sin sobre-diagnosticar', () => {
  const conTopicFallado = (real) => ({
    verdict: 'FAILED',
    checks: [{ name: 'topic(exact)', verdict: 'FAIL', detail: `esperado="X" real="${real}"` }],
  });
  const vocab = { topics: { GeneralFAQ: {}, off_topic: {} } };

  test('destino conocido → la expectativa está mal escrita', () => {
    assert.equal(clasificar(conTopicFallado('GeneralFAQ'), { vocabulario: vocab }).clave, 'expectativa');
  });

  test('destino desconocido → el vocabulario quedó viejo', () => {
    assert.equal(clasificar(conTopicFallado('escalation'), { vocabulario: vocab }).clave, 'vocabulario');
  });

  test('sin vocabulario NO adivina: dice que no se puede saber', () => {
    assert.equal(clasificar(conTopicFallado('loquesea'), {}).clave, 'no-clasificable');
  });

  test('un fallo que no entra en ningún patrón se declara no clasificable', () => {
    const f = { verdict: 'FAILED', checks: [{ name: 'actions', verdict: 'FAIL', detail: '...' }] };
    assert.equal(clasificar(f, { vocabulario: vocab }).clave, 'no-clasificable');
  });

  test('una aserción ausente gana sobre cualquier otra lectura', () => {
    const f = conTopicFallado('GeneralFAQ');
    const c = clasificar(f, { vocabulario: vocab, censoFila: { missing: ['custom_0'] } });
    assert.equal(c.clave, 'sin-verificar', 'primero hay que decir que no se verificó');
  });

  test('una ref sin resolver invalida el veredicto y se dice así', () => {
    const c = clasificar({ verdict: 'FAILED', checks: [] }, { censoFila: { missing: [], unresolved: ['custom_0'] } });
    assert.equal(c.clave, 'ref-sin-resolver');
    assert.match(c.texto, /no significa nada/);
  });
});

describe('señales factuales — verificables, no interpretadas', () => {
  test('detecta que el agente escribió la llamada como texto', () => {
    const fila = {
      response: 'check_business_hours(conversationSummary=el paciente pidió un ejecutivo)',
      checks: [{ name: 'actions', verdict: 'FAIL', detail: 'esperadas=[X] reales=[] faltan=[X]' }],
    };
    const s = senales(fila, { expect: { actions: ['X'], utilActions: ['check_business_hours'] } });
    assert.match(s[0], /escribió la llamada a la herramienta como texto/);
    assert.match(s[0], /El usuario ve esa línea en el chat/);
  });

  test('si la respuesta NO contiene el nombre, se limita a lo observable', () => {
    const fila = { response: 'Perdón, no puedo ayudarte.', checks: [{ name: 'actions', verdict: 'FAIL', detail: 'esperadas=[X] reales=[] faltan=[X]' }] };
    const s = senales(fila, { expect: { actions: ['X'] } });
    assert.match(s[0], /no ejecutó ninguna acción/);
    assert.equal(/como texto/.test(s[0]), false, 'sin evidencia, no se afirma');
  });

  test('un SKIP se nombra como "no verificado", ni fallo ni acierto', () => {
    const s = senales({ checks: [{ name: 'utilActions', verdict: 'SKIP', detail: '' }] }, {});
    assert.match(s[0], /No verificado en este motor/);
    assert.match(s[0], /No es un fallo ni un acierto/);
  });
});

// ---------------------------------------------------------------------------
/**
 * Apareo de métricas — el bug de la familia "desalineo por índice".
 *
 * POR QUÉ ESTÁ ACÁ. `metricasDe()` indexaba `metricsDoc.testCases[i]` por la
 * posición en `rows`, que incluye los SKIPPED. Es el mismo defecto que
 * `evaluate()` corrige con un cursor — el que ya los quemó una vez — reaparecido
 * en la capa que produce el artefacto que ve el cliente.
 *
 * Y muerde MÁS fuerte acá: `--raw` sale de `run-eval` y `--metrics` de
 * `test run`, así que los subconjuntos difieren siempre que la suite tenga un
 * multi-turno sin `captured_agent_turns` (D10). No es un caso de borde.
 */
describe('apareo de métricas — no por índice', () => {
  const suiteBase = () => YAML.parse(fs.readFileSync(path.join(FX, 'routing.cases.yaml'), 'utf8'));
  const metrics = () => leer(path.join(FX, 'test-run-metrics-c2.json'));

  test('sin exclusiones, cada caso recibe SUS métricas', () => {
    const suite = suiteBase();
    const { porId, desalineado } = aparearMetricas(suite.cases, metrics());
    assert.equal(desalineado, false);
    // la utterance del testCase apareado tiene que ser la del caso
    for (const kase of suite.cases) {
      const tc = porId.get(kase.id);
      if (tc) assert.equal(tc.inputs.utterance, kase.utterance, `caso ${kase.id}`);
    }
  });

  test('🚨 con un multi-turno que `test run` excluye, NO corre todo un lugar', () => {
    const suite = suiteBase();
    // Caso multi-turno sin captured_agent_turns: run-eval lo corre, test-run no.
    suite.cases.unshift({ id: 'M0', utterance: 'hola', turns: [{ user: 'hola' }], expect: { topic: 'GeneralFAQ' } });

    const { porId } = aparearMetricas(suite.cases, metrics());
    assert.equal(porId.has('M0'), false, 'el multi-turno no tiene métricas: test run no lo corrió');

    const r1 = suite.cases.find((c) => c.id === 'R1');
    assert.equal(porId.get('R1')?.inputs.utterance, r1.utterance,
      'R1 tiene que recibir SUS métricas, no las del vecino');
  });

  test('si las utterances no coinciden, descarta TODO en vez de adivinar', () => {
    const suite = suiteBase();
    suite.cases[3] = { ...suite.cases[3], utterance: 'una utterance que no está en el doc de métricas' };
    const { porId, desalineado, motivo } = aparearMetricas(suite.cases, metrics());
    assert.equal(desalineado, true);
    assert.match(motivo, /utterance no coincide/);
    assert.equal(porId.size, 0, 'parcial sería peor: mostraría números sin decir cuáles faltan');
  });

  test('si el doc de métricas es de otra suite, lo detecta por el conteo', () => {
    const suite = suiteBase();
    suite.cases = suite.cases.slice(0, 5);
    const { desalineado, motivo } = aparearMetricas(suite.cases, metrics());
    assert.equal(desalineado, true);
    assert.match(motivo, /12 casos y la suite envía 5/);
  });

  test('el informe NOMBRA el desalineo en vez de callarlo (requisito 6)', () => {
    const suite = suiteBase();
    suite.cases = suite.cases.slice(0, 5);
    const norm = normalize(fs.readFileSync(path.join(FX, 'run-eval-c2.json'), 'utf8'), 'run-eval');
    const rows = evaluate(norm.cases, suite.cases, { engine: 'run-eval' });
    const md = construir({
      suite, norm, rows, engine: 'run-eval',
      cen: census(norm.cases, suite.cases, 'run-eval'),
      metricsDoc: metrics(),
      agent: leer(path.join(FX, 'agent.json')),
      vocabulario: leer(path.join(FX, 'vocabulary.json')),
      tooling: { available: true, cli: 'x', pluginAgent: 'y' },
    });
    assert.match(md, /Lo que este informe NO puede afirmar/);
    assert.match(md, /métricas de calidad NO se pudieron atribuir/);
  });
});
