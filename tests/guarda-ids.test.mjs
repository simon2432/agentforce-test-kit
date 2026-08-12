/**
 * La guarda de Ids reales — `lib/gen-spec.mjs`.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * Es la única línea de código que separa una suite de prueba de un UPDATE sobre
 * registros de negocio reales, y hasta 2026-08-12 **no tenía un solo test**.
 * Además aceptaba un `allowOverride` que ningún flag exponía: una puerta trasera
 * sin uso en la guarda más crítica del repo. El parámetro se sacó.
 *
 * El mecanismo que hace que testear sea seguro está en `knowledge/05-safety.md`:
 * sin Id real las variables `linked` llegan NULL, el lookup no encuentra la
 * MessagingSession, y el DML afecta 0 filas. **Observado, no razonado** — y
 * verificado en el peor caso: 14 escalaciones contra una org con colas reales.
 *
 * Con un Id real, esa cadena se reactiva entera.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findRealIds } from '../lib/gen-spec.mjs';

const caso = (context) => ({ id: 'X1', utterance: 'hola', context });

describe('guarda de Ids reales — el único vector de DML', () => {
  test('una suite sin context no dispara nada', () => {
    assert.deepEqual(findRealIds([{ id: 'X1', utterance: 'hola' }]), []);
  });

  test('🚨 detecta un Id de 18 — el formato que devuelve la CLI', () => {
    const o = findRealIds([caso({ RoutableId: '0MwO30000004h1ZKAQ' })]);
    assert.equal(o.length, 1);
    assert.match(o[0], /X1\.context\.RoutableId/);
  });

  test('🚨 detecta un Id de 15 — el que se copia de la URL de Salesforce', () => {
    assert.equal(findRealIds([caso({ CaseId: '500O30000004h1Z' })]).length, 1);
  });

  test('🚨 los detecta en cualquier nombre de variable, no sólo los conocidos', () => {
    // La guarda es por FORMA, no por lista de nombres: una lista se queda corta
    // en cuanto alguien inventa una variable nueva.
    assert.equal(findRealIds([caso({ cualquierCosa: '003O30000004h1ZKAQ' })]).length, 1);
  });

  test('🚨 los detecta en TODOS los casos de la suite, no sólo en el primero', () => {
    const o = findRealIds([
      caso({ ok: 'texto libre' }),
      { id: 'X2', context: { EndUserId: '005O30000004h1ZKAQ' } },
    ]);
    assert.equal(o.length, 1);
    assert.match(o[0], /^X2\./);
  });

  test('y varios en el mismo caso se reportan todos', () => {
    const o = findRealIds([caso({ a: '500O30000004h1ZKAQ', b: '003O30000004h1Z' })]);
    assert.equal(o.length, 2);
  });

  test('un texto normal NO dispara falso positivo', () => {
    for (const v of ['hola', 'GeneralFAQ', 'human', '12345', 'un-valor-con-guiones']) {
      assert.deepEqual(findRealIds([caso({ x: v })]), [], `no debería disparar con "${v}"`);
    }
  });

  test('un valor no-string se ignora sin romper', () => {
    assert.deepEqual(findRealIds([caso({ n: 42, b: true, nulo: null })]), []);
  });

  test('la guarda ya NO acepta un override: la firma es de un solo argumento', () => {
    // Regresión explícita. El `allowOverride` muerto se sacó el 2026-08-12; si
    // alguien lo reintroduce, este test lo dice.
    assert.equal(findRealIds.length, 1, 'findRealIds no debe aceptar opciones');
  });
});
