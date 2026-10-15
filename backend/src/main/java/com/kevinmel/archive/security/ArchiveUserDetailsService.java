package com.kevinmel.archive.security;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class ArchiveUserDetailsService implements UserDetailsService {

    private final ArchiveAccountRepository accountRepository;

    public ArchiveUserDetailsService(
            ArchiveAccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    @Override
    public UserDetails loadUserByUsername(String username)
            throws UsernameNotFoundException {

        ArchiveAccount account = accountRepository
                .findByUsername(username)
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));

        return new ArchivePrincipal(account);
    }
}