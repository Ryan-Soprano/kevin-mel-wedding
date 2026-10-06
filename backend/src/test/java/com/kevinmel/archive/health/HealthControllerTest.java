package com.kevinmel.archive.health;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.kevinmel.archive.security.SecurityConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import com.kevinmel.archive.security.ArchiveAccessPolicy;
import com.kevinmel.archive.security.ArchiveAccountRepository;
import com.kevinmel.archive.security.SecurityErrorWriter;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(HealthController.class)
@Import({SecurityConfiguration.class, ArchiveAccessPolicy.class, SecurityErrorWriter.class})
class HealthControllerTest {

    @MockitoBean
    ArchiveAccountRepository accounts;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void returnsOkStatusAsJson() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.status").value("ok"));
    }
}
