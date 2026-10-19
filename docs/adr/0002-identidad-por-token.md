# ADR 0002: El origen de un documento sale del token

**Estado:** aceptada

## Contexto
Cada entidad envía documentos en nombre de su país. Si el país de origen viajara en el cuerpo, una entidad podría declarar otro.

## Decisión
Las entidades se autentican con OAuth 2.0 *client credentials* en Keycloak. Cada cliente tiene mapeos fijos que agregan `country` y `entity` al token, más la audiencia `intercom-hub`. El hub verifica el token con el JWKS de Keycloak y usa esos *claims* como origen. El cuerpo solo indica el destino.

## Consecuencias
- Suplantar a otra entidad exige robar su secreto; la rotación está documentada.
- Dar de alta una entidad es configuración en Keycloak, sin cambios de código.
- El hub depende de Keycloak solo para refrescar claves; los tokens se validan en local.
