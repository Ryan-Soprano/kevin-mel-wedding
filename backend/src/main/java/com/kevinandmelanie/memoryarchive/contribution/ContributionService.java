package com.kevinandmelanie.memoryarchive.contribution;

import org.springframework.stereotype.Service;

@Service 
public class ContributionService {

    public ContributionRequest submit(ContributionRequest request) {
        String guestName = request.guestName() == null ? "" : request.guestName().trim();

        String message = request.message().trim();

        return new ContributionRequest(guestName, message);
    }
    
}
