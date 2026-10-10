package com.kevinmel.archive.timeline;

import static org.assertj.core.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import com.kevinmel.archive.web.ApiException;

class TimelineContractTest {
    @Test void canonicalPartialDatesAndUtf16MetadataKeepTheirRealPrecision() {
        assertThat(TimelineRequest.from(body("\u2003Our milestone\u2003"," ","0001","YEAR")))
                .isEqualTo(new TimelineRequest("Our milestone",null,"0001","YEAR"));
        for(String[] date:List.of(new String[]{"2024-02-29","DAY"},new String[]{"9999-12","MONTH"},new String[]{null,"UNKNOWN"}))
            assertThat(TimelineRequest.from(body("x".repeat(200),"d".repeat(2000),date[0],date[1])).eventDate()).isEqualTo(date[0]);
        for(String[] date:List.of(new String[]{"0000","YEAR"},new String[]{"2023-02-29","DAY"},new String[]{"2024-2","MONTH"},new String[]{"2024","UNKNOWN"}))
            assertThatThrownBy(()->TimelineRequest.from(body("ok",null,date[0],date[1]))).isInstanceOf(ApiException.class);
        for(String title:new String[]{" ","x".repeat(201),"nul\0","\ud800"})
            assertThatThrownBy(()->TimelineRequest.from(body(title,null,null,"UNKNOWN"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineRequest.from(body("ok","x".repeat(2001),null,"UNKNOWN"))).isInstanceOf(ApiException.class);
        var unknown=body("ok",null,null,"UNKNOWN");unknown.put("visibility","PUBLIC");
        assertThatThrownBy(()->TimelineRequest.from(unknown)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineRequest.from(null)).isInstanceOf(ApiException.class);
    }
    @Test void cursorsBindKindsFiltersAndIdentitiesWithoutPrivateDates() {
        UUID event=UUID.randomUUID(),revision=UUID.randomUUID();
        var listing=TimelineCursor.listing(revision,event,"DAY",2024,2026);
        assertThat(TimelineQuery.listing("50",listing.encode(),"2024","2026","DAY").cursor()).isEqualTo(listing);
        assertThatThrownBy(()->TimelineQuery.listing(null,listing.encode(),"2024","2026","MONTH")).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineQuery.listing(null,listing.encode(),"2025","2026","DAY")).isInstanceOf(ApiException.class);
        UUID legacy=UUID.fromString("00000000-0000-1000-8000-000000000001");var member=TimelineCursor.members(event,revision,legacy);
        assertThat(TimelineQuery.members(event,null,member.encode()).cursor()).isEqualTo(member);
        assertThatThrownBy(()->TimelineQuery.members(UUID.randomUUID(),null,member.encode())).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineQuery.members(event,null,listing.encode())).isInstanceOf(ApiException.class);
        for(String cursor:List.of("",listing.encode()+"=",";DROP TABLE timeline_event;","x".repeat(257)))
            assertThatThrownBy(()->TimelineQuery.listing(null,cursor,null,null,null)).isInstanceOf(ApiException.class);
        assertThat(listing.toString()).doesNotContain(event.toString());
    }
    @Test void boundedFiltersAndStrongConditionsRejectAmbiguity() {
        assertThat(TimelineQuery.listing(null,null,null,null,null).limit()).isEqualTo(20);
        assertThat(TimelineQuery.listing("50",null,"0001","9999",null).fromYear()).isEqualTo(1);
        for(String size:List.of("0","51","-1","1.5"))assertThatThrownBy(()->TimelineQuery.listing(size,null,null,null,null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineQuery.listing(null,null,"2024",null,"UNKNOWN")).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineQuery.listing(null,null,"2025","2024",null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineQuery.requireParameters(Map.of("unknown",new String[]{"1"}),Set.of("limit"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineQuery.requireParameters(Map.of("limit",new String[]{"1","2"}),Set.of("limit"))).isInstanceOf(ApiException.class);
        UUID revision=UUID.randomUUID(); assertThat(TimelineRequest.revision("\""+revision+"\"")).isEqualTo(revision);
        assertThatThrownBy(()->TimelineRequest.revision(null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineRequest.revision("W/\""+revision+"\"")).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineRequest.createCondition(null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->TimelineRequest.createCondition("\"anything\"")).isInstanceOf(ApiException.class);
    }
    private static Map<String,Object> body(String title,String description,String date,String precision) {
        var result=new HashMap<String,Object>();result.put("title",title);result.put("description",description);result.put("eventDate",date);result.put("datePrecision",precision);return result;
    }
}
