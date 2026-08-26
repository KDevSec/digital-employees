package org.digitalemployees.kc.bcrypt;

import org.keycloak.Config;
import org.keycloak.credential.hash.PasswordHashProvider;
import org.keycloak.credential.hash.PasswordHashProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

public class BcryptPasswordHashProviderFactory implements PasswordHashProviderFactory {

    public static final String ID = "bcrypt";
    public static final int DEFAULT_COST = 12;

    private int defaultCost = DEFAULT_COST;

    @Override
    public PasswordHashProvider create(KeycloakSession session) {
        return new BcryptPasswordHashProvider(ID, defaultCost);
    }

    @Override
    public void init(Config.Scope scope) {
        if (scope == null) return;
        Integer cost = scope.getInt("cost", DEFAULT_COST);
        if (cost != null) {
            defaultCost = cost;
        }
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
    }

    @Override
    public void close() {
    }

    @Override
    public String getId() {
        return ID;
    }
}
