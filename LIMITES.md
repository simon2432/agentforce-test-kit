# Lo que este repo NO sabe

Esta página está al frente a propósito. Todo lo demás describe lo que sí
funciona; acá está lo que puede hacerte tomar una decisión equivocada.

Nada de esto está resuelto. Está **identificado**, que no es lo mismo.

---

## 1 · La capacidad más valiosa depende de un comando BETA sin segunda fuente

Verificar **contenido y estado** —lo mejor que encontramos, y lo que hace que
esto sea testing de verdad y no sólo verificación de ruteo— funciona únicamente
en `sf agent test run-eval`.

Ese comando está marcado BETA por Salesforce, y su propia ayuda dice que
*"cualquier aspecto de este comando puede cambiar sin aviso previo"*.

Probamos si el motor estable (GA) podía hacer lo mismo. **No puede:** las cinco
referencias que probamos devolvieron el texto de la plantilla en vez del valor
real. No hay plan B.

Y la técnica se apoya en una línea del código del plugin que **no está
documentada como característica**. Funciona en las tres versiones que revisamos.
Si Salesforce decide restringirla, no queda ningún camino equivalente.

**Qué hacer:** `npm run doctor` registra la versión de la CLI en cada corrida. Si
cambia y algo empieza a fallar, esta es la primera sospecha.

---

## 2 · Todo se midió sobre el mismo tipo de agente

Tres agentes, tres organizaciones — pero los tres del mismo tipo, sobre la misma
plantilla, y los tres escritos en Agent Script.

**Fuera de alcance por decisión:** los **agentes clásicos**, sin Agent Script.
Este repo es sólo para Agent Script y no pretende otra cosa. No tiene sentido
leerlo como una limitación pendiente.

**Nunca se probó en:**

- **Otros tipos de agente** — de empleado, o hechos a medida. Pueden tener otro
  vocabulario de variables y otro comportamiento de escalación. **Es el hueco de
  alcance más grande que queda.**

  ⚠️ Ojo con confundir los dos ejes: **un Employee Agent puede estar escrito en
  Agent Script perfectamente.** Que el repo sea sólo para Agent Script no cubre
  este hueco.
- **Agentes con más de 5 subagentes**, o con **cadenas de acciones de varios
  pasos**. La forma de verificar la secuencia de acciones existe y funciona, pero
  la cadena más larga que medimos tiene 2 pasos.
- **Una organización de producción de verdad.** Tres sandboxes. La tercera tenía
  datos y automatizaciones reales, que es lo más cerca que estuvimos.

---

## 3 · Hay una mitad del comportamiento que nunca observamos

**Todas las mediciones se hicieron dentro del horario de atención.**

Los agentes que escalan a un humano se comportan distinto fuera de horario. El
resultado de una prueba de escalación **puede depender de la hora a la que la
corras**, y esa rama no la vimos nunca.

Si armás una batería que corre de noche automáticamente, este es el primer lugar
donde va a fallar — y va a parecer una regresión del agente.

---

## 4 · No sabemos por qué una técnica no funciona

Pasar datos de contexto a la conversación (quién es el cliente, de qué caso
viene) **no funciona en ninguno de los dos motores**. Está medido dos veces, con
el mismo resultado.

Lo que sí sabemos: la CLI arma el pedido perfectamente y el runtime lo descarta.
Lo que **no** sabemos es por qué. Nuestra mejor explicación es que esos valores
no se envían sino que la plataforma los deriva de la sesión de canal real — que
ningún motor de prueba crea. Explica todo lo observado, pero es **razonamiento,
no observación**, y cerrarlo requiere una sesión de mensajería de verdad.

**Consecuencia práctica:** si tu agente depende de datos de contexto para
funcionar, hoy no se puede testear ese camino. Y eso mismo es la razón por la que
testear es seguro (ver punto 6).

---

## 5 · Hay cosas que la plataforma no puede reportar, y punto

| No se puede | Detalle |
|---|---|
| Saber contra qué versión corrió, con el motor GA | Ni en su salida, ni en lo que despliega, ni en el export. **La regla más importante del repo sólo se puede cumplir con el motor BETA** |
| Detectar acciones **inesperadas** | La plataforma sólo detecta las que faltan. Si el agente hace algo de más, no se entera nadie |
| Testear antes de publicar | Los dos motores corren contra el agente publicado |
| Ver la conversación completa en la salida del motor GA | Sólo devuelve el último turno |

Ninguna de estas se puede resolver desde este repo. La primera es la más grave:
un resultado del motor GA **no es auditable** en el eje de versión, y el informe
lo dice en vez de taparlo.

---

## 6 · Por qué testear es seguro — y el único modo de romperlo

**~430 ejecuciones, 0 registros de negocio modificados.** Incluido el peor caso
que pudimos armar: 14 escalaciones seguidas contra una organización con colas de
atención reales y automatizaciones que escriben de verdad.

El mecanismo está entendido, no es suerte: **las acciones reciben identificadores
vacíos, no encuentran ningún registro, y modifican cero filas.** Es exactamente
la limitación del punto 4, vista del lado bueno.

🚨 **Y hay exactamente una forma de romperlo: poner un identificador real en la
configuración de una prueba.** Un `RoutableId`, un `CaseId`, el id de una sesión.
Con eso las automatizaciones sí encuentran el registro, y sí lo modifican.

`lib/gen-spec.mjs` tiene una guarda que rechaza esos valores. **No confíes sólo
en la guarda: no pongas identificadores reales.**

---

## 7 · La capa que corrige los errores de la plataforma también tuvo errores

En la tercera ronda encontramos **tres bugs en `lib/assert.mjs`** — la utilidad
que existe precisamente para corregir los defectos de la plataforma. Los tres
eran falsos negativos: marcaban como roto algo que estaba bien.

La capa en la que más confiábamos era la única sin pruebas propias. Ahora tiene
54. **El punto no es que estén arreglados; es que aparecieron recién en la
tercera ronda de uso.**

---

## 8 · Y el sesgo que invierte el veredicto

Las métricas de calidad de Salesforce **premian que el agente rompa sus propias
protecciones.**

Medido: le pusieron el peor puntaje de toda la batería al caso en que el agente
se negó correctamente a recomendar un medicamento, y penalizaron a otro agente
por **no** filtrar su configuración interna cuando se la pidieron.

El sesgo **escala con lo bien protegido que esté el agente**: cuanto mejor se
defiende, peor puntaje saca.

Por eso el export de Salesforce **no sirve como evidencia tal cual viene**.
`lib/report.mjs` invierte la lectura en los caminos de rechazo y marca los casos
de seguridad aparte. Si presentás el CSV crudo a un auditor, estás presentando el
veredicto al revés.

---

## Cómo se usa esta página

Antes de apoyar una decisión en un resultado de este repo, preguntá:

1. ¿Mi agente es Agent Script, del mismo tipo que los medidos? → punto 2
2. ¿Estoy usando el motor BETA? Si no, el resultado no es auditable en versión → punto 5
3. ¿Hay casos de escalación y esto corre de noche? → punto 3
4. ¿Estoy mostrando el export crudo de Salesforce? → punto 8
5. ¿Hay algún identificador real en mis archivos de prueba? → punto 6

El detalle técnico de cada uno, con evidencia y nivel de confianza, está en
[`knowledge/06-open-questions.md`](knowledge/06-open-questions.md).
