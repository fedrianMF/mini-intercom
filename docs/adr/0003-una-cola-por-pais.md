# ADR 0003: Una cola por país con reintentos y cola de mensajes muertos

**Estado:** aceptada

## Contexto
Los sistemas nacionales tienen disponibilidad distinta. La caída de uno no debe frenar el intercambio con los demás.

## Decisión
Un exchange *topic* `intercom.documents` enruta por `<país>.<tipo>` a una cola *quorum* por país. Ante un fallo transitorio, el adaptador republica en `intercom.retry`, cuya cola devuelve el mensaje tras un TTL. Al agotar los intentos lo publica en `intercom.dead`; el hub consume esa cola y marca el documento como `FAILED`.

## Consecuencias
- Un país caído acumula mensajes solo en su cola; los demás siguen.
- Los fallos definitivos son visibles: estado `FAILED`, motivo en la traza y alerta.
- El retardo de reintento es fijo; para esperas crecientes harían falta varias colas de retardo.
