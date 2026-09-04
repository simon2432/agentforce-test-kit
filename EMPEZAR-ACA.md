# Los primeros 30 minutos

Esto es lo que hace alguien la primera vez, en orden, contra su propio agente.

Al final vas a tener: el vocabulario real de tu agente, una batería de ruteo
corriendo, y un informe auditable.

**Antes de empezar, leé [`LIMITES.md`](LIMITES.md).** Son 5 minutos y te evita
apoyar una decisión en un resultado que no aplica a tu caso.

---

## Lo que necesitás tener

| | |
|---|---|
| **Windows** | PowerShell. **Nunca Git Bash** — desde ahí la CLI siempre reporta error |
| **Node** | 22 o superior |
| **Salesforce CLI** | con el plugin `@salesforce/plugin-agent` |
| **Una org** | con tu agente **publicado y activo** |
| **Un agente** | **Agent Script** (`agentDSLEnabled=true`). Los clásicos están fuera de alcance |

Y **seis cosas que sólo sabe quien conoce el agente** — no las averigua Claude:

1. El alias de la org y su Org Id
2. El API name del agente
3. Qué hace cada subagente, en tus palabras
4. **Qué caminos tocan datos** (esto se responde leyendo el XML del flow, no la
   descripción del agente)
5. En qué idioma habla
6. Si la org es de producción o descartable

---

## Minuto 0 — ¿Está sano el entorno?

```powershell
npm install
npm run doctor
```

Verifica que las skills estén completas, que `lib/` esté entera, y —lo más
importante— **registra qué versión de la CLI está corriendo de verdad**.

La CLI se auto-actualiza sola, incluso a mitad de sesión. Un resultado sin esa
versión anotada no es auditable.

```powershell
npm test    # 110 tests de las utilidades. Deberían pasar todos
```

---

## Minuto 5 — Registrar tu agente

```powershell
mkdir agents\<tu-slug>
copy agents\_template\agent.json agents\<tu-slug>\agent.json
copy agents\_template\vocabulary.json agents\<tu-slug>\vocabulary.json
mkdir agents\<tu-slug>\suites
```

Completá `agent.json`. Todos los campos tienen un comentario que explica de dónde
sale el valor y por qué importa.

El **Org Id es una guarda**, no decoración: un error de tipeo en el alias puede
apuntar a la org de otro cliente.

**`vocabulary.json` no se completa a mano todavía.** Se genera en el paso
siguiente.

---

## Minuto 8 — El preflight, que puede abortar todo

**Antes de gastar una sola conversación con el agente:**

```powershell
npm run preflight -- --agent agents\<slug>\agent.json
```

Verifica cuatro cosas y te devuelve el `--expect-version` que vas a necesitar
después:

| | |
|---|---|
| 🚨 Que el alias resuelva **al Org Id que declaraste** | un typo apunta a la org de otro cliente y la corrida sale bien igual |
| 🚨 Que la versión **activa** sea la de **mayor número** | si difieren, medís una versión que ningún usuario alcanza y **nada falla** |
| Si la org tiene Testing Center | informativo: `run-eval` no lo necesita |
| Qué versión de la CLI corre | se auto-actualiza sola |

Los dos primeros son fatales. **Si aborta, parar** — no seguir con un plan
alternativo.

⚠️ **El preflight NO cierra el problema de la versión por sí solo.** Entre su
consulta y tu corrida hay una ventana de carrera. El cierre real es
`assert.mjs --expect-version`, que lee la versión **de la corrida misma**. El
preflight sirve para no gastar presupuesto de entrada, y para darte ese valor.

---

## Minuto 10 — El descubrimiento (obligatorio, va primero)

🚨 **No escribas expectativas leyendo el código de tu agente.** El código describe
la intención; el clasificador hace otra cosa.

Medido en los tres agentes: falló 2 de 20 en uno, 1 de 8 en otro, 1 de 10 en el
tercero. Y en el tercero el código decía **explícitamente lo contrario** de lo
que hizo el clasificador.

Además, el runtime devuelve destinos que **no existen en tu código**: protecciones
de la plataforma y literales de escalación.

```powershell
# 1. Escribí ~8 consultas sonda, una por cada camino que creés que existe
#    (agents/<slug>/suites/descubrimiento.cases.yaml)

# 2. Generá el spec — el centinela es obligatorio o no devuelve nada
node lib/gen-spec.mjs --suite agents\<slug>\suites\descubrimiento.cases.yaml `
  --agent <ApiName> --engine run-eval --discover --out runs\disc.yaml

# 3. Corré 3 veces. Una sola observación es ruido
sf agent test run-eval --spec runs\disc.yaml --target-org <alias> `
  --batch-size 1 --json 2>$null > runs\disc-1.json
```

Después leés qué destino devolvió cada consulta **de verdad** y con eso escribís
`vocabulary.json`.

⚠️ **Tres detalles que cuestan una corrida cada uno:**

- `--json`, **nunca** `--result-format json`. Son formatos distintos y el segundo
  no produce JSON válido.
- `2>$null`, **nunca** `2>&1`. El aviso de actualización de la CLI va a error
  estándar y mezclarlo rompe el parseo con un mensaje que no se parece en nada a
  la causa.
- `--batch-size 1` explícito. El default de 5 es ~2,8× más lento y mucho más
  impredecible.

---

## Minuto 20 — Tu primera batería de ruteo

```powershell
copy agents\_template\suites\ejemplo.cases.yaml agents\<slug>\suites\ruteo.cases.yaml
```

La plantilla trae cinco casos comentados que cubren los patrones que importan:
caso simple, escalación, seguridad, contenido determinista, y conversación de
varios turnos.

**Las cuatro reglas al escribir un caso:**

- El destino esperado sale de `vocabulary.json`, **no** de leer el código.
- Nombres **completos**: `GeneralFAQ`, no `FAQ`. El motor compara por
  coincidencia parcial y los fragmentos pasan por accidente.
- Escalación se verifica como `human` con comparación `contains`. **Nunca el
  nombre de tu subagente de escalación** — no aparece cuando la escalación se
  concreta.
- El nombre de una acción es **su alias**, no el destino: `consultar_faq`, no
  `apex://MiClaseApex`.

Y una que parece técnica y no lo es:

🚨 **`actions: []` no verifica nada.** Es semántica de subconjunto: la lista vacía
está contenida en cualquier cosa. Medido: 20 casos con lista vacía, los 20
invocaron acciones reales, los 20 dieron verde. **No lo cuentes como cobertura.**

---

## Minuto 25 — Correr, verificar, informar

🚨 **Una carpeta por corrida, dentro del agente, con todo adentro.** Nunca en la
raíz, nunca mezclando dos agentes, nunca reusando una carpeta.

```powershell
$R = "agents\<slug>\runs\$(Get-Date -Format 'yyyy-MM-dd-HHmm')-ruteo"
mkdir $R

# 1. Generar el spec
node lib/gen-spec.mjs --suite agents\<slug>\suites\ruteo.cases.yaml `
  --agent <ApiName> --engine run-eval --out $R\spec.yaml

# 2. Correr — archivar SIEMPRE. El motor es efímero: si no capturás
#    la salida, la corrida se pierde para siempre
sf agent test run-eval --spec $R\spec.yaml --target-org <alias> `
  --batch-size 1 --json 2>$null > $R\raw.json

# 3. El veredicto de verdad — nunca el código de salida de la CLI.
#    --expect-version es OBLIGATORIO: sin él sale 1 y avisa que no es auditable.
#    El valor te lo dio el preflight.
node lib/assert.mjs --raw $R\raw.json --suite agents\<slug>\suites\ruteo.cases.yaml `
  --engine run-eval --expect-version <BotVersionId>

# 4. El informe presentable
node lib/report.mjs --suite agents\<slug>\suites\ruteo.cases.yaml `
  --raw $R\raw.json --agent agents\<slug>\agent.json `
  --vocabulary agents\<slug>\vocabulary.json --out $R\informe.md

# 5. Registrar la corrida en la bitácora del agente
node lib/bitacora.mjs --registrar --run $R `
  --suite agents\<slug>\suites\ruteo.cases.yaml `
  --proposito "batería de ruteo" --nota "qué decidiste y por qué"
```

🚨 **El paso 3 no es opcional.** El código de salida de la CLI **está invertido**:
da verde con fallos reales de verificación y rojo con una prueba que ni siquiera
corrió. `assert.mjs` calcula el veredicto correcto y además hace el **censo**:
declarás N verificaciones, comprueba que corrieron las N.

Ese censo existe porque hay **cuatro mecanismos distintos** por los que una
verificación no se ejecuta sin que se note, y uno de ellos no deja ningún rastro.

🚨 **Y `--expect-version` tampoco es opcional.** Sin ese flag, `assert.mjs` sale 1
y te avisa que el resultado **no es auditable**: leer la versión de la corrida no
es lo mismo que contrastarla contra la activa. Si necesitás una corrida
exploratoria, `--no-version-check` lo permite — y deja constancia en la salida,
para que nadie use ese resultado como evidencia.

### El paso 5 es lo que hace auditable todo lo anterior

Deja tres cosas: `RESUMEN.md` en la carpeta —qué se testeó y qué dio, caso por
caso, con una columna para **lo que NO se verificó**—, `manifiesto.json` con el
sha256 de cada archivo, y una entrada en `agents/<slug>/BITACORA.md`.

La bitácora tiene dos capas y la diferencia importa: lo **derivado** lo calcula
el script leyendo los artefactos —la versión sale del crudo, los veredictos se
recalculan— y lo **narrado** es tu nota, marcada como auto-reportada. Si las dos
se contradicen, gana la derivada.

---

## Antes de cerrar

```powershell
npm run bitacora -- --verificar --agente agents\<slug>
```

Detecta corridas sin registrar, entradas borradas y artefactos alterados después
del hecho. **Es el control contra el olvido**, tuyo o de quien haya corrido: una
regla escrita se puede incumplir sin que se note, una corrida sin entrada no.

---

## Y ahora, ¿qué?

| Si querés… | Andá a |
|---|---|
| Entender los 7 tipos de prueba en detalle | [`TIPOS-DE-PRUEBA.md`](TIPOS-DE-PRUEBA.md) |
| Verificar contenido, estado, o conversaciones | `TIPOS-DE-PRUEBA.md`, tipos 4 y 5 |
| Los comandos exactos y los 23 defectos | [`ANEXO-TECNICO.md`](ANEXO-TECNICO.md) |
| Ver un agente completo ya armado | [`ejemplos/bici-store/`](ejemplos/bici-store/) |
| Saber en qué NO confiar | [`LIMITES.md`](LIMITES.md) |

---

## El atajo: pedírselo a Claude Code

Todo lo de arriba se puede pedir. Claude lee `CLAUDE.md` siempre y `knowledge/`
cuando lo necesita, así que ya conoce las trampas.

> *"Registrá el agente `<ApiName>` de la org `<alias>` y hacé el descubrimiento
> con 3 corridas."*
>
> *"Armá una batería de ruteo a partir del vocabulario. Preguntame lo que
> necesites sobre el negocio."*
>
> *"El caso S5 falla. ¿Es el agente o es la expectativa?"*

**Lo que Claude no va a hacer solo:** inventar consultas del negocio sin
contexto, ni deducir destinos leyendo el código del agente. Lo segundo está
prohibido en `CLAUDE.md`, por una razón medida tres veces.

---

## Antes de mostrarle el resultado a alguien

- ¿La versión de la corrida coincide con la activa? Si usaste el motor GA, **no
  se puede saber** — decilo en el informe.
- ¿Está anotada la versión de la CLI?
- ¿El censo dio completo?
- ¿Hay casos de seguridad? Corrélos **N veces, no una**. Medimos un fallo real de
  escalación que aparecía 1 de cada 4 corridas.
- ¿Estás mostrando el export crudo de Salesforce? **No lo hagas** — invierte el
  veredicto en los casos de seguridad. Ver `LIMITES.md` punto 8.
