/**
 * Tests del censo de aserciones — la defensa contra D3.
 *
 * Hay CUATRO mecanismos por los que una aserción no se ejecuta sin que se vea en
 * los veredictos. Dos de ellos tienen la misma firma y uno no deja rastro
 * alguno. El censo no los distingue **a propósito**: sólo dice cuántas faltan y
 * cuáles.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { normalize, census, declaredEvaluations } from '../lib/assert.mjs';

const FX = path.resolve(import.meta.dirname, 'fixtures');
const fx = (f) => path.join(FX, f);
const suiteOf = (f) => YAML.parse(fs.readFileSync(fx(f), 'utf8'));

function censar(rawFile, suiteFile, engine) {
  const suite = suiteOf(suiteFile);
  const norm = normalize(fs.readFileSync(fx(rawFile), 'utf8'), engine);
  return { c: census(norm.cases, suite.cases, engine), suite };
}

describe('qué se declara', () => {
  test('`expectedActions: []` NO cuenta como declarada — el traductor no la emite (D5)', () => {
    const vacia = { id: 'X', expect: { topic: 'T', actions: [] } };
    assert.deepEqual(declaredEvaluations(vacia, 'run-eval'), ['check_topic']);
  });

  test('una lista de acciones no vacía sí cuenta', () => {
    const k = { id: 'X', expect: { topic: 'T', actions: ['a'] } };
    assert.deepEqual(declaredEvaluations(k, 'run-eval'), ['check_topic', 'check_actions']);
  });

  test('cada customEvaluation cuenta por separado', () => {
    const k = { id: 'X', expect: { topic: 'T' }, customEvaluations: [{ name: 'string_comparison' }, { name: 'string_comparison' }] };
    assert.deepEqual(declaredEvaluations(k, 'run-eval'), ['check_topic', 'custom_0', 'custom_1']);
    assert.deepEqual(declaredEvaluations(k, 'test-run'), ['topic_assertion', 'string_comparison', 'string_comparison']);
  });
});

describe('sobre corridas reales', () => {
  test('la suite de ruteo por `run-eval` no tiene aserciones faltantes', () => {
    const { c } = censar('run-eval-c2.json', 'routing.cases.yaml', 'run-eval');
    assert.equal(c.totalMissing, 0, `faltan: ${JSON.stringify(c.filas.filter((f) => f.missing.length))}`);
    assert.ok(c.totalDeclared > 0);
  });

  test('el censo no se desalinea cuando `gen-spec` excluye un caso', () => {
    const { c } = censar('test-run-discover.json', 'discover.cases.yaml', 'test-run');
    // 10 casos, uno multi-turno excluido → el censo cubre 9
    assert.equal(c.filas.length, 9);
    assert.equal(c.filas.some((f) => f.id === 'B6'), false, 'B6 no se envió: no se censa');
  });
});

describe('detecta las que no se ejecutaron', () => {
  const caso = (evaluaciones) => [{ index: 0, id: 'case_0', evaluations: evaluaciones }];

  test('declaré 5 custom y volvió 1 → faltan 4 (el 4º mecanismo, el que no deja rastro)', () => {
    const suite = [{
      id: 'C1',
      expect: { topic: 'human' },
      customEvaluations: Array.from({ length: 5 }, () => ({ name: 'string_comparison' })),
    }];
    const c = census(caso([{ key: 'topic_assertion', actual: 'human' }, { key: 'string_comparison', actual: 'ok' }]), suite, 'test-run');
    assert.equal(c.totalDeclared, 6);
    assert.equal(c.totalReturned, 2);
    assert.equal(c.totalMissing, 4);
    assert.deepEqual(c.filas[0].missing, ['string_comparison', 'string_comparison', 'string_comparison', 'string_comparison']);
  });

  test('una evaluación que desaparece se cuenta, sin inventar la causa', () => {
    const suite = [{ id: 'C2', expect: { topic: 'human' }, customEvaluations: [{ name: 'string_comparison' }] }];
    const c = census(caso([{ key: 'check_topic', actual: 'human__' }]), suite, 'run-eval');
    assert.equal(c.totalMissing, 1);
    assert.deepEqual(c.filas[0].missing, ['custom_0']);
    // el censo NO dice si fue ruta rechazada o error de tipo: tienen la misma firma
    assert.equal('causa' in c.filas[0], false);
  });
});

describe('el detector determinista de refs sin resolver', () => {
  test('marca el template literal como no resuelto', () => {
    const suite = [{ id: 'C3', expect: { topic: 'T' }, customEvaluations: [{ name: 'string_comparison' }] }];
    const cases = [{
      index: 0,
      evaluations: [
        { key: 'check_topic', actual: 'T' },
        { key: 'custom_0', actual: '{gs.response.planner_response.sessionContext.stateVariables.surveyStage}' },
      ],
    }];
    const c = census(cases, suite, 'run-eval');
    assert.equal(c.totalMissing, 0, 'la evaluación SÍ corrió');
    assert.equal(c.totalUnresolved, 1, 'pero la referencia no resolvió');
    assert.deepEqual(c.filas[0].unresolved, ['custom_0']);
  });

  test('un valor normal no se marca', () => {
    const suite = [{ id: 'C4', expect: { topic: 'T' } }];
    const c = census([{ index: 0, evaluations: [{ key: 'check_topic', actual: 'GeneralFAQ' }] }], suite, 'run-eval');
    assert.equal(c.totalUnresolved, 0);
  });
});
