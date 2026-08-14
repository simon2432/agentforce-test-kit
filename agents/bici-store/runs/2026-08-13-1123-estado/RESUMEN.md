# Corrida — estado

**2026-08-13T11:42:02-03:00** · motor `run-eval`

| | |
|---|---|
| Versión del agente | — (`NO DISPONIBLE`) |
| Auditable en versión | 🚨 **NO** |
| Herramienta | sf @salesforce/cli/2.146.3 · plugin-agent 1.45.0 |
| Suite | `agents/bici-store/suites/estado.cases.yaml` · 4 casos |

## Resultado

**0 passed · 0 failed · 0 error · 4 missing**

🚨 **6 aserción(es) declaradas NO se ejecutaron.** No aparecen como fallo
en ningún lado: simplemente no corrieron.

## Qué se verificó, caso por caso

| Caso | Veredicto | Se verificó | NO se verificó |
|---|---|---|---|
| E01 | ❓ MISSING | — | — |
| E02 | ❓ MISSING | — | — |
| E03 | ❓ MISSING | — | — |
| E04 | ❓ MISSING | — | — |

⚠️ La columna **"NO se verificó"** no es relleno: un `SKIP` no es un acierto
ni un fallo. Un caso con veredicto verde y media columna derecha llena está
diciendo que se comprobó menos de lo que parece.

## Artefactos de entrada

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `raw.json` | 5888 | `ead586a6909b67d8…` |
| `spec.yaml` | 2540 | `a154c27b3742c81e…` |

Éstos son los archivos de los que salió todo lo de arriba.
`manifiesto.json` cubre además **este mismo RESUMEN.md**, así que editarlo
a mano también se detecta. `npm run bitacora -- --verificar` recalcula todo.

---

## Nota de quien corrió — ⚠️ AUTO-REPORTADA

Todo lo de arriba se derivó de los artefactos. **Esto no.** Es lo que dijo
quien ejecutó la corrida, y vale exactamente lo que valga su palabra.

CORRIDA INVALIDA, se archiva por transparencia. El motor devolvio 422 'Field required: agent.send_message.utterance' y NINGUNA asercion corrio. Causa: error mio al escribir la suite — puse solo turns sin utterance. El formato correcto es turns = turnos previos y utterance = el turno que se mide. Lo detecto el censo (4 MISSING, exit 1), no los veredictos: sin censo esto habria pasado por una corrida vacia. Reemplazada por 2026-08-13-1124-estado.

