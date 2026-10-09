package com.kevinmel.archive.security;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class AnonymousProtectionConfiguration {
    @Bean
    FilterRegistrationBean<AnonymousSubmissionFilter> anonymousSubmissionProtection(
            AnonymousThrottle throttle, SecurityErrorWriter errors) {
        var registration = new FilterRegistrationBean<>(new AnonymousSubmissionFilter(throttle, errors));
        // Spring Security (-100) and staging admission run first; MVC/body parsing runs afterwards.
        registration.setOrder(-90);
        registration.addUrlPatterns("/*");
        return registration;
    }
}
