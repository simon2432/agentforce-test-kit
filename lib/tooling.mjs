/**
 * Versión de la herramienta que EFECTIVAMENTE corre.
 *
 * Por qué existe (knowledge/02-known-issues.md, D22 y D23):
 *
 *   La CLI se auto-actualiza sola, incluso a mitad de una sesión de trabajo.
 *   Durante la ronda 3 saltó de plugin-agent 1.44.5 a 1.45.0 entre dos fases y
 *   se descubrió por accidente, en un stack trace. Todo defecto marcado
 *   "confirmado por código del cliente" está medido contra un código que puede
 *   cambiar abajo tuyo — y si cambia sin que nadie lo note, un cambio del
 *   cliente se atribuye al servidor.
 *
 * 🚨 Y hay una trampa: **hay dos copias del plugin en disco y la obsoleta está
 * en la ruta obvia** (`C:\Program Files\sf\...` contra
 * `%LOCALAPPDATA%\sf\client\<build>\...`). Leer la equivocada registra
 * fielmente la versión equivocada, que es exactamente el defecto que se está
 * tratando de evitar.
 *
 * ➡️ La fuente de verdad es `sf plugins --core`, que reporta lo que oclif cargó.
 *    Las copias en disco se listan aparte, sólo para avisar de la ambigüedad.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true }).trim();
  } catch {
    return null;
  }
};

/** Copias de `@salesforce/plugin-agent` en disco, con su versión. Sólo informativo. */
export function pluginCopiesOnDisk() {
  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'sf', 'client'),
    'C:\\Program Files\\sf\\client',
    path.join(os.homedir(), '.local', 'share', 'sf', 'client'),
  ].filter(Boolean);

  const out = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const builds = fs.statSync(root).isDirectory() ? fs.readdirSync(root) : [];
    for (const b of [...builds, '']) {
      const pkg = path.join(root, b, 'node_modules', '@salesforce', 'plugin-agent', 'package.json');
      if (!fs.existsSync(pkg)) continue;
      try {
        out.push({ version: JSON.parse(fs.readFileSync(pkg, 'utf8')).version, path: path.dirname(pkg) });
      } catch { /* copia rota: se ignora */ }
    }
  }
  return out;
}

/**
 * Devuelve la versión que corre de verdad, y avisa si hay ambigüedad en disco.
 * Nunca lanza: si `sf` no está, devuelve nulls y `available: false`.
 */
export function toolingVersions() {
  const cli = sh('sf', ['--version'])?.split(' ')[0] ?? null;
  const plugins = sh('sf', ['plugins', '--core']) ?? '';
  const agent = plugins.split('\n').find((l) => /^agent\s/.test(l.trim()));
  const pluginAgent = agent ? agent.trim().split(/\s+/)[1] : null;

  const copias = pluginCopiesOnDisk();
  const otras = pluginAgent ? copias.filter((c) => c.version !== pluginAgent) : copias;

  return {
    available: Boolean(cli),
    cli,
    pluginAgent,
    capturedAt: new Date().toISOString(),
    // D23: si hay copias con OTRA versión, la ruta obvia puede engañar
    staleCopiesOnDisk: otras,
    warning: otras.length
      ? `Hay ${otras.length} copia(s) de plugin-agent en disco con otra versión (${otras.map((c) => c.version).join(', ')}). ` +
        `La que corre es ${pluginAgent}. No verifiques código sobre las otras.`
      : null,
  };
}

export function reportTooling(t) {
  if (!t.available) {
    console.log('herramienta: NO DETECTADA (¿`sf` en el PATH?) — el resultado no es auditable');
    return 1;
  }
  console.log(`herramienta: sf ${t.cli} · plugin-agent ${t.pluginAgent}`);
  if (t.warning) console.log(`⚠️  ${t.warning}`);
  return 0;
}
