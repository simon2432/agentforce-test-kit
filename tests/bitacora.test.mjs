/**
 * Tests de `lib/bitacora.mjs`.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * La bitácora es el artefacto que un auditor va a leer primero, y **la mitad de
 * su contenido lo escribe el mismo que hizo el trabajo**. Eso la convierte en la
 * pieza con peor relación entre autoridad aparente y evidencia real de todo el
 * repo.
 *
 * Lo único que la salva es que la otra mitad sea derivable y verificable. Estos
 * tests cubren exactamente eso:
 *
 *   1. que la capa derivada salga de los artefactos y no de lo que se le pase;
 *   2. que `--verificar` detecte las tres formas de romper el rastro:
 *      artefacto alterado, corrida sin registrar, y entrada borrada.
 *
 * Si (2) fallara, la bitácora sería una narración con formato de auditoría.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { derivar, registrar, verificar, entradaBitacora, resumenDeCorrida, ahora } from '../lib/bitacora.mjs';

const FX = path.resolve(import.meta.dirname, 'fixtures');
let TMP;

/** Arma una corrida realista en un temporal, con los fixtures reales. */
function corrida(nombre = '2026-08-12-1000-ruteo') {
  const dir = path.join(TMP, 'agents', 'demo', 'runs', nombre);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FX, 'run-eval-c2.json'), path.join(dir, 'raw.json'));
  return dir;
}
const suite = () => path.join(FX, 'routing.cases.yaml');
const agenteDir = () => path.join(TMP, 'agents', 'demo');

before(() => { TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bitacora-')); });
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
describe('capa derivada — sale de los artefactos, no de lo que le digan', () => {
  test('la versión del agente se lee del crudo, no se recibe por parámetro', () => {
    const d = derivar(corrida('v-1'), { suitePath: suite() });
    assert.equal(d.version.botVersionId, '0X9O30000004h1ZKAQ');
    assert.equal(d.version.auditable, true);
  });

  test('los veredictos se recalculan: no se copian de la CLI', () => {
    const d = derivar(corrida('v-2'), { suitePath: suite() });
    // Verdad de referencia de fixtures/README.md: R4 y R5 fallan de verdad.
    assert.equal(d.resultado.passed, 10);
    assert.equal(d.resultado.failed, 2);
    const fallados = d.filas.filter((f) => f.verdict === 'FAILED').map((f) => f.id);
    assert.deepEqual(fallados.sort(), ['R4', 'R5']);
  });

  test('sin suite se archiva el crudo pero NO se inventa un resultado', () => {
    const d = derivar(corrida('v-3'));
    assert.equal(d.resultado, null);
    const md = resumenDeCorrida(d);
    assert.match(md, /no se evaluó nada/);
  });

  test('cada artefacto lleva su sha256', () => {
    const d = derivar(corrida('v-4'), { suitePath: suite() });
    const raw = d.artefactos.find((a) => a.archivo === 'raw.json');
    assert.match(raw.sha256, /^[0-9a-f]{64}$/);
  });

  test('la marca de tiempo lleva zona horaria: sin offset no es auditable', () => {
    assert.match(ahora(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  test('sin raw.json no deriva nada — no hay de dónde', () => {
    const vacio = path.join(TMP, 'vacio');
    fs.mkdirSync(vacio, { recursive: true });
    assert.throws(() => derivar(vacio), /raw\.json/);
  });
});

// ---------------------------------------------------------------------------
describe('las dos capas están separadas y marcadas', () => {
  test('la narrada se declara auto-reportada, no evidencia', () => {
    const d = derivar(corrida('c-1'), { suitePath: suite() });
    const e = entradaBitacora(d, { nota: 'salió todo perfecto', proposito: 'ruteo' });
    assert.match(e, /Derivado de los artefactos/);
    assert.match(e, /auto-reportado, no es evidencia/);
    // y la nota queda DEBAJO de esa advertencia, no arriba
    assert.ok(e.indexOf('auto-reportado') < e.indexOf('salió todo perfecto'));
  });

  test('sin nota no se inventa una narración', () => {
    const d = derivar(corrida('c-2'), { suitePath: suite() });
    assert.match(entradaBitacora(d), /_\(sin nota\)_/);
  });

  test('🚨 una corrida sin versión verificable lo dice en la entrada', () => {
    const dir = corrida('c-3');
    fs.copyFileSync(path.join(FX, 'test-run-c2.json'), path.join(dir, 'raw.json'));
    const d = derivar(dir, { suitePath: suite(), engine: 'test-run' });
    assert.equal(d.version.auditable, false);
    assert.match(entradaBitacora(d), /NO es auditable en el eje de versión/);
  });
});

// ---------------------------------------------------------------------------
describe('RESUMEN.md — qué se testeó y qué dio', () => {
  const md = () => resumenDeCorrida(derivar(corrida('r-1'), { suitePath: suite() }));

  test('lista los casos uno por uno con su veredicto', () => {
    const m = md();
    for (const id of ['R1', 'R4', 'R7', 'R12']) assert.match(m, new RegExp(`\\| ${id}`));
    assert.match(m, /10 passed · 2 failed/);
  });

  test('separa lo verificado de lo NO verificado, y explica por qué importa', () => {
    const m = md();
    assert.match(m, /Se verificó \| NO se verificó/);
    assert.match(m, /un `SKIP` no es un acierto/);
  });

  test('marca los casos de seguridad aparte', () => {
    assert.match(md(), /R11 🛡/);
  });
});

// ---------------------------------------------------------------------------
describe('🚨 verificar — el control que hace que la bitácora valga algo', () => {
  test('una corrida recién registrada verifica limpio', () => {
    const dir = corrida('ok-1');
    registrar(dir, { suitePath: suite(), nota: 'x', agenteDir: agenteDir() });
    const v = verificar(agenteDir());
    assert.deepEqual(v.hallazgos.filter((h) => h.corrida === 'ok-1'), []);
  });

  test('detecta un artefacto ALTERADO después de registrarse', () => {
    const dir = corrida('tamper-1');
    registrar(dir, { suitePath: suite(), nota: 'x', agenteDir: agenteDir() });
    fs.appendFileSync(path.join(dir, 'raw.json'), ' ');
    const h = verificar(agenteDir()).hallazgos.filter((x) => x.corrida === 'tamper-1');
    assert.equal(h.length, 1);
    assert.equal(h[0].tipo, 'artefacto-alterado');
  });

  test('detecta un artefacto BORRADO', () => {
    const dir = corrida('tamper-2');
    registrar(dir, { suitePath: suite(), nota: 'x', agenteDir: agenteDir() });
    fs.unlinkSync(path.join(dir, 'raw.json'));
    const h = verificar(agenteDir()).hallazgos.filter((x) => x.corrida === 'tamper-2');
    assert.ok(h.some((x) => x.tipo === 'artefacto-faltante'));
  });

  test('🚨 detecta una corrida que NUNCA se registró — el control contra el olvido', () => {
    corrida('fantasma');   // existe en disco, jamás pasó por registrar()
    const h = verificar(agenteDir()).hallazgos.filter((x) => x.corrida === 'fantasma');
    assert.equal(h[0].tipo, 'sin-registrar');
  });

  test('detecta que alguien borró la entrada de la bitácora', () => {
    const dir = corrida('huerfana');
    registrar(dir, { suitePath: suite(), nota: 'x', agenteDir: agenteDir() });
    const bit = path.join(agenteDir(), 'BITACORA.md');
    fs.writeFileSync(bit, fs.readFileSync(bit, 'utf8').replace(/runs\/huerfana/g, 'runs/otra-cosa'));
    const h = verificar(agenteDir()).hallazgos.filter((x) => x.corrida === 'huerfana');
    assert.ok(h.some((x) => x.tipo === 'sin-entrada'));
  });

  test('el manifiesto NO se hashea a sí mismo: si no, nunca verificaría', () => {
    const dir = corrida('self-1');
    const r = registrar(dir, { suitePath: suite(), nota: 'x', agenteDir: agenteDir() });
    const nombres = r.derivado.artefactos.map((a) => a.archivo);
    assert.equal(nombres.includes('manifiesto.json'), false);
    assert.equal(nombres.includes('RESUMEN.md'), true, 'pero SÍ cubre el resumen: editarlo se detecta');
  });

  test('la bitácora es append-only: registrar dos veces no pisa la primera', () => {
    registrar(corrida('append-1'), { suitePath: suite(), nota: 'primera', agenteDir: agenteDir() });
    registrar(corrida('append-2'), { suitePath: suite(), nota: 'segunda', agenteDir: agenteDir() });
    const bit = fs.readFileSync(path.join(agenteDir(), 'BITACORA.md'), 'utf8');
    assert.match(bit, /primera/);
    assert.match(bit, /segunda/);
  });
});
