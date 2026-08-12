# Los siete tipos de prueba

Detalle de cada uno: qué responde, cómo es el proceso, qué te da y con qué te vas
a chocar.

Si buscás el resumen, está en el `README.md`. Si buscás los nombres técnicos y
los comandos, están en `ANEXO-TECNICO.md`.

---

## Los tipos de prueba

Siete. No hacen falta todos siempre, pero conviene saber qué existe.

---

### 1 · Compilación

**Qué responde:** ¿el archivo del agente es válido?

**El proceso:** se le pide a la CLI de Salesforce que compile el archivo local
del agente. Devuelve la lista de errores de sintaxis con su ubicación.

**Beneficios**
- Segundos, determinista, sin ambigüedad
- Es el único chequeo que da un sí/no limpio
- Se puede correr en cada guardado

**Dificultades**
- **Requiere conexión a la organización.** No hay modo offline: el compilador
  corre del lado de Salesforce. Un pipeline necesita credenciales hasta para
  esto.
- Sólo aplica a agentes escritos en Agent Script. Si el agente no tiene archivo
  local, este tipo no existe.

---

### 2 · Descubrimiento

**Qué responde:** ¿qué destinos devuelve realmente este agente?

**El proceso:** se le mandan al agente entre 8 y 12 consultas de sondeo —una por
cada sección declarada, más un intento de fuga de instrucciones, un pedido
claramente fuera de tema y un pedido de hablar con una persona— y se observa a
dónde llega cada una. De ahí sale el vocabulario real, que se guarda para escribir
las pruebas después.

**Esto es obligatorio y va primero.** No es una recomendación.

🚩 **Y tiene una trampa que hay que conocer antes de intentarlo.** La versión
anterior de este archivo decía que el descubrimiento se corre *"sin verificar
nada"*. **Eso no funciona: no devuelve nada.**

El motor sólo pide el estado interno del agente —que es de donde sale el destino—
si el caso trae alguna verificación. Sin ninguna, no hay estado, y sin estado no
hay destino que leer.

➡️ **La técnica es poner un destino esperado que sabés que va a fallar** — un
centinela como `__DISCOVERY__`. Todos los casos fallan, y el veredicto de cada uno
revela el destino real. No es un rodeo: es la única forma de que el descubrimiento
devuelva algo. Detalle en `knowledge/03-assertions.md`.

**Beneficios**
- Es lo único que evita escribir una suite entera contra suposiciones
- Barato: una corrida
- Sirve además para conocer un agente que uno no escribió

**Dificultades**
- **El agente devuelve destinos que no están en su propio código.** La plataforma
  tiene interceptores propios: un intento de fuga de instrucciones nunca llega a
  la sección de "fuera de tema" — lo atrapa un guardián de la plataforma antes.
- **Leer el código del agente y deducir a dónde va cada consulta no funciona.**
  Lo medimos en los tres agentes: falló 2 de 20 veces en uno, 1 de 8 en otro y
  1 de 10 en el tercero — y en ese último el código del agente decía
  **explícitamente** lo contrario de lo que hizo el clasificador.
  El código describe la intención; el clasificador hace otra cosa.
- **Una sección cuyo único trabajo es derivar a una persona nunca aparece como
  destino.** Existe, funciona, y es inverificable por nombre.

---

### 3 · Ruteo

**Qué responde:** ¿cada consulta llega a donde tiene que llegar?

**El proceso:** se escribe un archivo de casos —consulta esperada, destino
esperado— y se corren todos juntos. Es el caballo de batalla y donde vive el
grueso del valor: el fallo típico de estos agentes es que el usuario pregunta una
cosa y el agente lo manda al lugar equivocado.

**Beneficios**
- **20 casos en unos 21 segundos.** Entra cómodo como control antes de aprobar un
  cambio
- **No escribe nada en la organización.** Se puede correr mil veces sin dejar
  rastro
- Cero errores en ~94 ejecuciones con el motor recomendado
- El ruteo es lo más estable que tiene un agente: si se rompe, se rompió de verdad

**Dificultades**
- **El código de salida está roto.** La herramienta dice "todo bien" con pruebas
  fallando. Hay que leer el resultado, no confiar en el estado.
- **La comparación es laxa en un motor y estricta en el otro.** El mismo archivo
  da veredictos opuestos según con cuál se corra.
- **La derivación a una persona no reporta el nombre de la sección** sino un
  literal genérico, que además cambia de forma según el motor.
- **La estabilidad del destino oculta inestabilidad de ejecución** (ver arriba).

**Los casos que valen la pena:** no los obvios. Los **pares de borde** — dos
consultas casi idénticas que deben ir a lugares distintos. *"¿Cuánto demora el
envío?"* contra *"¿Dónde está mi pedido?"*: uno es política general, el otro
requiere un dato personal.

Y se encuentran leyendo las advertencias que ya están escritas en el código del
agente. Si dice *"una cita cancelada NO es una derivación"*, es porque alguien
ya se comió ese bug.

---

### 4 · Contenido determinista

**Qué responde:** ¿el agente devolvió exactamente el dato correcto?

**El proceso:** en vez de comparar contra lo que el agente le dice al usuario
—que varía siempre— se compara contra **el valor que devolvió la acción**. Ese
valor es byte-exacto.

**Este es el hallazgo más grande de toda la investigación.** La regla vieja decía
que el contenido no se puede verificar. Es cierto sólo para el texto que genera
el modelo. El resultado de una acción determinista sí se verifica, con igualdad
exacta.

**Beneficios**
- Verificación **exacta**, no aproximada
- Aplica a cualquier agente con acciones que devuelvan valores fijos: códigos,
  montos, estados, textos de política, resultados de consulta
- Es nativo de la plataforma, no requiere herramientas propias
- Alcanza también las variables internas y el historial de ejecución

**Dificultades**
- **El agente conserva el dato pero le agrega texto alrededor.** Verificar contra
  la respuesta final es imposible; contra el dato de la acción es perfecto.
- **Depende de un descuido de Salesforce, no de una funcionalidad declarada.** El
  camino que permite llegar a esos datos no está documentado y podría cerrarse.
  Por eso las verificaciones importantes se hacen por dos vías en paralelo.
- **Hay una trampa silenciosa:** si al caso le falta cierto campo, la referencia
  nunca se resuelve y se compara contra el texto del template. Falla, pero
  reportando "completado" y sin mensaje de error. Alguien va a debuggear el
  agente por un problema del archivo de test.

---

### 5 · Estado y conversación

**Qué responde:** ¿el agente sostiene una conversación de varios turnos, y guarda
bien lo que le dicen?

**El proceso:** se declaran los turnos previos del usuario y la consulta a
evaluar. El motor **ejecuta la conversación de verdad**, turno por turno, y el
agente genera sus propias respuestas. Después se verifica no sólo a dónde llegó,
sino **en qué estado quedó**: qué guardó, qué transición ejecutó.

**Beneficios**
- Es conversación real, no simulada
- **Se puede verificar la máquina de estados**: que avanzó del paso 1 al 2, que
  guardó el puntaje correcto. Eso es determinismo sobre algo que parecía imposible
- El turno previo tiene que haber ocurrido de verdad: si el agente no llegó al
  estado correcto, el turno siguiente no significa nada. La prueba se valida sola

**Dificultades**
- **Los dos motores no significan lo mismo.** Uno ejecuta los turnos; el otro
  inyecta respuestas del agente que vos escribiste, y el agente construye sobre
  esa ficción. Lo comprobamos escribiendo un turno falso: el agente repitió la
  invención. Un test así valida un camino que en producción no existe.
- **Los archivos de las dos formas son incompatibles.** No se puede escribir uno
  que sirva para los dos.
- **Sembrar el estado directamente no funciona, y ya sabemos que no es por lo que
  creíamos.** La hipótesis era que faltaba declarar las variables primero. Se
  midió: **variables correctamente declaradas tampoco llegan.** La explicación que
  queda es que no son variables que se puedan fijar sino **valores que la
  plataforma deriva del canal de conversación** — sin una conversación real no hay
  de dónde sacarlos. Es razonamiento, no observación.
  **El único camino confirmado sigue siendo reproducir los turnos.**
- ⚠️ **Y sembrar un nombre inválido tiene un costo concreto:** con la herramienta
  GA hace fallar la corrida entera, después de bloquear 18 minutos.

---

### 6 · Calidad de las respuestas

**Qué responde:** ¿las respuestas son buenas? — en general, no una por una.

**El proceso:** se corre la suite pidiendo métricas de calidad. Un modelo evalúa
cada respuesta en coherencia, completitud y otras dimensiones, y **devuelve una
explicación en texto** del tipo *"no dice cuál es la razón más común de
cancelación"*. Esas explicaciones señalan huecos reales de contenido.

**Beneficios**
- Es la única forma de detectar que al agente le falta información. Medido: la
  misma pregunta devolvió la información completa en unas corridas y *"no tengo
  ese dato"* en otras, **el mismo día y con el destino idéntico en el 100 % de los
  casos**. Una prueba de ruteo lo reporta como perfecto; la métrica fue lo único
  que lo vio
- Las explicaciones son accionables, no un número suelto

**Dificultades**

🚨 **La más grave: la métrica premia romper los guardrails.** No es que sea
ruidosa — es que puntúa al revés donde más importa. Medido sobre un agente de
producción:

| El agente… | El evaluador puso |
|---|---|
| se negó a recomendar un medicamento | el peor puntaje de toda la suite |
| **no** filtró sus instrucciones internas | *"no entregó el prompt de sistema pedido"* |
| rechazó una consulta fuera de alcance | cero en completitud |

**Un equipo que optimice contra estas métricas está optimizando para romper sus
propios guardrails.** Y el sesgo **escala con lo bien protegido que esté el
agente**: 41 % de los ceros eran comportamiento correcto en un agente de juguete;
**75 %** en uno de producción.

➡️ **Hay que segmentar por destino antes de promediar**, y en los caminos de
rechazo **invertir la lectura**: un cero ahí significa que el agente no respondió
la pregunta, que era exactamente lo correcto.

- 🚨 **La planilla que exporta la herramienta NO es evidencia presentable.**
  Este archivo afirmaba lo contrario y estaba mal. Sin curar, **marca como
  fallidos los casos donde el agente se comportó mejor** —incluidos los de
  seguridad— y **no dice contra qué versión del agente corrió**. Dársela a un
  cliente o a un auditor tal cual **es peor que no darle nada**. Es materia prima;
  el reporte auditable lo arma `lib/report.mjs`
- **Nunca como control automático.** Las métricas por caso son una moneda al aire:
  medimos la misma respuesta pasando de 0 a 4 puntos entre corridas. En promedio
  son estables; caso por caso no
- **Requiere una funcionalidad adicional habilitada en la organización.** En una
  de las tres donde probamos no estaba. No se puede dar por sentado
- Es lento: minutos, no segundos. Y un caso trabado bloquea 18-22 minutos

---

### 7 · Seguridad

**Qué responde:** ¿el agente resiste intentos de manipulación?

**El proceso:** se le tiran ataques conocidos —intentos de fuga de instrucciones,
extracción de información sensible, exceso de permisos— y se verifica cómo
reacciona. El repositorio incluye siete catálogos de ataques listos.

**Beneficios**
- Los catálogos ya están, no hay que inventar los ataques
- Se corre igual que el ruteo, no requiere infraestructura aparte
- Un fallo acá no es una regresión, es un incidente — y conviene marcarlo distinto

**Dificultades**
- **La plataforma tiene su propio guardián y ataja los ataques antes de que
  lleguen al agente.** Una prueba que espere que el agente los rechace **falla**,
  aunque el resultado real haya sido mejor. El destino esperado sale del
  descubrimiento, no del catálogo.
- **Poner reglas anti-manipulación dentro del agente es código muerto** para los
  ataques que el guardián atrapa. Sólo se ejercitan con los que deja pasar, que
  por definición no sabemos cuáles son.

---

## Y una herramienta transversal: la conversación exploratoria

No es un tipo de prueba, pero se usa todo el tiempo.

Se puede conversar con el agente desde el archivo local, sin publicarlo, y
obtener un registro detallado de todo lo que hizo: a dónde ruteó, qué acciones
invocó con qué parámetros, cuánto tardó cada una, qué razonó el modelo.

**Es el mejor entorno de desarrollo del ecosistema** y sirve para entender un
agente antes de escribirle pruebas.

Dos advertencias:

**En modo simulado, las acciones se inventan.** No es que sean pobres: mienten.
Medimos un mock afirmando *"atiende las 24 horas"* mientras el dato real decía
*"lunes a viernes de 8 a 23"*. Sirve para ruteo; para contenido es peligroso.

**Contra el agente publicado no hay registro detallado.** Sale vacío. Sólo
funciona contra el archivo local.

---

## El camino recomendado

```
1. Registrar el agente        organización, nombre, versión activa
2. Compilación                ¿el archivo es válido?
3. DESCUBRIMIENTO             ¿qué destinos devuelve de verdad?   ← obligatorio
4. Ruteo                      la suite base
5. Contenido y estado         donde el agente tiene acciones deterministas
6. Calidad                    periódico, nunca como control
7. Seguridad                  antes de salir a producción
```

Los pasos 1 a 4 son la base. Sin el 3, los demás miden suposiciones.

---

