package com.kevinmel.archive.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;

class ArchiveAccessPolicyTest {
    @Test void operatorAccessIsOffByDefaultAndRequiresTheExactNamedOperator() {
        for (boolean reveal : List.of(false, true)) {
            var closed = policy(reveal, "");
            assertAccess(closed, account("ryan-admin", "OPERATOR", true), false);
            var optedIn = policy(reveal, "ryan-admin");
            assertAccess(optedIn, account("ryan-admin", "OPERATOR", true), true);
            for (String other : List.of("ryan", "ryan-admin-other", "other-operator")) {
                assertAccess(optedIn, account(other, "OPERATOR", true), false);
            }
            assertAccess(optedIn, account("ryan-admin", "DEVELOPER", true), false);
            assertAccess(optedIn, account("ryan-admin", "OPERATOR", false), false);
            assertAccess(optedIn, account("ryan-admin", "COUPLE", true), false);
        }
    }

    @Test void productionCoupleRevealAndNamedIdentitiesAreUnchangedByOperatorOptIn() {
        for (String configured : List.of("", "ryan-admin")) {
            for (boolean reveal : List.of(false, true)) {
                var policy = policy(reveal, configured);
                assertAccess(policy, account("kevin", "COUPLE", true), reveal);
                assertAccess(policy, account("melanie", "COUPLE", true), reveal);
                assertAccess(policy, account("someone-else", "COUPLE", true), false);
                assertAccess(policy, account("kevin", "OPERATOR", true), false);
                assertAccess(policy, account("kevin", "DEVELOPER", true), false);
            }
        }
    }

    @Test void authenticationNeedsTheRealPrincipalAndItsMatchingAuthority() {
        var policy = policy(false, "ryan-admin");
        var principal = new ArchivePrincipal(account("ryan-admin", "OPERATOR", true));
        assertThat(policy.allows(UsernamePasswordAuthenticationToken.authenticated(principal, null,
                List.of(new SimpleGrantedAuthority("ROLE_COUPLE"))))).isFalse();
        assertThat(policy.allows(UsernamePasswordAuthenticationToken.unauthenticated(principal, "unused"))).isFalse();
        assertThat(policy.allows(new AnonymousAuthenticationToken("fixture", principal, principal.getAuthorities()))).isFalse();
        var generic = User.withUsername("ryan-admin").password("unused").roles("OPERATOR").build();
        assertThat(policy.allows(UsernamePasswordAuthenticationToken.authenticated(generic, null, generic.getAuthorities()))).isFalse();
    }

    @Test void malformedOrWildcardAdminConfigurationFailsStartupRatherThanBroadeningAccess() {
        for (String name : List.of("*", "ryan*", "RYAN-ADMIN", " ryan-admin", "ryan-admin ", "ry", "ryan\nadmin")) {
            assertThatThrownBy(() -> policy(false, name)).isInstanceOf(IllegalArgumentException.class);
        }
    }

    private static ArchiveAccessPolicy policy(boolean reveal, String operator) {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("production");
        return new ArchiveAccessPolicy("production", reveal, true, "https://archive.example", operator, environment);
    }
    private static ArchiveAccount account(String username, String role, boolean enabled) {
        return new ArchiveAccount(UUID.randomUUID(), username, "Synthetic Account", "{noop}unused", role, enabled, 1);
    }
    private static void assertAccess(ArchiveAccessPolicy policy, ArchiveAccount account, boolean allowed) {
        var principal = new ArchivePrincipal(account);
        assertThat(policy.allows(account)).isEqualTo(allowed);
        assertThat(policy.allows(principal)).isEqualTo(allowed);
        assertThat(policy.allows(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities())))
                .isEqualTo(allowed);
    }
}
