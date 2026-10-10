package com.kevinmel.archive.album;

import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import com.kevinmel.archive.web.ApiException;

class AlbumContractTest {
    @Test void namesHaveTheSameUnicodeAndRawLengthRulesAsPrivateMetadata() {
        assertThat(AlbumRequest.name(Map.of("name","\u2003Our memories\u2003"))).isEqualTo("Our memories");
        assertThat(AlbumRequest.name(Map.of("name","x".repeat(200)))).hasSize(200);
        for(String value:new String[]{" ","x".repeat(201),"Invalid\u0000name","\ud800"})
            assertThatThrownBy(()->AlbumRequest.name(Map.of("name",value))).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->AlbumRequest.name(Map.of("name","Our memories","visibility","PUBLIC"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->AlbumRequest.name(null)).isInstanceOf(ApiException.class);
    }
    @Test void cursorKindsAndCanonicalRevisionDoNotCrossAlbumBoundaries() {
        UUID id=UUID.randomUUID(),revision=UUID.randomUUID();
        var cursor=AlbumCursor.members(id,revision,Long.MAX_VALUE);
        assertThat(AlbumCursor.decode(cursor.encode(),id)).isEqualTo(cursor);
        assertThatThrownBy(()->AlbumCursor.decode(cursor.encode(),UUID.randomUUID())).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->AlbumCursor.decode(cursor.encode(),null)).isInstanceOf(ApiException.class);
        var listing=AlbumCursor.listing(Instant.parse("2026-10-09T12:00:00.123456Z"),id);
        assertThat(AlbumCursor.decode(listing.encode(),null)).isEqualTo(listing);
        assertThatThrownBy(()->AlbumCursor.decode(listing.encode(),id)).isInstanceOf(ApiException.class);
        assertThat(AlbumRequest.revision("\""+revision+"\"")).isEqualTo(revision);
        assertThatThrownBy(()->AlbumRequest.revision(revision.toString())).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->AlbumRequest.revision("W/\""+revision+"\"")).isInstanceOf(ApiException.class);
    }
    @Test void pageSizeIsBoundedAndAbsentConditionsAreDistinct() {
        assertThat(AlbumQuery.from(null,null,null).limit()).isEqualTo(20);
        assertThat(AlbumQuery.from("50",null,null).limit()).isEqualTo(50);
        for(String value:new String[]{"0","51","9999","-1","1.5"})
            assertThatThrownBy(()->AlbumQuery.from(value,null,null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->AlbumRequest.createCondition(null)).isInstanceOf(ApiException.class).hasMessageContaining("condition");
        assertThatThrownBy(()->AlbumRequest.createCondition("\"anything\"")).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->AlbumRequest.direction(Map.of("direction","FIRST"))).isInstanceOf(ApiException.class);
    }
}
