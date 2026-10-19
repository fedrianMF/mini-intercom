# ADR 0004: Esquemas versionados en disco, JSON Schema y XSD

**Estado:** aceptada

## Contexto
Algunas entidades trabajan con XML y otras con JSON. Los formatos cambian con el tiempo y no todas las entidades migran a la vez.

## Decisión
Cada tipo de documento y versión tiene una carpeta con su JSON Schema y su XSD. El emisor declara `documentType`, `schemaVersion` y `format`. El hub valida todo el documento en la entrada y devuelve la lista completa de errores.

## Consecuencias
- Agregar una versión es agregar una carpeta y desplegar.
- Los dos esquemas de una misma versión deben mantenerse equivalentes; conviene una prueba que valide las mismas muestras en ambos formatos.
- La validación XSD corre en WebAssembly (libxml2), sin dependencias nativas en la imagen.
