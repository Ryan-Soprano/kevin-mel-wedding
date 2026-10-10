package com.kevinmel.archive.library;

import static org.assertj.core.api.Assertions.*;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import com.kevinmel.archive.web.ApiException;

class LibraryContractTest {
    @Test void boundedLiteralFiltersUseCanonicalValuesAndRejectAmbiguity() {
        var query=LibraryQuery.from(null,null," \u3000%_\\' Mixed ",null,null,null,"0001","9999",null);
        assertThat(query.limit()).isEqualTo(20); assertThat(query.q()).isEqualTo("%_\\' Mixed");
        assertThat(query.fromYear()).isEqualTo(1); assertThat(query.toYear()).isEqualTo(9999);
        assertThat(query.toString()).doesNotContain("Mixed"); assertThat(LibraryRequest.query("\u3000 \u00a0")).isNull();
        for(String size:new String[]{"0","51","-1","1.2","1000"}) assertThatThrownBy(()->LibraryRequest.limit(size)).isInstanceOf(ApiException.class);
        for(String q:new String[]{"x".repeat(201),"\uD83D\uDE03".repeat(100)+"x","a\0b","\uD800"})
            assertThatThrownBy(()->LibraryRequest.query(q)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryQuery.from(null,null,null,"toString",null,null,null,null,null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryQuery.from(null,null,null,null,"DELETE",null,null,null,null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryQuery.from(null,null,null,null,null,"UNKNOWN","2024",null,null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryQuery.from(null,null,null,null,null,null,"2025","2024",null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryQuery.from(null,null,null,null,null,null,"0",null,null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryRequest.parameters(Map.of("q",new String[]{"one","two"}),Set.of("q"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryRequest.parameters(Map.of("__proto__",new String[]{"one"}),Set.of("q"))).isInstanceOf(ApiException.class);
    }
    @Test void cursorsBindPageKindsFiltersAndLegacyMemoryIdentityWithoutPrivateText() {
        UUID tag=UUID.randomUUID(),revision=UUID.randomUUID(),legacy=UUID.fromString("00000000-0000-1000-8000-000000000001");
        String hash=LibraryCursor.fingerprint("Private % query","YEAR","2024");
        var cursor=new LibraryCursor("LIBRARY",hash,legacy,null,null); String encoded=cursor.encode();
        assertThat(LibraryCursor.decode(encoded,"LIBRARY",hash,null)).isEqualTo(cursor);
        assertThat(new String(java.util.Base64.getUrlDecoder().decode(encoded),java.nio.charset.StandardCharsets.UTF_8)).doesNotContain("Private","2024");
        assertThatThrownBy(()->LibraryCursor.decode(encoded,"TAGS",hash,null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryCursor.decode(encoded,"LIBRARY",LibraryCursor.fingerprint("changed"),null)).isInstanceOf(ApiException.class);
        var member=new LibraryCursor("MEMBERS",null,legacy,tag,revision);
        assertThat(LibraryCursor.decode(member.encode(),"MEMBERS",null,tag)).isEqualTo(member);
        assertThatThrownBy(()->LibraryCursor.decode(member.encode(),"MEMBERS",null,UUID.randomUUID())).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryCursor.decode(encoded+"=","LIBRARY",hash,null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryCursor.decode("x".repeat(257),"LIBRARY",hash,null)).isInstanceOf(ApiException.class);
        assertThat(LibraryCursor.fingerprint("a|b","c")).isNotEqualTo(LibraryCursor.fingerprint("a","b|c"));
        assertThat(LibraryCursor.fingerprint(null,"a")).isNotEqualTo(LibraryCursor.fingerprint("","a"));
    }
    @Test void tagNamesAndConditionsAreBoundedAndTerminalIdentitiesRemainV4() {
        UUID id=UUID.randomUUID(); assertThat(LibraryRequest.name(Map.of("name"," \u3000Synthetic tag\u00a0"))).isEqualTo("Synthetic tag");
        assertThat(LibraryRequest.name(Map.of("name","x".repeat(200)))).hasSize(200);
        for(Map<String,Object> body:java.util.List.of(Map.<String,Object>of(),Map.<String,Object>of("name"," "),Map.<String,Object>of("name","x","visibility","PUBLIC")))
            assertThatThrownBy(()->LibraryRequest.name(body)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryRequest.name(null)).isInstanceOf(ApiException.class);
        assertThat(LibraryRequest.revision("\""+id+"\"")).isEqualTo(id);
        assertThatThrownBy(()->LibraryRequest.revision(null)).isInstanceOfSatisfying(ApiException.class,error->assertThat(error.status()).isEqualTo(428));
        assertThatThrownBy(()->LibraryRequest.revision("W/\""+id+"\"")).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryRequest.tagId(UUID.fromString("00000000-0000-1000-8000-000000000001"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->LibraryRequest.createCondition(null)).isInstanceOfSatisfying(ApiException.class,error->assertThat(error.status()).isEqualTo(428));
    }
}
