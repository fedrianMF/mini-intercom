# ADR 0001: Outbox transaccional para publicar documentos

**Estado:** aceptada

## Contexto
Al recibir un documento hay que guardarlo y publicarlo en el broker. Si se hacen como dos pasos independientes, una caída entre ambos deja un documento guardado que nunca se envía, o un mensaje enviado de un documento que no existe.

## Decisión
El documento, su primer evento y su mensaje de salida se escriben en la misma transacción de PostgreSQL. Un relay dentro del hub lee la tabla `outbox` con `FOR UPDATE SKIP LOCKED`, publica con confirmación del broker y marca el mensaje como publicado. Los fallos se reintentan con espera exponencial.

## Consecuencias
- Ningún documento aceptado se pierde, aunque RabbitMQ esté caído durante horas.
- La entrega es *al menos una vez*: el destino debe tolerar duplicados (el acuse es idempotente).
- Hay una latencia adicional de hasta un intervalo de sondeo (1 s por defecto).
