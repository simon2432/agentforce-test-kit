# Corrida — contenido

**2026-08-13T11:41:51-03:00** · motor `run-eval`

| | |
|---|---|
| Versión del agente | v3 (`0X9al000000qfiDCAQ`) |
| Auditable en versión | ✅ sí |
| Herramienta | sf @salesforce/cli/2.146.3 · plugin-agent 1.45.0 |
| Suite | `agents/bici-store/suites/contenido.cases.yaml` · 6 casos |
| Duración (la reporta la plataforma) | 24.5 s |

## Resultado

**6 passed · 0 failed · 0 error · 0 missing**

## Qué se verificó, caso por caso

| Caso | Veredicto | Se verificó | NO se verificó |
|---|---|---|---|
| C01 | ✅ PASSED | topic(exact), actions, custom[consultar_faq devolvió el literal exacto de horario] | — |
| C02 | ✅ PASSED | topic(exact), actions, custom[consultar_faq devolvió el literal exacto de envío] | — |
| C03 | ✅ PASSED | topic(exact), actions, custom[consultar_faq devolvió el literal exacto de garantía] | — |
| C04 | ✅ PASSED | topic(exact), actions, custom[consultar_faq devolvió el literal exacto de cuotas] | — |
| C05 | ✅ PASSED | topic(exact), actions, custom[consultar_faq devolvió el literal exacto de sucursales] | — |
| C06 🛡 | ✅ PASSED | topic(exact), actions, custom[ante una consulta sin dato, la acción devuelve el fallback y no inventa] | — |

⚠️ La columna **"NO se verificó"** no es relleno: un `SKIP` no es un acierto
ni un fallo. Un caso con veredicto verde y media columna derecha llena está
diciendo que se comprobó menos de lo que parece.

## Artefactos de entrada

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `informe.md` | 1783 | `2f9b1156158cfdb6…` |
| `raw.json` | 268535 | `13cea1621da4ee80…` |
| `spec.yaml` | 3930 | `6136057827e64ebb…` |

Éstos son los archivos de los que salió todo lo de arriba.
`manifiesto.json` cubre además **este mismo RESUMEN.md**, así que editarlo
a mano también se detecta. `npm run bitacora -- --verificar` recalcula todo.

---

## Nota de quien corrió — ⚠️ AUTO-REPORTADA

Todo lo de arriba se derivó de los artefactos. **Esto no.** Es lo que dijo
quien ejecutó la corrida, y vale exactamente lo que valga su palabra.

6/6 PASSED con los 6 literales byte-exactos. IMPORTANTE: durante esta corrida se descubrio que assert.mjs contaba las customEvaluations en el censo pero NO calculaba su veredicto — con el literal esperado cambiado por uno falso daba PASSED y exit 0. Se arreglo (compareCustom) y se agregaron 7 tests. Este informe se genero DESPUES del arreglo y los chequeos de contenido ahora se ven en la salida.

