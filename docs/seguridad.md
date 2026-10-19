# Seguridad

## En el ciclo de desarrollo

| Control | Dónde |
|---|---|
| Análisis de dependencias (`npm audit`) que bloquea vulnerabilidades altas | CI, en cada servicio |
| Escaneo de secretos en el historial (Gitleaks) | CI |
| Escaneo de vulnerabilidades y malas configuraciones en código, Dockerfiles y chart (Trivy) | CI |
| Escaneo de las imágenes construidas | CI, antes de publicar |
| SBOM y procedencia firmada de cada imagen | CI (`docker/build-push-action`) |
| Análisis estático (SonarQube) | GitLab CI, cuando hay servidor configurado |
| Actualización automática de dependencias | Dependabot |

Ejemplo real de este repositorio: al ejecutar `npm audit` apareció una versión de Fastify con varias vulnerabilidades altas publicadas. Se actualizó a una versión corregida y se volvieron a correr las pruebas antes de continuar.

## Identidad y acceso

- Cada entidad es un cliente OAuth 2.0 confidencial con *client credentials*. No hay usuarios ni contraseñas humanas en el flujo.
- El hub valida firma (JWKS), emisor, audiencia `intercom-hub`, expiración y algoritmo.
- País y entidad salen de *claims* del token; el cuerpo de la petición no puede cambiarlos.
- Roles separados: `documents:send` para enviar y consultar, `documents:receive` para acusar.
- Un documento solo lo ven su origen y su destino; para cualquier otro país responde `404`, sin revelar que existe.
- Tokens de 5 minutos.

## Secretos y certificados

- En el repositorio solo hay credenciales de desarrollo, marcadas como tales.
- En Kubernetes los secretos vienen de la bóveda institucional mediante External Secrets, con refresco periódico para tomar rotaciones.
- TLS termina en el ingress o en el gateway con certificados gestionados (cert-manager o el certificado institucional), con fecha de vencimiento en el calendario.
- Rotación documentada en el [runbook](runbook.md#rotación-de-secretos).

## Endurecimiento

- Contenedores sin root, sin escalada de privilegios, sin capacidades y con sistema de archivos de solo lectura.
- `automountServiceAccountToken: false`: los pods no hablan con la API de Kubernetes.
- NetworkPolicy que niega por defecto el tráfico entrante y solo abre el puerto HTTP del hub.
- `/health` y `/metrics` no se publican en el gateway.
- El gateway limita peticiones por origen, también en el endpoint de tokens.
- Límite de tamaño de cuerpo (6 MB) y de longitud en cada campo de los esquemas.
- Logs sin la cabecera `Authorization`.

## Pendientes para un entorno real

- Firma digital de los documentos (XAdES para XML, JWS para JSON) y verificación en destino.
- mTLS entre entidades y gateway, además del token.
- Política de retención y depuración de documentos según la normativa aplicable.
