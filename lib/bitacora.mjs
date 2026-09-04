#!/usr/bin/env node
/**
 * Bitácora de corridas — el rastro de auditoría por agente.
 *
 * 🚨 EL PROBLEMA QUE ESTE ARCHIVO EXISTE PARA EVITAR
 *
 * Un log que el agente escribe sobre sí mismo es la evidencia más débil del
 * repo, y por su ubicación se lee como la más fuerte. Si Claude se saltea un
 * paso, se equivoca o interpreta de más, **la narración va a salir igual de
 * convincente**. La doctrina de `knowledge/00-index.md` es CONFIRMADO = medido;
 * una narración auto-reportada no es ninguna de las dos cosas.
 *
 * ➡️ Por eso la bitácora tiene DOS CAPAS, separadas y marcadas:
 *
 *   CAPA 1 — DERIVADA. La calcula este script leyendo artefactos que existen
 *   independientemente de quien narra: el JSON crudo (trae `bot_version_id`,
 *   ids de sesión y duraciones que emite la plataforma, no nosotros), el spec,
 *   la suite, las versiones de CLI y plugin, y el SHA-256 de cada archivo.
 *   **Claude no puede falsear esta capa sin falsear los artefactos.**
 *
 *   CAPA 2 — NARRADA. Lo que escribe quien corrió: por qué, qué decidió, qué
 *   descartó, qué salió mal. Va marcada como auto-reportada, explícitamente.
 *
 * Y lo que convierte esto en auditoría de verdad: `--verificar` re-deriva la
 * capa 1 desde los artefactos y la contrasta contra lo escrito. **Una
 * discrepancia es un hallazgo.** Pasa de "confiá en mí" a "verificame", que es
 * lo que el repo hace en todos lados menos acá.
 *
 * Uso:
 *   node lib/bitacora.mjs --registrar --run agents/<slug>/runs/<carpeta> \
 *                         --suite <cases.yaml> [--engine run-eval] [--nota "..."]
 *   node lib/bitacora.mjs --verificar --agente agents/<slug>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { normalize, evaluate, census } from './assert.mjs';
import { toolingVersions } from './tooling.mjs';

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const existe = (f) => f && fs.existsSync(f);

/** Hora local con offset explícito. Un timestamp sin zona no es auditable. */
export function ahora(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const s = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${s}${hh}:${mm}`;
}

// --------------------------------------------------------------------------
// CAPA 1 — derivada de los artefactos
// --------------------------------------------------------------------------

/**
 * Lee una carpeta de corrida y devuelve TODO lo que se puede afirmar sin
 * creerle a nadie. Nada de acá lo escribe una persona ni un modelo.
 */
export function derivar(runDir, { suitePath, engine = 'run-eval' } = {}) {
  const f = (n) => path.join(runDir, n);
  const rawPath = existe(f('raw.json')) ? f('raw.json') : null;
  if (!rawPath) throw new Error(`no hay raw.json en ${runDir} — sin el crudo no hay nada que derivar`);

  const texto = fs.readFileSync(rawPath, 'utf8');
  const norm = normalize(texto, engine);

  const suite = suitePath && existe(suitePath) ? YAML.parse(fs.readFileSync(suitePath, 'utf8')) : null;
  const rows = suite ? evaluate(norm.cases, suite.cases, { engine }) : [];
  const cen = suite ? census(norm.cases, suite.cases, engine) : null;

  const n = (v) => rows.filter((r) => r.verdict === v).length;

  // Duración real: la reporta la plataforma por caso, no la medimos nosotros.
  const durMs = norm.cases.reduce((a, c) => a + (c.durationMs ?? 0), 0) || null;

  const artefactos = fs.readdirSync(runDir)
    .filter((x) => fs.statSync(f(x)).isFile())
    .sort()
    .map((x) => ({ archivo: x, bytes: fs.statSync(f(x)).size, sha256: sha256(f(x)) }));

  return {
    registradoEn: ahora(),
    carpeta: runDir.replace(/\\/g, '/'),
    motor: engine,
    suite: suitePath ? { archivo: suitePath.replace(/\\/g, '/'), sha256: sha256(suitePath), casos: suite?.cases?.length ?? null, nombre: suite?.suite ?? null } : null,
    version: {
      botVersionId: norm.version?.botVersionId ?? null,
      versionApiName: norm.version?.versionApiName ?? null,
      // `unavailable` es de `test run`, que no la expone por ningún camino (D1).
      auditable: Boolean(norm.version?.botVersionId) && norm.version?.consistent !== false,
      unaSolaVersion: norm.version?.consistent !== false,
    },
    tooling: (() => { const t = toolingVersions(); return { cli: t.cli, pluginAgent: t.pluginAgent, disponible: t.available }; })(),
    resultado: suite ? {
      casos: rows.length,
      passed: n('PASSED'), failed: n('FAILED'), error: n('ERROR'),
      missing: n('MISSING'), skipped: n('SKIPPED'), xfail: n('XFAIL'), xpass: n('XPASS'),
      safetyFallidos: rows.filter((r) => r.verdict === 'FAILED' && r.severity === 'safety').map((r) => r.id),
      censo: cen ? { declaradas: cen.totalDeclared ?? null, faltantes: cen.totalMissing ?? 0, sinResolver: cen.totalUnresolved ?? 0 } : null,
    } : null,
    duracionMs: durMs,
    filas: rows.map((r) => ({
      id: r.id,
      verdict: r.verdict,
      severity: r.severity ?? 'routing',
      verificado: (r.checks ?? []).filter((c) => c.verdict !== 'SKIP').map((c) => c.name),
      noVerificado: (r.checks ?? []).filter((c) => c.verdict === 'SKIP').map((c) => c.name),
    })),
    artefactos,
  };
}

// --------------------------------------------------------------------------
// RESUMEN.md — qué se testeó y qué dio, dentro de la carpeta de la corrida
// --------------------------------------------------------------------------

export function resumenDeCorrida(d, { nota } = {}) {
  const L = [];
  const icon = { PASSED: '✅', FAILED: '❌', ERROR: '💥', MISSING: '❓', SKIPPED: '⊘', XFAIL: '🔶', XPASS: '🔔' };

  L.push(`# Corrida — ${d.suite?.nombre ?? path.basename(d.carpeta)}`, '');
  L.push(`**${d.registradoEn}** · motor \`${d.motor}\``, '');

  L.push('| | |', '|---|---|');
  L.push(`| Versión del agente | ${d.version.versionApiName ?? '—'} (\`${d.version.botVersionId ?? 'NO DISPONIBLE'}\`) |`);
  L.push(`| Auditable en versión | ${d.version.auditable ? '✅ sí' : '🚨 **NO**'} |`);
  L.push(`| Herramienta | ${d.tooling.disponible ? `sf ${d.tooling.cli} · plugin-agent ${d.tooling.pluginAgent}` : '🚨 no detectada'} |`);
  if (d.suite) L.push(`| Suite | \`${d.suite.archivo}\` · ${d.suite.casos} casos |`);
  if (d.duracionMs) L.push(`| Duración (la reporta la plataforma) | ${(d.duracionMs / 1000).toFixed(1)} s |`);
  L.push('');

  if (!d.resultado) {
    L.push('⚠️ Sin `--suite`: se archivó el crudo pero **no se evaluó nada**.', '');
  } else {
    const r = d.resultado;
    L.push('## Resultado', '');
    L.push(`**${r.passed} passed · ${r.failed} failed · ${r.error} error · ${r.missing} missing**` +
           (r.skipped ? ` · ${r.skipped} skipped` : '') +
           (r.xfail || r.xpass ? ` · ${r.xfail} xfail · ${r.xpass} xpass` : ''), '');

    if (r.safetyFallidos.length) {
      L.push(`🚨 **${r.safetyFallidos.length} fallo(s) de severidad SAFETY: ${r.safetyFallidos.join(', ')}.**`,
             'Un fallo de safety es un incidente, no una regresión.', '');
    }
    if (r.censo?.faltantes) {
      L.push(`🚨 **${r.censo.faltantes} aserción(es) declaradas NO se ejecutaron.** No aparecen como fallo`,
             'en ningún lado: simplemente no corrieron.', '');
    }
    if (r.censo?.sinResolver) {
      L.push(`🚨 **${r.censo.sinResolver} referencia(s) no resolvieron.** Se compararon contra el texto del`,
             'template; su veredicto no significa nada.', '');
    }

    L.push('## Qué se verificó, caso por caso', '');
    L.push('| Caso | Veredicto | Se verificó | NO se verificó |', '|---|---|---|---|');
    for (const f of d.filas) {
      const sev = f.severity === 'safety' ? ' 🛡' : '';
      L.push(`| ${f.id}${sev} | ${icon[f.verdict] ?? ''} ${f.verdict} | ${f.verificado.join(', ') || '—'} | ${f.noVerificado.join(', ') || '—'} |`);
    }
    L.push('');
    L.push('⚠️ La columna **"NO se verificó"** no es relleno: un `SKIP` no es un acierto',
           'ni un fallo. Un caso con veredicto verde y media columna derecha llena está',
           'diciendo que se comprobó menos de lo que parece.', '');
  }

  L.push('## Artefactos de entrada', '');
  L.push('| Archivo | Bytes | SHA-256 |', '|---|---|---|');
  for (const a of d.artefactos) L.push(`| \`${a.archivo}\` | ${a.bytes} | \`${a.sha256.slice(0, 16)}…\` |`);
  L.push('');
  L.push('Éstos son los archivos de los que salió todo lo de arriba.',
         '`manifiesto.json` cubre además **este mismo RESUMEN.md**, así que editarlo',
         'a mano también se detecta. `npm run bitacora -- --verificar` recalcula todo.', '');

  if (nota) {
    L.push('---', '');
    L.push('## Nota de quien corrió — ⚠️ AUTO-REPORTADA', '');
    L.push('Todo lo de arriba se derivó de los artefactos. **Esto no.** Es lo que dijo',
           'quien ejecutó la corrida, y vale exactamente lo que valga su palabra.', '');
    L.push(nota.trim(), '');
  }

  return L.join('\n');
}

// --------------------------------------------------------------------------
// BITACORA.md — append-only, por agente
// --------------------------------------------------------------------------

const CABECERA = `# Bitácora

Registro de **toda** corrida contra una org, en orden cronológico. Append-only:
las entradas no se editan ni se borran — si algo salió mal, se agrega una entrada
que lo diga.

## Cómo leer esto

Cada entrada tiene dos capas, y la diferencia importa:

| Capa | Quién la escribe | Cuánto vale |
|---|---|---|
| **Derivada** | \`lib/bitacora.mjs\`, leyendo los artefactos | Se puede recalcular. \`npm run bitacora -- --verificar\` lo hace |
| **Narrada** | Quien corrió — persona o modelo | Auto-reportada. **No es evidencia** |

🚨 **Una narración es convincente aunque sea falsa.** Si una entrada narrada dice
algo que la capa derivada no respalda, manda la derivada.

---
`;

export function entradaBitacora(d, { nota, proposito } = {}) {
  const L = [];
  const r = d.resultado;

  L.push(`## ${d.registradoEn} — ${proposito ?? d.suite?.nombre ?? 'corrida'}`, '');
  L.push('### Derivado de los artefactos', '');
  L.push(`- **Carpeta:** \`${d.carpeta}\``);
  L.push(`- **Motor:** \`${d.motor}\``);
  if (d.suite) L.push(`- **Suite:** \`${d.suite.archivo}\` (${d.suite.casos} casos) · sha256 \`${d.suite.sha256.slice(0, 16)}…\``);
  L.push(`- **Versión del agente:** ${d.version.versionApiName ?? '—'} \`${d.version.botVersionId ?? 'NO DISPONIBLE'}\`` +
         (d.version.auditable ? '' : ' — 🚨 **este resultado NO es auditable en el eje de versión**'));
  L.push(`- **Herramienta:** ${d.tooling.disponible ? `sf ${d.tooling.cli} · plugin-agent ${d.tooling.pluginAgent}` : '🚨 no detectada'}`);
  if (d.duracionMs) L.push(`- **Duración:** ${(d.duracionMs / 1000).toFixed(1)} s (reportada por la plataforma)`);
  if (r) {
    L.push(`- **Resultado:** ${r.passed} passed · ${r.failed} failed · ${r.error} error · ${r.missing} missing` +
           (r.skipped ? ` · ${r.skipped} skipped` : '') + (r.xfail || r.xpass ? ` · ${r.xfail} xfail · ${r.xpass} xpass` : ''));
    if (r.safetyFallidos.length) L.push(`- 🚨 **SAFETY fallidos:** ${r.safetyFallidos.join(', ')}`);
    if (r.censo?.faltantes) L.push(`- 🚨 **${r.censo.faltantes} aserción(es) declaradas no se ejecutaron**`);
    if (r.censo?.sinResolver) L.push(`- 🚨 **${r.censo.sinResolver} referencia(s) sin resolver**`);
  } else {
    L.push('- **Resultado:** sin suite — se archivó el crudo, no se evaluó nada');
  }
  L.push(`- **Artefactos:** ${d.artefactos.length} archivo(s), ver \`${d.carpeta}/RESUMEN.md\``);
  L.push('');

  L.push('### Narrado — ⚠️ auto-reportado, no es evidencia', '');
  L.push(nota?.trim() || '_(sin nota)_', '');
  L.push('---', '');
  return L.join('\n');
}

export function registrar(runDir, { suitePath, engine = 'run-eval', nota, proposito, agenteDir } = {}) {
  const d = derivar(runDir, { suitePath, engine });

  // 1. RESUMEN.md dentro de la carpeta de la corrida
  fs.writeFileSync(path.join(runDir, 'RESUMEN.md'), `${resumenDeCorrida(d, { nota })}\n`, 'utf8');

  // 2. manifiesto — la capa derivada, en JSON, para poder re-verificar
  //    ⚠️ se escribe DESPUÉS del RESUMEN y se excluye a sí mismo del hash:
  //    un manifiesto que se hashea a sí mismo nunca verifica.
  const dFinal = derivar(runDir, { suitePath, engine });
  dFinal.artefactos = dFinal.artefactos.filter((a) => a.archivo !== 'manifiesto.json');
  fs.writeFileSync(path.join(runDir, 'manifiesto.json'), `${JSON.stringify(dFinal, null, 2)}\n`, 'utf8');

  // 3. append a la bitácora del agente
  const dir = agenteDir ?? path.resolve(runDir, '..', '..');
  const bit = path.join(dir, 'BITACORA.md');
  if (!existe(bit)) fs.writeFileSync(bit, CABECERA, 'utf8');
  fs.appendFileSync(bit, `\n${entradaBitacora(dFinal, { nota, proposito })}`, 'utf8');

  return { manifiesto: path.join(runDir, 'manifiesto.json'), resumen: path.join(runDir, 'RESUMEN.md'), bitacora: bit, derivado: dFinal };
}

// --------------------------------------------------------------------------
// VERIFICAR — el control que hace que la bitácora valga algo
// --------------------------------------------------------------------------

/**
 * Dos preguntas, las dos mecánicas:
 *   1. ¿Los artefactos de cada corrida siguen siendo los que se registraron?
 *   2. ¿Hay corridas archivadas SIN entrada en la bitácora?
 *
 * La segunda es la importante: es el único control real contra el olvido. Una
 * instrucción en `CLAUDE.md` se puede incumplir sin que se note; una corrida sin
 * entrada, no.
 */
export function verificar(agenteDir) {
  const runsDir = path.join(agenteDir, 'runs');
  const bitPath = path.join(agenteDir, 'BITACORA.md');
  const bit = existe(bitPath) ? fs.readFileSync(bitPath, 'utf8') : '';
  const hallazgos = [];

  if (!existe(runsDir)) return { hallazgos, corridas: 0, bitacora: existe(bitPath) };

  const corridas = fs.readdirSync(runsDir).filter((x) => fs.statSync(path.join(runsDir, x)).isDirectory());

  for (const c of corridas) {
    const dir = path.join(runsDir, c);
    const rel = `${agenteDir.replace(/\\/g, '/')}/runs/${c}`;
    const man = path.join(dir, 'manifiesto.json');

    if (!existe(man)) {
      hallazgos.push({ tipo: 'sin-registrar', corrida: c, detalle: 'no tiene manifiesto.json: la corrida existe pero nunca se registró' });
      continue;
    }
    if (!bit.includes(rel)) {
      hallazgos.push({ tipo: 'sin-entrada', corrida: c, detalle: 'tiene manifiesto pero NO figura en BITACORA.md' });
    }

    const m = JSON.parse(fs.readFileSync(man, 'utf8'));
    for (const a of m.artefactos ?? []) {
      const f = path.join(dir, a.archivo);
      if (!existe(f)) { hallazgos.push({ tipo: 'artefacto-faltante', corrida: c, detalle: `falta \`${a.archivo}\`` }); continue; }
      const real = sha256(f);
      if (real !== a.sha256) {
        hallazgos.push({ tipo: 'artefacto-alterado', corrida: c, detalle: `\`${a.archivo}\` cambió después de registrarse (${a.sha256.slice(0, 12)}… → ${real.slice(0, 12)}…)` });
      }
    }
    if (m.version && !m.version.auditable) {
      hallazgos.push({ tipo: 'no-auditable', corrida: c, detalle: 'se registró sin versión verificable del agente' });
    }
  }
  return { hallazgos, corridas: corridas.length, bitacora: existe(bitPath) };
}

// --------------------------------------------------------------------------

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  if (process.argv.includes('--verificar')) {
    const agenteDir = argOf('--agente');
    if (!agenteDir) { console.error('uso: node lib/bitacora.mjs --verificar --agente agents/<slug>'); process.exit(2); }
    const v = verificar(agenteDir);
    console.log('─'.repeat(64));
    console.log(`corridas archivadas: ${v.corridas} · bitácora: ${v.bitacora ? 'existe' : '🚨 NO EXISTE'}`);
    if (!v.hallazgos.length) {
      console.log('✅ todas las corridas están registradas y sus artefactos intactos');
    } else {
      for (const h of v.hallazgos) console.log(`🚨 [${h.tipo}] ${h.corrida}: ${h.detalle}`);
      console.log('\nUna corrida sin entrada no es un descuido de forma: es una corrida que');
      console.log('pasó y no quedó registrada. El resto de la bitácora se lee completo igual.');
    }
    console.log('─'.repeat(64));
    process.exit(v.hallazgos.length ? 1 : 0);
  }

  const runDir = argOf('--run');
  if (!runDir) {
    console.error('uso: node lib/bitacora.mjs --registrar --run <carpeta> --suite <cases.yaml> [--engine run-eval] [--nota "..."] [--proposito "..."]');
    console.error('     node lib/bitacora.mjs --verificar --agente agents/<slug>');
    process.exit(2);
  }
  const r = registrar(runDir, {
    suitePath: argOf('--suite'), engine: argOf('--engine') ?? 'run-eval',
    nota: argOf('--nota'), proposito: argOf('--proposito'),
  });
  console.log(`✅ ${r.resumen}`);
  console.log(`✅ ${r.manifiesto}`);
  console.log(`✅ ${r.bitacora}`);
  if (!r.derivado.version.auditable) {
    console.log('\n🚨 Se registró, pero SIN versión verificable del agente. La entrada lo dice.');
  }
}
