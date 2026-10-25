package com.kevinmel.archive.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.Console;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.io.Writer;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class AccountAdministrationConsoleTest {
    @Test void temporaryPasswordIsDeliveredOnlyToTheConsoleAfterConfirmedStoreCommitAndThenErased() {
        var console = mock(Console.class);
        var store = mock(AccountAdministrationStore.class);
        var committed = new AtomicBoolean();
        var captured = new AtomicReference<char[]>();
        var output = new StringWriter();
        var guardedWriter = new PrintWriter(new Writer() {
            public void write(char[] chars, int offset, int length) {
                if (!committed.get()) throw new AssertionError("Secret output preceded confirmed commit.");
                output.write(chars, offset, length);
            }
            public void flush() { }
            public void close() { }
        });
        when(console.writer()).thenReturn(guardedWriter);
        doAnswer(call -> {
            captured.set(call.getArgument(2));
            assertThat(captured.get().length).isEqualTo(32);
            committed.set(true);
            return null;
        }).when(store).createTemporary(eq("synthetic-couple"), eq("Synthetic Couple"), any(char[].class));
        AccountAdministration.createTemporary(console, store, "synthetic-couple", "Synthetic Couple");
        assertThat(output.toString().matches("Temporary password for synthetic-couple: [A-Za-z0-9_-]{32}\\R")).isTrue();
        assertThat(allErased(captured.get())).isTrue();
    }

    @Test void failedOrDuplicateCreationNeverAccessesTheConsoleWriterAndErasesGeneratedCharacters() {
        var console = mock(Console.class);
        var store = mock(AccountAdministrationStore.class);
        var captured = new AtomicReference<char[]>();
        doAnswer(call -> {
            captured.set(call.getArgument(2));
            throw new AccountAdministrationStore.RejectedOperation("Synthetic duplicate refusal.");
        }).when(store).createTemporary(eq("synthetic-couple"), eq("Synthetic Couple"), any(char[].class));
        assertThatThrownBy(() -> AccountAdministration.createTemporary(console, store, "synthetic-couple", "Synthetic Couple"))
                .isInstanceOf(AccountAdministrationStore.RejectedOperation.class);
        verify(console, never()).writer();
        assertThat(allErased(captured.get())).isTrue();
    }

    private static boolean allErased(char[] value) {
        if (value == null) return false;
        for (char c : value) if (c != '\0') return false;
        return true;
    }
}
