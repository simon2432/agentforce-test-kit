/**
 * Tests de `lib/assert.mjs`.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * En la ronda 3 aparecieron TRES bugs en el wrapper — la capa que existe
 * precisamente para corregir los bugs de la plataforma. Los tres eran falsos
 * negativos y **los tres estaban en el camino de `test run`**, porque el wrapper
 * sólo se había validado contra `run-eval`.
 *
 * Los fixtures son corridas REALES (ver fixtures/README.md). La verdad de
 * referencia salió de contrastar los dos motores caso por caso, no de opinar.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { normalize, evaluate, matchTopic, report, compareCustom, paramOf } from '../lib/assert.mjs';

const FX = path.resolve(import.meta.dirname, 'fixtures');
const fx = (f) => path.join(FX, f);
const suiteOf = (f) => YAML.parse(fs.readFileSync(fx(f), 'utf8'));
const rawOf = (f) => fs.readFileSync(fx(f), 'utf8');

/** Corre el wrapper y devuelve las filas indexadas por id de caso. */
function run(rawFile, suiteFile, engine) {
  const suite = suiteOf(suiteFile);
  const norm = normalize(rawOf(rawFile), engine);
  const rows = evaluate(norm.cases, suite.cases, { engine });
  return { rows, byId: Object.fromEntries(rows.map((r) => [r.id, r])), norm };
}

const checkOf = (row, name) => row.checks.find((c) => c.name.startsWith(name));

// ---------------------------------------------------------------------------
describe('BUG 4 — el veredicto de customEvaluations no se calculaba (2026-08-13)', () => {
  /**
   * Medido contra una corrida real de Bici_Store v3: la aserción de contenido
   * entraba al CENSO (declaré 1, volvió 1) pero su resultado no lo miraba
   * nadie. Con el literal esperado cambiado por uno falso, el caso seguía
   * dando PASSED y el proceso exit 0.
   *
   * Es el falso negativo más caro posible: rompe justo la verificación de
   * contenido determinista, que es lo único que distingue este enfoque de una
   * mera verificación de ruteo.
   */
  const evalDe = (id, actual, expected) => ({
    key: id, actual, expected, isPass: actual === expected,
  });
  const casoCon = (esperado) => ({
    id: 'C1',
    expect: { topic: 'Faq' },
    customEvaluations: [{
      label: 'literal exacto',
      name: 'string_comparison',
      parameters: [
        { name: 'operator', value: 'equals', isReference: false },
        { name: 'actual', value: '{gs.response.planner_response.x}', isReference: true },
        { name: 'expected', value: esperado, isReference: false },
      ],
    }],
  });
  const corrida = (real) => [{
    topic: 'Faq', invokedActions: [], utilActions: [], evaluations: [evalDe('custom_0', real, null)],
  }];

  test('un literal esperado EQUIVOCADO da FAILED', () => {
    const rows = evaluate(corrida('Abrimos de 9 a 19.'), [casoCon('OTRA COSA')], { engine: 'run-eval' });
    assert.equal(rows[0].verdict, 'FAILED');
    assert.equal(checkOf(rows[0], 'custom').verdict, 'FAIL');
  });

  test('el literal correcto da PASSED', () => {
    const rows = evaluate(corrida('Abrimos de 9 a 19.'), [casoCon('Abrimos de 9 a 19.')], { engine: 'run-eval' });
    assert.equal(rows[0].verdict, 'PASSED');
    assert.equal(checkOf(rows[0], 'custom').verdict, 'PASS');
  });

  test('una referencia que NO resolvió da FAIL, no verde por omisión (D4)', () => {
    const rows = evaluate(corrida('{gs.response.planner_response.x}'), [casoCon('lo que sea')], { engine: 'run-eval' });
    assert.equal(rows[0].verdict, 'FAILED');
    assert.match(checkOf(rows[0], 'custom').detail, /NO resolvió/);
  });

  test('si la evaluación no volvió del motor, el caso NO queda verde', () => {
    const sinEval = [{ topic: 'Faq', invokedActions: [], utilActions: [], evaluations: [] }];
    const rows = evaluate(sinEval, [casoCon('x')], { engine: 'run-eval' });
    assert.equal(rows[0].verdict, 'FAILED');
  });

  test('en test-run se marca SKIP, no PASS: colapsa las repetidas y no se puede aparear', () => {
    const rows = evaluate(corrida('x'), [casoCon('x')], { engine: 'test-run' });
    assert.equal(checkOf(rows[0], 'custom').verdict, 'SKIP');
  });

  test('compareCustom cubre los operadores y avisa cuando no puede', () => {
    assert.equal(compareCustom('equals', 'a', 'a').ok, true);
    assert.equal(compareCustom('equals', 'a', 'b').ok, false);
    assert.equal(compareCustom('contains', 'hola mundo', 'mundo').ok, true);
    assert.equal(compareCustom('not_contains', 'hola', 'chau').ok, true);
    assert.equal(compareCustom('regex_raro', 'a', 'b').comparable, false);
  });

  test('paramOf lee el parámetro declarado', () => {
    assert.equal(paramOf(casoCon('X').customEvaluations[0], 'expected'), 'X');
    assert.equal(paramOf(casoCon('X').customEvaluations[0], 'operator'), 'equals');
  });
});

// ---------------------------------------------------------------------------
describe('BUG 1 — los nombres de acción de `test run` vienen HTML-escapados', () => {
  test('R1 pasa: topic y acción correctos, aunque el motor los devuelva con &#39;', () => {
    const { byId } = run('test-run-c2.json', 'routing.cases.yaml', 'test-run');

    // El crudo trae:  actionsSequence: "[&#39;AGENTFORCE_Answer_question_with_knowledge&#39;]"
    // Sin des-escapar, el nombre nunca matchea y TODA aserción de acciones
    // sobre este motor es un falso negativo.
    assert.equal(byId.R1.verdict, 'PASSED', 'R1 invocó la acción esperada: el veredicto correcto es PASSED');
    assert.equal(checkOf(byId.R1, 'actions').verdict, 'PASS');
  });

  test('el normalizador deja los nombres limpios, sin entidades HTML', () => {
    const { norm } = run('test-run-c2.json', 'routing.cases.yaml', 'test-run');
    const todas = norm.cases.flatMap((c) => c.invokedActions);
    assert.ok(todas.length > 0, 'el fixture tiene que traer acciones');
    for (const a of todas) {
      assert.ok(!/&#\d+;|&amp;|&quot;/.test(a), `nombre con entidad HTML sin resolver: ${JSON.stringify(a)}`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('BUG 2 — el SKIP de `utilActions` nunca se dispara en `test run`', () => {
  test('utilActions da SKIP, no FAIL, cuando el motor no expone executionHistory', () => {
    const { byId } = run('test-run-c2.json', 'routing.cases.yaml', 'test-run');

    // R7 declara utilActions. `test run` NO expone executionHistory, así que la
    // verificación es imposible: el contrato dice SKIP. El normalizador ponía
    // `[]` y el código chequeaba `== null`, así que reportaba FAIL.
    const c = checkOf(byId.R7, 'utilActions');
    assert.ok(c, 'R7 declara utilActions: tiene que haber un check');
    assert.equal(c.verdict, 'SKIP', 'el motor no puede verificarlo — SKIP, no FAIL');
  });

  test('en `run-eval` sí se verifica de verdad', () => {
    const { byId } = run('run-eval-c2.json', 'routing.cases.yaml', 'run-eval');
    assert.equal(checkOf(byId.R7, 'utilActions').verdict, 'PASS');
  });

  test('un SKIP no puede mover el veredicto del caso', () => {
    const filas = evaluate(
      [{ index: 0, id: 'x', status: 'COMPLETED', topic: 'T', invokedActions: [], utilActions: null, stateVariables: null }],
      [{ id: 'X', expect: { topic: 'T', utilActions: ['algo'] } }],
      { engine: 'test-run' }
    );
    assert.equal(filas[0].verdict, 'PASSED', 'un SKIP es "no verificable", no "falla"');
  });
});

// ---------------------------------------------------------------------------
describe('BUG 3 — apareo por índice cuando `gen-spec` excluye casos', () => {
  // discover.cases.yaml tiene 10 casos; B6 es multi-turno sin captured_agent_turns,
  // así que `gen-spec --engine test-run` lo excluye y el crudo trae 9 resultados.
  // Apareando por índice, B7..B10 se comparan contra B6..B9 y B10 queda MISSING.
  test('cada caso se compara contra SU resultado, no contra el del vecino', () => {
    const { byId } = run('test-run-discover.json', 'discover.cases.yaml', 'test-run');

    // Verdad de referencia del crudo de la Fase B:
    //   B7 → off_topic · B8 → Prompt_Injection · B9 → off_topic · B10 → off_topic
    assert.equal(byId.B7.checks[0].detail.includes('real="off_topic"'), true, 'B7 contra el resultado de B7');
    assert.equal(byId.B8.checks[0].detail.includes('real="Prompt_Injection"'), true, 'B8 contra el resultado de B8');
    assert.equal(byId.B9.checks[0].detail.includes('real="off_topic"'), true, 'B9 contra el resultado de B9');
  });

  test('el caso excluido del motor se reporta SKIPPED, no MISSING', () => {
    const { byId } = run('test-run-discover.json', 'discover.cases.yaml', 'test-run');
    assert.equal(byId.B6.verdict, 'SKIPPED', 'B6 es multi-turno sin turnos capturados: no se envió a este motor');
  });

  test('ningún caso queda MISSING por desalineo', () => {
    const { rows } = run('test-run-discover.json', 'discover.cases.yaml', 'test-run');
    assert.deepEqual(rows.filter((r) => r.verdict === 'MISSING').map((r) => r.id), []);
  });
});

// ---------------------------------------------------------------------------
describe('regresión — el camino de `run-eval` sigue bien', () => {
  test('los veredictos de la suite de ruteo son los contrastados en C.2', () => {
    const { byId } = run('run-eval-c2.json', 'routing.cases.yaml', 'run-eval');
    const esperado = {
      R1: 'PASSED', R2: 'PASSED', R3: 'PASSED', R4: 'FAILED', R5: 'FAILED', R6: 'PASSED',
      R7: 'PASSED', R8: 'PASSED', R9: 'PASSED', R10: 'PASSED', R11: 'PASSED', R12: 'PASSED',
    };
    for (const [id, v] of Object.entries(esperado)) assert.equal(byId[id].verdict, v, `caso ${id}`);
  });

  test('el wrapper corrige D6: el motor da falso negativo con el nombre correcto', () => {
    const { byId } = run('run-eval-c2.json', 'routing.cases.yaml', 'run-eval');
    assert.equal(checkOf(byId.R1, 'actions').verdict, 'PASS');
    assert.equal(checkOf(byId.R7, 'actions').verdict, 'PASS');
  });

  test('el wrapper corrige D7: `FAQ` no pasa por ser substring de `GeneralFAQ`', () => {
    const { byId } = run('run-eval-c2.json', 'routing.cases.yaml', 'run-eval');
    assert.equal(byId.R5.verdict, 'FAILED');
  });

  test('la versión servida se lee y es única', () => {
    const { norm } = run('run-eval-c2.json', 'routing.cases.yaml', 'run-eval');
    assert.equal(norm.version.botVersionId, '0X9O30000004h1ZKAQ');
    assert.equal(norm.version.consistent, true);
  });
});

// ---------------------------------------------------------------------------
describe('matchTopic — el literal de escalación', () => {
  test('`human` con contains pasa contra los tres literales observados', () => {
    for (const real of ['human', 'human__', '__human__']) {
      assert.equal(matchTopic(real, 'human', 'contains'), true, real);
    }
  });

  test('con igualdad exacta sólo pasa el literal corto — por eso la regla es contingente', () => {
    assert.equal(matchTopic('human', 'human', 'exact'), true);
    assert.equal(matchTopic('__human__', 'human', 'exact'), false);
  });
});

// ---------------------------------------------------------------------------
/**
 * El gate de versión — la regla #1 de `CLAUDE.md`.
 *
 * POR QUÉ ESTÁ ACÁ. Hasta 2026-08-12 `--expect-version` era opcional y su
 * ausencia era SILENCIOSA: el informe imprimía la versión leída de la corrida y
 * salía 0, indistinguible de un resultado verificado contra la activa.
 *
 * Leer la versión NO es verificarla. `run-eval` resuelve por número más alto sin
 * filtrar por `Status`, así que sin contraste queda abierto exactamente el
 * agujero de D1: se mide una versión que ningún usuario alcanza y nada falla.
 */
describe('gate de versión — no puede ser opt-in (regla #1)', () => {
  const filas = () => run('run-eval-c2.json', 'routing.cases.yaml', 'run-eval');

  /** Captura stdout de `report()` sin ensuciar la salida de los tests. */
  const capturar = (opts) => {
    const { rows, norm } = filas();
    const original = console.log;
    const out = [];
    console.log = (...a) => out.push(a.join(' '));
    try {
      const rc = report(rows, { version: norm.version, engine: 'run-eval', ...opts });
      return { rc, texto: out.join('\n') };
    } finally {
      console.log = original;
    }
  };

  test('sin --expect-version avisa que NO es auditable y sale 1', () => {
    const { rc, texto } = capturar({});
    assert.match(texto, /SIN GATE DE VERSIÓN/);
    assert.match(texto, /NO es auditable/);
    assert.equal(rc, 1, 'un resultado no auditable no puede salir verde');
  });

  test('la versión leída de la corrida NO alcanza para dar por cumplida la regla', () => {
    const { norm } = filas();
    assert.equal(norm.version.botVersionId, '0X9O30000004h1ZKAQ', 'la versión SÍ se lee');
    const { texto } = capturar({});
    assert.match(texto, /versión testeada: v29/, 'y se imprime');
    assert.match(texto, /NO se contrastó contra la activa/, 'pero se dice que no se verificó');
  });

  test('con --expect-version correcto, no hay aviso', () => {
    const { texto } = capturar({ expectVersion: '0X9O30000004h1ZKAQ' });
    assert.equal(/SIN GATE DE VERSIÓN/.test(texto), false);
  });

  test('con --expect-version distinto, aborta', () => {
    const { rc, texto } = capturar({ expectVersion: '0X9OTRAVERSION0000' });
    assert.match(texto, /VERSIÓN INESPERADA/);
    assert.equal(rc, 1);
  });

  test('--no-version-check deja constancia en la salida, no la borra', () => {
    const { texto } = capturar({ skipVersionCheck: true });
    assert.equal(/SIN GATE DE VERSIÓN/.test(texto), false, 'el escape suprime el error');
    assert.match(texto, /gate de versión OMITIDO a pedido/, 'pero deja rastro');
    assert.match(texto, /No usarlo como evidencia/);
  });

  test('en `test-run` NO se exige el gate: ese motor no puede cumplirlo', () => {
    const { rows, norm } = run('test-run-c2.json', 'routing.cases.yaml', 'test-run');
    const original = console.log;
    const out = [];
    console.log = (...a) => out.push(a.join(' '));
    try {
      report(rows, { version: norm.version, engine: 'test-run' });
    } finally {
      console.log = original;
    }
    const texto = out.join('\n');
    assert.equal(/SIN GATE DE VERSIÓN/.test(texto), false, 'pedirle el gate a test-run sería ruido');
    assert.match(texto, /VERSIÓN: NO DISPONIBLE/, 'lo que corresponde es decir que no se puede saber');
  });
});
