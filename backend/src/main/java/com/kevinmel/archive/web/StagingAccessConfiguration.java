package com.kevinmel.archive.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.Ordered;

import com.kevinmel.archive.security.SecurityErrorWriter;

/** Staging HTTPS/origin boundary with optional operator admission, separate from couple accounts. */
@Configuration(proxyBeanMethods = false)
@Profile("staging")
public class StagingAccessConfiguration {
    @Bean
    FilterRegistrationBean<StagingAccessFilter> stagingAccessFilter(
            @Value("${MEMORY_ARCHIVE_STAGING_BASIC_AUTH_ENABLED:true}") boolean basicAuthenticationEnabled,
            @Value("${MEMORY_ARCHIVE_STAGING_USERNAME:}") String username,
            @Value("${MEMORY_ARCHIVE_STAGING_PASSWORD:}") String password,
            @Value("${MEMORY_ARCHIVE_STAGING_ORIGIN:}") String origin,
            SecurityErrorWriter errors) {
        var filter = new StagingAccessFilter(basicAuthenticationEnabled, username, password, origin, errors);
        var registration = new FilterRegistrationBean<>(filter);
        // Render's trusted HTTPS forwarding is processed before this check.
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 20);
        registration.addUrlPatterns("/*");
        return registration;
    }
}
