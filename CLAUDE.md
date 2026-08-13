# Reglas duras — testing de agentes Agentforce

Este archivo es corto a propósito. Todo lo que no sea inviolable vive en
`knowledge/`. Antes de escribir o correr cualquier test, leé `knowledge/00-index.md`.

Validado contra **tres agentes, en tres organizaciones**, ~430 ejecuciones. Cada
regla tiene evidencia medida detrás.

Para el usuario humano: `README.md` → `EMPEZAR-ACA.md` → `LIMITES.md`. Este
archivo es para vos, no para él.

## La primera, porque invalida todo lo demás

1. **Verificar en cada corrida contra qué versión corrió.** El motor de
   evaluación resuelve por **número más alto**, sin filtrar por `Status`;
   producción sirve la **activa**. Cuando difieren, la suite mide una versión que
   ningún usuario alcanza — y **nada falla**: los dos endpoints devuelven exit 0
   con respuestas plausibles.
   ➡️ Leer `sessionContext.tags.bot_version_id` de la corrida y **abortar** si no
   coincide con la activa. Una SOQL previa no alcanza: tiene ventana de carrera.

   ✅ **Implementado y obligatorio desde 2026-08-12.** `npm run preflight` resuelve
   la activa y te da el id; `assert.mjs --expect-version <id>` lo contrasta contra
   la corrida. **Sin `--expect-version`, `assert.mjs` sale 1** y declara el
   resultado no auditable — leer la versión NO es verificarla. El escape es
   `--no-version-check`, que deja constancia en la salida.

   🚨 **Y esta regla es IMPOSIBLE de cumplir con `test run`.** Ese motor no expone
   la versión por ningún camino: ni en su JSON, ni en el `AiEvaluationDefinition`
   que despliega, ni en el export de Testing Center. **La regla más importante del
   repo sólo se puede cumplir con el comando BETA.** Un resultado de `test run`
   nunca es auditable en este eje: decirlo en el reporte, no taparlo.

   📌 **Registrar también la versión de la CLI y del plugin.** Se auto-actualizan
   solas, incluso a mitad de sesión, e invalidan cualquier verificación de código
   previa. Un resultado sin las **dos** versiones no es auditable.

## Nunca

2. **Nunca poner un Id real** (`RoutableId`, `CaseId`, `MessagingSession.Id`) en
   `contextVariables`. Es el único vector que reactiva DML real sobre registros
   de negocio. Sin Id real, las variables `linked` llegan NULL y los flows que
   filtran por ellas afectan 0 filas — **observado**, no razonado.
3. **Nunca gatear un CI por el exit code de la CLI.** Está roto en los dos
   comandos: sólo los errores de ejecución lo mueven, nunca los fallos de
   aserción. Usar `lib/assert.mjs`.
4. **Nunca assertar el texto que genera el LLM.** No es reproducible: la misma
   utterance devolvió textos distintos **dentro de la misma corrida**.
   ⚠️ Esto **no** aplica al output de una acción determinista, que sí es
   byte-exacto y sí se asserta. Ver `knowledge/03-assertions.md`.
5. **Nunca derivar `expectedTopic` de leer el `.agent`.** El script describe la
   intención; el clasificador hace otra cosa. Falló 2/20 en un agente y 1/8 en
   otro. Observar el runtime primero (descubrimiento), después escribir el assert.
6. **Nunca usar `sf agent generate test-spec` en modo interactivo.** Ofrece los
   nombres compilados y genera specs que fallan siempre. Sólo sirve como
   conversor con `--from-definition`.
7. **Nunca usar `sf agent test resume`.** Devuelve exit 0 sin esperar y sin
   escribir resultados. Polling propio con `test results --job-id`.
8. **Nunca correr `sf` desde Git Bash en Windows.** Siempre devuelve exit 1.
   PowerShell.

## Siempre

9. **Nombres de topic limpios y completos** (`GeneralFAQ`, no `GeneralFAQ_16jO...`,
   no `FAQ`). `run-eval` compara con `contains` y los substrings pasan por accidente.
10. **Escalación se asserta como `human` con `match: contains`.** El literal varía
    **por campo, no por motor** (`actual_value` y `lastExecution.topic` difieren
    en la misma corrida), y **en el turno en que la escalación se concreta el
    runtime devuelve el literal de humano en lugar del subagente — cualquiera sea
    ese subagente y haga lo que haga además**. El nombre del subagente aparece
    cuando la escalación **no** se concreta.
    ⚠️ La portabilidad de `human` entre motores es **contingente**: pasa en
    `run-eval` por laxitud del operador y en `test run` por coincidencia exacta.
    Si `test run` cambiara su literal, no hay valor que sirva para los dos.
11. **Toda ref cruda en `customEvaluations` exige `expectedTopic` en el mismo
    caso.** Sin él no se ejecuta el paso que resuelve la referencia, y el motor
    compara contra el template literal: FAIL silencioso, indistinguible de una
    regresión real del agente.
12. **Censo de aserciones.** Declarás N, verificás que corrieron N, exit 1 si
    faltan. Hay **cuatro** mecanismos distintos por los que una aserción no se
    ejecuta sin que se vea en los veredictos, y el cuarto —`test run` colapsa las
    aserciones repetidas de un mismo caso— **no deja ningún rastro**.
    ⚠️ Y el exit code no ayuda: **está invertido**. Da verde con fallos de
    aserción reales y rojo con una evaluación que no corrió.
13. **`--batch-size 1` explícito** en `run-eval`. El default de 5 es ~2,8× más
    lento y mucho más impredecible (σ 0,03 s contra un rango de 30 s).
14. **Archivar la salida de cada corrida** en `runs/`. `run-eval` es efímero
    total: si no se captura stdout, la corrida se pierde.

    ➡️ **Una carpeta por corrida, dentro del agente**, y TODO adentro:
    `agents/<slug>/runs/<YYYY-MM-DD-HHmm>-<proposito>/` con `spec.yaml`,
    `raw.json`, `informe.md`, `RESUMEN.md`, `manifiesto.json`. Nunca en la raíz,
    nunca mezclando dos agentes, nunca reusando una carpeta.

    🚨 **Y registrar la corrida ANTES de reportarle nada al usuario:**

    ```
    npm run bitacora -- --registrar --run <carpeta> --suite <cases.yaml> \
      --proposito "<qué se probó>" --nota "<qué decidiste y por qué>"
    ```

    Escribe `RESUMEN.md` (qué se testeó y qué dio, caso por caso),
    `manifiesto.json` (sha256 de cada artefacto) y agrega la entrada a
    `agents/<slug>/BITACORA.md`.

    ⚠️ **Tu nota va en la capa NARRADA, que está marcada como auto-reportada y no
    es evidencia.** No la escribas como si lo fuera. Poné lo que decidiste, lo
    que descartaste y lo que salió mal — sobre todo lo que salió mal. Los números
    los deriva el script solo, y si tu nota los contradice, gana el script.

    ➡️ Al cerrar la sesión: `npm run bitacora -- --verificar --agente agents/<slug>`.
    Detecta corridas sin registrar, entradas borradas y artefactos alterados.
    **Es el único control real contra tu propio olvido:** esta regla se puede
    incumplir sin que se note, una corrida sin entrada no.
15. **Usar `--json`, no `--result-format json`.** Son dos formatos distintos; el
    segundo produce un stdout que no es JSON válido.

## Al escribir un caso nuevo

- `expectedActions: []` **no asserta nada** (semántica de subconjunto). No da
  cobertura; no lo cuentes como tal.
- El nombre de una acción es **su alias en el `.agent`**, no el target
  (`consultar_faq`, no `apex://BiciStoreFaq`).
- Los topics de plataforma (`Prompt_Injection`, `human*`) no están en el `.agent`
  pero el runtime los devuelve. Consultá `agents/<slug>/vocabulary.json`.
- Marcá `severity: safety` los casos donde un fallo es un incidente, no una
  regresión (consejo médico/legal, fuga de prompt, PII).
  ➡️ **Y corrélos N veces, no una.** Un fallo intermitente en un camino de
  seguridad es indistinguible de verde si sólo mirás una corrida: medimos un
  fallo real de escalación que aparecía 1 de cada 4 corridas.
- Marcá `xfail` con `reason` obligatorio los casos rotos **por la plataforma**.
  No mueve el exit code, y si algún día pasa hay que gritarlo: significa que la
  plataforma cambió.

## Confianza

Todo hallazgo en `knowledge/` está marcado **CONFIRMADO** (medido),
**INFERIDO** (razonado, no observado) o **NO DETERMINADO** (abierto).

⚠️ **"Confirmado por código" no es un nivel.** Vale para afirmaciones sobre el
**cliente** (qué manda la CLI, cómo mapea, cómo calcula el exit code). Para
afirmaciones sobre el **servidor** es INFERIDO — el cliente puede armar el pedido
perfectamente y el runtime ignorarlo. Está medido dos veces: `contextVariables`
viaja perfecto en los dos motores y el runtime lo descarta igual.

⚠️ **Y una verificación de código VENCE.** La CLI se auto-actualiza sola. Verificar
los anclajes al empezar **y al cerrar** la sesión, y registrar la versión en cada
corrida. Si no, un cambio del cliente se atribuye al servidor.
