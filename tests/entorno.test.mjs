/**
 * Tests del centinela de descubrimiento, del chequeo de instalación y del
 * registro de versión de la herramienta.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { toRunEval, toTestRun, sentToEngine, DISCOVERY_SENTINEL } from '../lib/gen-spec.mjs';
import { checkSkills, checkLib } from '../lib/doctor.mjs';
import { pluginCopiesOnDisk } from '../lib/tooling.mjs';

const FX = path.resolve(import.meta.dirname, 'fixtures');
const suiteOf = (f) => YAML.parse(fs.readFileSync(path.join(FX, f), 'utf8'));

// ---------------------------------------------------------------------------
describe('el centinela de descubrimiento', () => {
  const suite = {
    suite: 'X',
    cases: [
      { id: 'A', utterance: 'hola' },                                       // sin `expect`
      { id: 'B', utterance: 'chau', expect: { topic: 'Faq', actions: ['x'] } },
    ],
  };

  test('sin --discover, un caso sin `expect` no lleva expectedTopic — y no devolvería vocabulario', () => {
    const spec = toRunEval(suite, 'Ag');
    assert.equal(spec.testCases[0].expectedTopic, undefined);
  });

  test('con --discover, TODOS los casos llevan el centinela', () => {
    const spec = toRunEval(suite, 'Ag', { discover: true });
    for (const tc of spec.testCases) assert.equal(tc.expectedTopic, DISCOVERY_SENTINEL);
  });

  test('el centinela no puede pasar por accidente con el operador `contains`', () => {
    // run-eval compara con `contains`: el centinela tiene que ser imposible de
    // contener en cualquier topic real.
    for (const real of ['GeneralFAQ', 'off_topic', '__human__', 'Prompt_Injection', 'SaveSurvey']) {
      assert.equal(real.includes(DISCOVERY_SENTINEL), false, real);
    }
  });

  test('descarta acciones y customEvaluations: en descubrimiento no se asserta nada más', () => {
    const spec = toRunEval(suite, 'Ag', { discover: true });
    assert.equal(spec.testCases[1].expectedActions, undefined);
    const tr = toTestRun(suite, 'Ag', { discover: true });
    assert.equal(tr.testCases[1].expectedActions, undefined);
  });

  test('funciona igual en los dos motores', () => {
    for (const spec of [toRunEval(suite, 'Ag', { discover: true }), toTestRun(suite, 'Ag', { discover: true })]) {
      assert.equal(spec.testCases.length, 2);
      for (const tc of spec.testCases) assert.equal(tc.expectedTopic, DISCOVERY_SENTINEL);
    }
  });
});

// ---------------------------------------------------------------------------
describe('sentToEngine — fuente única de la exclusión', () => {
  test('un multi-turno sin turnos capturados no va a `test run`, pero sí a `run-eval`', () => {
    const k = { id: 'B6', turns: ['hola'] };
    assert.equal(sentToEngine(k, 'test-run'), false);
    assert.equal(sentToEngine(k, 'run-eval'), true);
  });

  test('con turnos capturados sí va a los dos', () => {
    const k = { id: 'B6', turns: ['hola'], captured_agent_turns: [{ message: 'buenas' }] };
    assert.equal(sentToEngine(k, 'test-run'), true);
  });

  test('`engines:` explícito manda', () => {
    assert.equal(sentToEngine({ id: 'X', engines: ['run-eval'] }, 'test-run'), false);
    assert.equal(sentToEngine({ id: 'X', engines: ['run-eval'] }, 'run-eval'), true);
  });

  test('coincide con lo que el generador realmente emite', () => {
    const suite = suiteOf('discover.cases.yaml');
    const emitidos = toTestRun(suite, 'Ag').testCases.length;
    const previstos = suite.cases.filter((k) => sentToEngine(k, 'test-run')).length;
    assert.equal(emitidos, previstos, 'si divergen, `assert.mjs` se desalinea en silencio');
  });
});

// ---------------------------------------------------------------------------
describe('chequeo de instalación', () => {
  test('detecta una carpeta de skill sin SKILL.md', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
    const skills = path.join(tmp, '.claude', 'skills');
    fs.mkdirSync(path.join(skills, 'buena'), { recursive: true });
    fs.writeFileSync(path.join(skills, 'buena', 'SKILL.md'), '# ok');
    // el modo de falla real: la carpeta y sus assets están, el SKILL.md no
    fs.mkdirSync(path.join(skills, 'truncada', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(skills, 'truncada', 'assets', 'x.md'), 'data');

    const r = checkSkills(tmp);
    assert.equal(r.total, 2);
    assert.deepEqual(r.roto, ['truncada']);
    assert.deepEqual(r.ok, ['buena']);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('un SKILL.md vacío también cuenta como roto', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
    fs.mkdirSync(path.join(tmp, '.claude', 'skills', 's'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', 'skills', 's', 'SKILL.md'), '');
    assert.deepEqual(checkSkills(tmp).roto, ['s']);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('sin `.claude/skills/` no falla: informa que no hay nada que verificar', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
    const r = checkSkills(tmp);
    assert.equal(r.presente, false);
    assert.deepEqual(r.roto, []);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('este repo tiene sus skills completas y su lib entera', () => {
    const r = checkSkills();
    assert.deepEqual(r.roto, [], `skills sin SKILL.md: ${r.roto.join(', ')}`);
    assert.deepEqual(checkLib().falta, []);
  });
});

// ---------------------------------------------------------------------------
describe('versión de la herramienta', () => {
  test('las copias en disco se listan con su ruta, para poder desambiguar', () => {
    const copias = pluginCopiesOnDisk();
    for (const c of copias) {
      assert.ok(c.version, 'cada copia tiene versión');
      assert.ok(path.isAbsolute(c.path), 'y ruta absoluta, que es lo que permite ver cuál es la obsoleta');
    }
  });
});
