package com.kevinmel.archive.security;

import java.util.List;
import jakarta.servlet.DispatcherType;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.CompositeSessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.DelegatingSecurityContextRepository;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.csrf.InvalidCsrfTokenException;
import org.springframework.security.web.csrf.MissingCsrfTokenException;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;

@Configuration
public class SecurityConfiguration {

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    CsrfTokenRepository csrfTokenRepository() {
        var repository = new HttpSessionCsrfTokenRepository();
        repository.setHeaderName("X-CSRF-Token");
        return repository;
    }

    @Bean
    XorCsrfTokenRequestAttributeHandler csrfTokenRequestHandler() {
        return new XorCsrfTokenRequestAttributeHandler();
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new DelegatingSecurityContextRepository(
                new RequestAttributeSecurityContextRepository(), new HttpSessionSecurityContextRepository());
    }

    @Bean
    SessionAuthenticationStrategy sessionAuthenticationStrategy(
            CsrfTokenRepository tokens, XorCsrfTokenRequestAttributeHandler handler) {
        var csrf = new CsrfAuthenticationStrategy(tokens);
        csrf.setRequestHandler(handler);
        return new CompositeSessionAuthenticationStrategy(List.of(new ChangeSessionIdAuthenticationStrategy(), csrf));
    }

    @Bean
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    SecurityFilterChain securityFilterChain(HttpSecurity http, CsrfTokenRepository tokens,
            XorCsrfTokenRequestAttributeHandler handler, SecurityContextRepository contexts,
            ArchiveAccountRepository accounts, ArchiveAccessPolicy policy, SecurityErrorWriter errors) throws Exception {
        http.authorizeHttpRequests(authorize -> authorize
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                .requestMatchers(HttpMethod.GET, "/api/health", "/api/session", "/api/contributions/*/receipt").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/session", "/api/contributions",
                        "/api/contributions/*/memories/*/upload-grants", "/api/contributions/*/memories/*/finalize").permitAll()
                .requestMatchers(HttpMethod.DELETE, "/api/session").permitAll()
                .requestMatchers(HttpMethod.GET, "/", "/index.html", "/assets/**", "/favicon.ico").permitAll()
                .requestMatchers("/api/memories", "/api/memories/**").hasRole("COUPLE")
                .anyRequest().denyAll())
            .securityContext(context -> context.requireExplicitSave(true).securityContextRepository(contexts))
            .csrf(csrf -> csrf.csrfTokenRepository(tokens).csrfTokenRequestHandler(handler)
                    // Guest routes use independent same-origin, JSON and retry-capability checks.
                    .ignoringRequestMatchers("/api/contributions", "/api/contributions/*/memories/*/upload-grants",
                            "/api/contributions/*/memories/*/finalize"))
            .exceptionHandling(exceptions -> exceptions
                    .authenticationEntryPoint((request, response, exception) -> errors.write(request, response,
                            401, "AUTH_REQUIRED", "Please sign in to access the archive."))
                    .accessDeniedHandler((request, response, exception) -> {
                        boolean csrf = exception instanceof MissingCsrfTokenException || exception instanceof InvalidCsrfTokenException;
                        errors.write(request, response, 403, csrf ? "CSRF_INVALID" : "ARCHIVE_UNAVAILABLE",
                                csrf ? "Refresh your session before trying again." : "Archive access is unavailable.");
                    }))
            // Constructed here, rather than a servlet filter bean: this filter runs exactly once.
            .addFilterBefore(new SessionIdentityFilter(accounts, policy, errors, contexts), CsrfFilter.class)
            .formLogin(form -> form.disable())
            .httpBasic(basic -> basic.disable())
            .logout(logout -> logout.disable())
            .requestCache(cache -> cache.disable());
        return http.build();
    }
}
