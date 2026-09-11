package com.kevinandmelanie.memoryarchive.contribution;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ContributionRequest(
    @Size(max = 100, message = "Your name must be 100 characters or fewer.")
    String guestName,

    @NotBlank(message = "Please write a message before submitting.")
    @Size(max = 5000, message = "Your message must be 5000 characters or fewer.")
    String message
) {
}
