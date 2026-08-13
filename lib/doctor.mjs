#!/usr/bin/env node
/**
 * Chequeo de integridad del entorno. Se corre ANTES de gastar presupuesto.
 *
 * Existe por dos arranques en falso medidos:
 *
 *   1. Una skill copiada a medias — la carpeta y todo `assets/` presentes, pero
 *      **sin `SKILL.md`**. El loader la ignora entera y no avisa. El modo de
 *      falla es silencioso: la skill simplemente no existe.
 *   2. Dos copias del plugin en disco con versiones distintas, y la obsoleta en
 *      la ruta obvia. Ver `lib/tooling.mjs`.
 *
 *   node lib/doctor.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { toolingVersions, reportTooling } from './tooling.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Cada carpeta de `.claude/skills/` tiene que tener su `SKILL.md`. */
export function checkSkills(root = ROOT) {
  const dir = path.join(root, '.claude', 'skills');
  if (!fs.existsSync(dir)) return { dir, total: 0, ok: [], roto: [], presente: false };

  const carpetas = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const ok = [];
  const roto = [];
  for (const s of carpetas) {
    const f = path.join(dir, s, 'SKILL.md');
    (fs.existsSync(f) && fs.statSync(f).size > 0 ? ok : roto).push(s);
  }
  return { dir, total: carpetas.length, ok, roto, presente: true };
}

/** Los ficheros que `lib/` necesita para funcionar. */
export function checkLib(root = ROOT) {
  // `report.mjs` faltaba en esta lista hasta 2026-08-12 — justamente el que
  // produce el artefacto que ve el cliente.
  const req = ['gen-spec.mjs', 'extract.mjs', 'assert.mjs', 'report.mjs', 'preflight.mjs', 'bitacora.mjs', 'tooling.mjs'];
  const falta = req.filter((f) => !fs.existsSync(path.join(root, 'lib', f)));
  return { req, falta };
}

export function doctor(root = ROOT) {
  return { skills: checkSkills(root), lib: checkLib(root), tooling: toolingVersions() };
}

// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const d = doctor();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(d, null, 2));
    process.exit(d.skills.roto.length || d.lib.falta.length || !d.tooling.available ? 1 : 0);
  }

  let rc = 0;
  console.log('─'.repeat(64));

  if (!d.skills.presente) {
    console.log('skills: no hay `.claude/skills/` — nada que verificar');
  } else if (d.skills.roto.length) {
    rc = 1;
    console.log(`🚨 skills: ${d.skills.ok.length}/${d.skills.total} cargables. ${d.skills.roto.length} SIN \`SKILL.md\`:`);
    for (const s of d.skills.roto) console.log(`     ${s}`);
    console.log('   Una carpeta sin SKILL.md NO se carga y NO avisa: la skill simplemente');
    console.log('   no existe. Recopiarla completa desde el origen.');
  } else {
    console.log(`skills: ${d.skills.total}/${d.skills.total} con SKILL.md ✅`);
  }

  if (d.lib.falta.length) {
    rc = 1;
    console.log(`🚨 lib: faltan ${d.lib.falta.join(', ')}`);
  }

  rc = reportTooling(d.tooling) || rc;

  console.log('─'.repeat(64));
  process.exit(rc);
}
