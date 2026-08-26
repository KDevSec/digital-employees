# bcrypt PasswordHashProvider SPI (Keycloak 26.7.x)

Self-contained custom provider so Keycloak can verify Spring `BCryptPasswordEncoder`
MCF hashes (`$2a$`/`$2b$`/`$2y$`) imported via `partialImport` (pre-hashed credential,
`algorithm="bcrypt"`). Shipped as `iam/providers/bcrypt-password-hash-spi.jar`,
mounted into the container at `/opt/keycloak/providers` via `tools/compose.yml`.

- Provider id: `bcrypt` (cost read from the MCF, default 12).
- Bundles `org.mindrot:jbcrypt 0.4` (no extra classpath needed).
- `verify()` normalizes `$2b$`/`$2y$` -> `$2a$` before `BCrypt.checkpw`.

## Rebuild
```sh
# from this directory (container running, docker reachable, network for jBCrypt)
./build.sh                         # -> ../../providers/bcrypt-password-hash-spi.jar
# then restart keycloak to reload: ./tools/compose.sh up -d keycloak
```

## Realm config
digital-employees realm `passwordPolicy` = `hashAlgorithm(bcrypt) and hashIterations(12)`
(Authentication > Password hashing = bcrypt). Verification of imported credentials
works as soon as the SPI is registered, regardless of the realm default.
