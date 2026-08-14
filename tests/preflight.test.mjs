/**
 * Tests de `lib/preflight.mjs`.
 *
 * ⚠️ LÍMITE HONESTO DE ESTE ARCHIVO: `sf` está mockeado. Lo que se verifica es
 * la **lógica de decisión** del preflight —qué hace ante cada respuesta— y NO
 * que las consultas sean las correctas contra una org real. Esa mitad sólo se
 * cierra corriéndolo contra una org, y hasta que eso pase el script está en el
 * mismo estado que todo lo marcado INFERIDO en `knowledge/`: razonado sobre el
 * cliente, no observado contra el servidor.
 *
 * Es exactamente la distinción de `00-index.md`: leer el código del cliente
 * alcanza para afirmar qué manda la CLI, no para afirmar qué hace el servidor.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkOrg, checkVersion, preflight, quoteArg, sfJson } from '../lib/preflight.mjs';

const AGENT = {
  apiName: 'MI_Agente',
  org: { alias: 'mi-org', orgId: '00DO300000SGmzpMAD' },
};

/** Mock de `sf`: mapea un fragmento del comando a la respuesta JSON. */
const mockSf = (rutas) => (_cmd, args) => {
  const linea = args.join(' ');
  for (const [frag, resp] of Object.entries(rutas)) {
    if (linea.includes(frag)) return JSON.stringify(resp);
  }
  throw new Error(`comando no mockeado: ${linea}`);
};

const versiones = (recs) => ({ status: 0, result: { records: recs } });
const v = (n, id, status) => ({ Id: id, VersionNumber: n, Status: status });

// ---------------------------------------------------------------------------
describe('entrecomillado de argumentos — el bug que el mock no podía ver', () => {
  /**
   * Regresión del 2026-08-13. Con `shell: true` Node une los argumentos con
   * espacios sin entrecomillar, así que la SOQL de `checkVersion` se partía y
   * `-q` recibía sólo `SELECT`. El preflight lo reportaba como «no hay
   * BotVersion», culpando a la org de un bug del cliente.
   *
   * Los demás tests de este archivo mockean `sf` recibiendo el ARRAY de
   * argumentos, así que por construcción no pueden ver lo que arma el shell.
   * Estos miran la línea, que es donde estaba el defecto.
   */
  test('un argumento con espacios viaja como UN argumento', () => {
    const q = "SELECT Id FROM BotVersion WHERE BotDefinition.DeveloperName = 'X'";
    const citado = quoteArg(q);
    assert.equal(citado.includes(' '), true, 'la consulta conserva sus espacios');
    // Lo que importa: entrecomillado, para que el shell no lo parta.
    assert.match(citado, /^["'].*["']$/);
  });

  test('un argumento simple NO se toca — no ensucia la línea', () => {
    assert.equal(quoteArg('--target-org'), '--target-org');
    assert.equal(quoteArg('OrgAntartida'), 'OrgAntartida');
    assert.equal(quoteArg('data'), 'data');
  });

  test('la SOQL llega entera a la línea del shell', () => {
    let linea = null;
    const exec = (_cmd, args) => {
      linea = args.join(' ');
      return JSON.stringify({ status: 0, result: { records: [] } });
    };
    sfJson(['data', 'query', '-q', 'SELECT Id FROM BotVersion', '--target-org', 'x'], { exec });
    // Antes del fix la línea era `-q SELECT Id FROM BotVersion`, y el shell le
    // pasaba a `-q` solamente `SELECT`.
    assert.match(linea, /-q ["']SELECT Id FROM BotVersion["']/);
  });
});

// ---------------------------------------------------------------------------
describe('guarda de org — el typo de alias que apunta a otro cliente', () => {
  test('si el alias resuelve al Org Id declarado, pasa', () => {
    const exec = mockSf({ 'org display': { status: 0, result: { id: '00DO300000SGmzpMAD' } } });
    const r = checkOrg(AGENT, { exec });
    assert.equal(r.ok, true);
    assert.equal(r.fatal, false);
  });

  test('🚨 si resuelve a OTRA org, es fatal y lo dice sin ambigüedad', () => {
    const exec = mockSf({ 'org display': { status: 0, result: { id: '00DXXXXXXXXXXXXXXX' } } });
    const r = checkOrg(AGENT, { exec });
    assert.equal(r.ok, false);
    assert.equal(r.fatal, true);
    assert.match(r.motivo, /ES OTRA ORG/);
  });

  test('tolera el Id de 15 contra el de 18: son la misma org', () => {
    const exec = mockSf({ 'org display': { status: 0, result: { id: '00DO300000SGmzp' } } });
    assert.equal(checkOrg(AGENT, { exec }).ok, true);
  });

  test('sin orgId declarado no hay guarda, y eso también es fatal', () => {
    const exec = mockSf({ 'org display': { status: 0, result: { id: 'x' } } });
    const r = checkOrg({ ...AGENT, org: { alias: 'mi-org' } }, { exec });
    assert.equal(r.fatal, true);
    assert.match(r.motivo, /sin eso no hay guarda/);
  });

  test('la plantilla sin completar no pasa por descuido', () => {
    const exec = mockSf({ 'org display': { status: 0, result: { id: 'x' } } });
    const r = checkOrg({ ...AGENT, org: { alias: 'a', orgId: 'REEMPLAZAR' } }, { exec });
    assert.equal(r.fatal, true);
  });
});

// ---------------------------------------------------------------------------
describe('gate de versión — D1, el defecto más grave del catálogo', () => {
  test('activa == mayor número → pasa, y devuelve el id para --expect-version', () => {
    const exec = mockSf({ 'data query': versiones([v(29, '0X9ACTIVA', 'Active'), v(28, '0X9VIEJA', 'Inactive')]) });
    const r = checkVersion(AGENT, { exec });
    assert.equal(r.ok, true);
    assert.equal(r.expectVersion, '0X9ACTIVA');
  });

  test('🚨 activa != mayor número → fatal, con el número de las dos', () => {
    const exec = mockSf({ 'data query': versiones([v(30, '0X9BORRADOR', 'Inactive'), v(29, '0X9ACTIVA', 'Active')]) });
    const r = checkVersion(AGENT, { exec });
    assert.equal(r.fatal, true);
    assert.match(r.motivo, /activa es la v29 y la de mayor número es la v30/);
    assert.match(r.motivo, /NINGÚN usuario alcanza/);
    assert.match(r.motivo, /no va a fallar/, 'lo grave no es que falle: es que NO falla');
  });

  test('cero versiones activas → fatal, no se adivina cuál sirve producción', () => {
    const exec = mockSf({ 'data query': versiones([v(29, '0X9A', 'Inactive')]) });
    assert.equal(checkVersion(AGENT, { exec }).fatal, true);
  });

  test('más de una activa → fatal por la misma razón', () => {
    const exec = mockSf({ 'data query': versiones([v(29, '0X9A', 'Active'), v(28, '0X9B', 'Active')]) });
    const r = checkVersion(AGENT, { exec });
    assert.equal(r.fatal, true);
    assert.match(r.motivo, /exactamente 1 versión Active/);
  });

  test('el agente no existe en la org → fatal', () => {
    const exec = mockSf({ 'data query': versiones([]) });
    assert.equal(checkVersion(AGENT, { exec }).fatal, true);
  });
});

// ---------------------------------------------------------------------------
describe('orquestación', () => {
  const okOrg = { 'org display': { status: 0, result: { id: '00DO300000SGmzpMAD' } } };

  test('si la guarda de org falla, NO se sigue midiendo la org equivocada', () => {
    const exec = mockSf({ 'org display': { status: 0, result: { id: '00DOTRA' } } });
    const r = preflight(AGENT, { exec });
    assert.equal(r.ok, false);
    assert.match(r.version.motivo, /no se evaluó/);
  });

  test('Testing Center ausente NO bloquea: run-eval no lo necesita (D9)', () => {
    const exec = mockSf({
      ...okOrg,
      'data query': versiones([v(29, '0X9A', 'Active')]),
      'list metadata': { status: 1, message: 'not available' },
    });
    const r = preflight(AGENT, { exec });
    assert.equal(r.testingCenter.disponible, false);
    assert.equal(r.testingCenter.fatal, false);
    assert.match(r.testingCenter.motivo, /No bloquea/);
  });

  test('todo bien → ok, y expone el expectVersion que hay que encadenar', () => {
    const exec = mockSf({
      ...okOrg,
      'data query': versiones([v(29, '0X9ACTIVA', 'Active')]),
      'list metadata': { status: 0, result: [] },
    });
    const r = preflight(AGENT, { exec });
    assert.equal(r.expectVersion, '0X9ACTIVA');
    // `ok` depende además de que `sf` exista en el PATH de quien corre el test.
    assert.equal(r.org.ok && r.version.ok, true);
  });
});
