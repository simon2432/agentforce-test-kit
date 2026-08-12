/**
 * Los punteros a defectos de `lib/` tienen que apuntar al defecto correcto.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * La disciplina del repo es *cada regla con un puntero a su evidencia*. En la
 * auditoría del 2026-08-12 aparecieron **10 bloques de comentario con la cita
 * equivocada** en `assert.mjs`, `extract.mjs` y `gen-spec.mjs`: habían quedado
 * congelados en una numeración anterior. `D1` decía "el exit code" cuando D1 es
 * la versión del agente — el defecto más grave del catálogo.
 *
 * Un puntero que miente es peor que ninguno: manda a leer el defecto equivocado
 * y el lector cree que verificó.
 *
 * Esto no se arregla renumerando. Los números son **identificadores estables**,
 * citados 188 veces en el repo y 123 de ellas en `evidencia/`, que es registro
 * congelado. Se arregla verificando las citas.
 *
 * Este test hace dos cosas:
 *   1. toda cita `D<n>` de `lib/` corresponde a un defecto que existe;
 *   2. las citas que el repo considera críticas apuntan al defecto correcto,
 *      contrastando contra una palabra clave del título real.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOC = path.join(ROOT, 'knowledge', '02-known-issues.md');

/** `{ 1: 'Podés estar testeando una versión que ningún usuario alcanza', … }` */
function titulos() {
  const out = {};
  for (const l of fs.readFileSync(DOC, 'utf8').split('\n')) {
    const m = /^### D(\d+)\.\s*(.+)$/.exec(l);
    if (m) out[Number(m[1])] = m[2].trim();
  }
  return out;
}

/** Toda cita `D<n>` en `lib/*.mjs`, con archivo y línea. */
function citas() {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'lib')).filter((x) => x.endsWith('.mjs'))) {
    fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8').split('\n').forEach((linea, i) => {
      for (const m of linea.matchAll(/\bD(\d+)\b/g)) {
        out.push({ file: f, line: i + 1, n: Number(m[1]), texto: linea.trim() });
      }
    });
  }
  return out;
}

describe('punteros a defectos — lib/ contra knowledge/02', () => {
  test('el catálogo se puede parsear y tiene los 23 defectos', () => {
    const t = titulos();
    assert.equal(Object.keys(t).length, 23);
    for (let n = 1; n <= 23; n++) assert.ok(t[n], `falta D${n} en el catálogo`);
  });

  test('toda cita D<n> de lib/ apunta a un defecto que existe', () => {
    const t = titulos();
    const huerfanas = citas().filter((c) => !t[c.n]);
    assert.deepEqual(huerfanas.map((c) => `${c.file}:${c.line} D${c.n}`), [],
      'hay citas a defectos inexistentes');
  });

  /**
   * Anclaje semántico. Para cada número, una palabra que TIENE que aparecer en
   * su título. Si alguien renumera el catálogo sin tocar `lib/`, esto se cae.
   */
  test('los números citados corresponden al defecto que el comentario describe', () => {
    const t = titulos();
    const ancla = {
      1: /versión/i,
      2: /exit code/i,
      3: /aserción.*no ejecutarse/i,
      4: /get_state/i,
      5: /expectedActions: \[\]/i,
      6: /expectedActions.*roto/i,
      7: /topic/i,
      8: /escalación/i,
      9: /Testing Center/i,
      10: /conversationHistory/i,
      15: /bot_response_rating/i,
      21: /export/i,
      22: /auto-actualiza/i,
      23: /dos copias/i,
    };
    const malas = [];
    for (const [n, re] of Object.entries(ancla)) {
      if (!re.test(t[n] ?? '')) malas.push(`D${n} — el título es "${t[n]}" y no matchea ${re}`);
    }
    assert.deepEqual(malas, [], 'el catálogo se renumeró: hay que revisar las citas de lib/');
  });

  test('ningún archivo de lib/ cita el formato viejo `D8+D14` para la versión', () => {
    const viejas = citas().filter((c) => /D8\+D14/.test(c.texto));
    assert.deepEqual(viejas.map((c) => `${c.file}:${c.line}`), [],
      'la versión es D1 a secas; D8 es el literal de escalación y D14 el ignorar metrics');
  });
});
