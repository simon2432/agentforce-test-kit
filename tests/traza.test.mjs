/**
 * Tests de `lib/traza.mjs` y del bug de multi-turno de `lib/extract.mjs`.
 *
 * La traza es una VISTA, no un veredicto — pero es la vista que alguien va a
 * mirar para entender qué hizo el agente. Una vista que muestra el turno
 * equivocado es peor que no tenerla: da una conversación coherente y falsa.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { measuredMessage, historyMessages, extract } from '../lib/extract.mjs';
import { construir, leerSpec, celda, corto, coincidencia, unaLinea, limpio } from '../lib/traza.mjs';

/** Un caso multi-turno tal como lo devuelve `run-eval`. */
const testMultiTurno = {
  outputs: [
    { type: 'agent.create_session', id: 'cs', session_id: 'abc' },
    { type: 'agent.send_message', id: 'history_0', response: 'RESPUESTA AL TURNO 1', duration_ms: 1000 },
    { type: 'agent.send_message', id: 'sm', response: 'RESPUESTA AL TURNO MEDIDO', duration_ms: 2000 },
    {
      type: 'agent.get_state',
      id: 'gs',
      response: {
        planner_response: {
          lastExecution: { topic: 'Encuesta', invokedActions: [] },
          sessionContext: {
            tags: { bot_version_id: '0X9v3', version_api_name: 'v3', planner_name: 'p' },
            stateVariables: { encuestaNota: '5' },
            contextVariables: { RoutableId: null },
            executionHistory: [],
          },
        },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
describe('BUG multi-turno — se mostraba la respuesta del PRIMER turno (2026-08-13)', () => {
  test('measuredMessage devuelve el turno medido, no el primero', () => {
    assert.equal(measuredMessage(testMultiTurno).response, 'RESPUESTA AL TURNO MEDIDO');
  });

  test('si no hay `sm`, cae al último send_message', () => {
    const sinSm = { outputs: [
      { type: 'agent.send_message', id: 'history_0', response: 'A' },
      { type: 'agent.send_message', id: 'history_1', response: 'B' },
    ] };
    assert.equal(measuredMessage(sinSm).response, 'B');
  });

  test('historyMessages devuelve los previos en orden, sin el medido', () => {
    assert.deepEqual(historyMessages(testMultiTurno), ['RESPUESTA AL TURNO 1']);
  });

  test('extract() usa el turno medido para response y durationMs', () => {
    const ev = extract(JSON.stringify({ result: { tests: [testMultiTurno] } }));
    assert.equal(ev.cases[0].response, 'RESPUESTA AL TURNO MEDIDO');
    assert.equal(ev.cases[0].durationMs, 2000);
    assert.deepEqual(ev.cases[0].historyResponses, ['RESPUESTA AL TURNO 1']);
  });

  test('un caso de un solo turno no se ve afectado', () => {
    const simple = { outputs: [
      { type: 'agent.send_message', id: 'sm', response: 'UNICA', duration_ms: 10 },
      { type: 'agent.get_state', id: 'gs', response: { planner_response: { lastExecution: { topic: 'Faq' }, sessionContext: {} } } },
    ] };
    const ev = extract(JSON.stringify({ result: { tests: [simple] } }));
    assert.equal(ev.cases[0].response, 'UNICA');
    assert.deepEqual(ev.cases[0].historyResponses, []);
  });
});

// ---------------------------------------------------------------------------
describe('leerSpec — «lo enviado» sale del spec, que es inmutable', () => {
  const spec = `
name: s
testCases:
  - utterance: hola
    expectedTopic: Faq
    expectedActions: [consultar_faq]
  - conversationHistory:
      - role: user
        message: previo
    utterance: "5"
    expectedTopic: Encuesta
    customEvaluations:
      - label: nota guardada
        name: string_comparison
        parameters:
          - { name: operator, value: equals }
          - { name: actual, value: "{gs.x}" }
          - { name: expected, value: "5" }
`;

  test('lee utterance, esperados y turnos previos', () => {
    const filas = leerSpec(spec);
    assert.equal(filas[0].utterance, 'hola');
    assert.equal(filas[0].expectedTopic, 'Faq');
    assert.deepEqual(filas[0].expectedActions, ['consultar_faq']);
    assert.deepEqual(filas[1].turnosPrevios, ['previo']);
  });

  test('desarma los parámetros de una customEvaluation', () => {
    const ce = leerSpec(spec)[1].customEvaluations[0];
    assert.equal(ce.operator, 'equals');
    assert.equal(ce.expected, '5');
    assert.equal(ce.actual, '{gs.x}');
  });

  test('sin spec devuelve null — la traza lo declara en vez de inventarlo', () => {
    assert.equal(leerSpec(null), null);
  });
});

// ---------------------------------------------------------------------------
describe('construir — la vista', () => {
  const ev = extract(JSON.stringify({ result: { tests: [testMultiTurno] } }));

  test('sin --spec, avisa que lo esperado no se puede afirmar', () => {
    const md = construir({ corridas: [{ archivo: 'r.json', ev }] });
    assert.match(md, /Sin `--spec`/);
  });

  test('la fila macro trae topic y la respuesta del turno medido', () => {
    const md = construir({ corridas: [{ archivo: 'r.json', ev }] });
    assert.match(md, /Encuesta/);
    assert.match(md, /RESPUESTA AL TURNO MEDIDO/);
  });

  test('la vista simple NO vuelca las variables — para eso está el crudo', () => {
    const md = construir({ corridas: [{ archivo: 'r.json', ev }] });
    assert.doesNotMatch(md, /razón estructural/);
    assert.doesNotMatch(md, /## Detalle/);
  });

  test('con --detalle sí aparecen, y marca las contextVariables en NULL', () => {
    const md = construir({ corridas: [{ archivo: 'r.json', ev }], detalle: true });
    assert.match(md, /razón estructural/);
    assert.match(md, /## Detalle/);
  });

  /**
   * Guarda contra que la traza se vuelva a inflar. Mide el costo POR CASO, no
   * el total: la guía de lectura es fija y no crece con la suite, así que un
   * umbral sobre el total castigaría explicaciones que se pagan una sola vez.
   */
  test('cada caso agrega pocas líneas — la traza no se vuelve a inflar', () => {
    const uno = extract(JSON.stringify({ result: { tests: [testMultiTurno] } }));
    const dos = extract(JSON.stringify({ result: { tests: [testMultiTurno, testMultiTurno] } }));
    const n1 = construir({ corridas: [{ archivo: 'r', ev: uno }] }).split('\n').length;
    const n2 = construir({ corridas: [{ archivo: 'r', ev: dos }] }).split('\n').length;
    const porCaso = n2 - n1;
    assert.ok(porCaso <= 14, `cada caso cuesta ${porCaso} líneas; el techo es 14`);
  });

  test('con varias corridas compara estabilidad y detecta divergencia', () => {
    const otro = structuredClone(testMultiTurno);
    otro.outputs[3].response.planner_response.lastExecution.topic = 'Faq';
    const ev2 = extract(JSON.stringify({ result: { tests: [otro] } }));
    const md = construir({ corridas: [{ archivo: 'a', ev }, { archivo: 'b', ev: ev2 }] });
    assert.match(md, /Estabilidad entre corridas/);
    assert.match(md, /1 línea\(s\) inestables/);
    // Y muestra los dos topics divergentes, no sólo el conteo.
    assert.match(md, /Encuesta ⟂ Faq/);
  });

  test('si todo es estable, sólo informa el total: sin tabla de ruido', () => {
    const ev2 = extract(JSON.stringify({ result: { tests: [testMultiTurno] } }));
    const md = construir({ corridas: [{ archivo: 'a', ev }, { archivo: 'b', ev: ev2 }] });
    assert.match(md, /2\/2 observaciones idénticas/);
    assert.doesNotMatch(md, /inestables/);
  });

  test('una corrida sin versión se marca como no auditable', () => {
    const sinVer = structuredClone(testMultiTurno);
    delete sinVer.outputs[3].response.planner_response.sessionContext.tags;
    const evSV = extract(JSON.stringify({ result: { tests: [sinVer] } }));
    const md = construir({ corridas: [{ archivo: 'x', ev: evSV }] });
    assert.match(md, /no expone la versión/);
  });
});

// ---------------------------------------------------------------------------
describe('coincidencia spec-vs-crudo — el indicador inmune a la deriva de suite', () => {
  test('idéntico da ✔ y distinto da ✘', () => {
    assert.equal(coincidencia('Faq', 'Faq'), '✔');
    assert.equal(coincidencia('Faq', 'Escalar'), '✘');
  });

  test('una SUBCADENA da ≈ — pasa en run-eval por su comparación contains', () => {
    assert.equal(coincidencia('FAQ', 'GeneralFAQ'), '≈');
  });

  test('el centinela de descubrimiento se marca aparte: falla por diseño', () => {
    assert.equal(coincidencia('__DISCOVERY__', 'Faq'), '🔍');
  });

  test('sin esperado no hay indicador', () => {
    assert.equal(coincidencia(null, 'Faq'), null);
  });

  /**
   * El caso que motivó todo: la suite se editó DESPUÉS de la corrida, así que
   * el veredicto recalculado da verde mientras el spec archivado muestra que
   * se mandó esperando otra cosa.
   */
  test('detecta la deriva: veredicto PASSED pero el spec esperaba otro topic', () => {
    const ev = extract(JSON.stringify({ result: { tests: [testMultiTurno] } }));
    const spec = 'name: s\ntestCases:\n  - utterance: x\n    expectedTopic: OtraCosa\n';
    const md = construir({
      corridas: [{ archivo: 'r', ev, veredictos: [{ id: 'S03', verdict: 'PASSED', checks: [] }] }],
      enviado: leerSpec(spec),
    });
    assert.match(md, /Deriva de suite/);
    assert.match(md, /🚩/);
    assert.match(md, /OtraCosa/);
  });

  test('sin deriva no aparece la sección', () => {
    const ev = extract(JSON.stringify({ result: { tests: [testMultiTurno] } }));
    const spec = 'name: s\ntestCases:\n  - utterance: x\n    expectedTopic: Encuesta\n';
    const md = construir({
      corridas: [{ archivo: 'r', ev, veredictos: [{ id: 'E1', verdict: 'PASSED', checks: [] }] }],
      enviado: leerSpec(spec),
    });
    assert.doesNotMatch(md, /Deriva de suite/);
  });
});

// ---------------------------------------------------------------------------
describe('unaLinea — el input/output de una acción, sin ruido', () => {
  test('saca las claves internas del runtime', () => {
    assert.deepEqual(limpio({ __action_execution_status__: 'success', respuesta: 'ok' }), { respuesta: 'ok' });
  });

  test('con una sola clave devuelve el valor pelado', () => {
    assert.equal(unaLinea({ __x__: 1, respuesta: 'Abrimos de 9 a 19.' }), 'Abrimos de 9 a 19.');
  });

  test('con varias, elige la de texto más largo y la etiqueta', () => {
    const out = unaLinea({ generationId: 'f5ff-808d', promptResponse: 'Conviene engrasar la cadena cada 200 km.' });
    assert.match(out, /^promptResponse: /);
    assert.match(out, /Conviene engrasar/);
  });

  test('sin contenido devuelve null', () => {
    assert.equal(unaLinea({ __solo__: 'interno' }), null);
    assert.equal(unaLinea(null), null);
  });
});

// ---------------------------------------------------------------------------
describe('formato de celdas — una tabla rota no se puede leer', () => {
  test('escapa las barras y aplana los saltos de línea', () => {
    assert.equal(celda('a|b'), 'a\\|b');
    assert.equal(celda('a\nb'), 'a ⏎ b');
  });

  test('los vacíos se muestran como raya, no en blanco', () => {
    assert.equal(celda(null), '—');
    assert.equal(celda(''), '—');
    assert.equal(corto(null), '—');
  });

  test('corto recorta y marca el recorte', () => {
    assert.equal(corto('x'.repeat(80), 10).length, 10);
    assert.match(corto('x'.repeat(80), 10), /…$/);
  });
});
