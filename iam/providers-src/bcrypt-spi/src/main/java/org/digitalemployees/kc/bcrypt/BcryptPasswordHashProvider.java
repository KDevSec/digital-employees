package org.digitalemployees.kc.bcrypt;

import org.keycloak.credential.hash.PasswordHashProvider;
import org.keycloak.models.PasswordPolicy;
import org.keycloak.models.credential.PasswordCredentialModel;
import org.keycloak.models.credential.dto.PasswordSecretData;
import org.mindrot.jbcrypt.BCrypt;

/**
 * Reads Spring/standard BCrypt MCF ($2a$/$2b$/$2y$) hashes so agenthub users
 * can log in with their original password after a pre-hashed partialImport.
 */
public class BcryptPasswordHashProvider implements PasswordHashProvider {

    private static final int MIN_COST = 4;
    private static final int MAX_COST = 31;

    private final String providerId;
    private final int defaultCost;

    public BcryptPasswordHashProvider(String providerId, int defaultCost) {
        this.providerId = providerId;
        this.defaultCost = clamp(defaultCost);
    }

    private static int clamp(int cost) {
        if (cost < MIN_COST) return MIN_COST;
        if (cost > MAX_COST) return MAX_COST;
        return cost;
    }

    @Override
    public boolean policyCheck(PasswordPolicy policy, PasswordCredentialModel credential) {
        return credential != null
                && providerId.equals(credential.getPasswordCredentialData().getAlgorithm());
    }

    @Override
    public PasswordCredentialModel encodedCredential(String rawPassword, int iterations) {
        int cost = clamp(iterations);
        String hash = encode(rawPassword, cost);
        return PasswordCredentialModel.createFromValues(providerId, new byte[0], cost, hash);
    }

    @Override
    public String encode(String rawPassword, int iterations) {
        String pw = rawPassword == null ? "" : rawPassword;
        return BCrypt.hashpw(pw, BCrypt.gensalt(clamp(iterations)));
    }

    @Override
    public boolean verify(String rawPassword, PasswordCredentialModel credential) {
        if (rawPassword == null || credential == null) return false;
        PasswordSecretData secret = credential.getPasswordSecretData();
        if (secret == null) return false;
        String hash = normalize(secret.getValue());
        if (hash == null || !hash.startsWith("$2a$")) return false;
        try {
            return BCrypt.checkpw(rawPassword, hash);
        } catch (RuntimeException e) {
            return false;
        }
    }

    @Override
    public void close() {
    }

    private static String normalize(String hash) {
        if (hash == null) return null;
        if (hash.startsWith("$2b$") || hash.startsWith("$2y$")) {
            return "$2a$" + hash.substring(4);
        }
        return hash;
    }
}
