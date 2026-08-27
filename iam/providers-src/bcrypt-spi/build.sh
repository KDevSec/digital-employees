#!/bin/sh
# Rebuild the self-contained bcrypt PasswordHashProvider SPI for Keycloak 26.7.x.
# No Maven needed: compiles against Keycloak jars extracted from the running
# container, bundles org.mindrot:jbcrypt classes into one jar.
set -eu
KC_CNT="${KC_CNT:-digital-employees-v01-keycloak-1}"
OUT="${OUT:-../../providers/bcrypt-password-hash-spi.jar}"
WORK="$(mktemp -d)"; mkdir -p "$WORK/cp" "$WORK/build"
JARS="keycloak-common keycloak-core keycloak-server-spi keycloak-server-spi-private keycloak-services keycloak-model-storage-private keycloak-model-storage-services"
echo "Extracting Keycloak API jars from container '$KC_CNT'..."
for j in $JARS; do
  docker cp "$KC_CNT:/opt/keycloak/lib/lib/main/org.keycloak.${j}-26.7.2.jar" "$WORK/cp/" 2>/dev/null || true
done
echo "Fetching jBCrypt 0.4..."
curl -fsSL -o "$WORK/cp/jbcrypt-0.4.jar" https://repo1.maven.org/maven2/org/mindrot/jbcrypt/0.4/jbcrypt-0.4.jar
echo "Compiling..."
javac -cp "$WORK/cp/*" -d "$WORK/build" \
  src/main/java/org/digitalemployees/kc/bcrypt/*.java
(cd "$WORK/build" && jar xf "$WORK/cp/jbcrypt-0.4.jar")
mkdir -p "$WORK/build/META-INF/services"
cp src/main/resources/META-INF/services/org.keycloak.credential.hash.PasswordHashProviderFactory \
   "$WORK/build/META-INF/services/"
OUT="$(cd "$(dirname "$0")" && pwd)/$OUT"
jar cf "$OUT" -C "$WORK/build" .
echo "Built: $OUT"
