import com.google.gson.GsonBuilder;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.sonar.duplications.block.Block;
import org.sonar.duplications.block.BlockChunker;
import org.sonar.duplications.detector.suffixtree.SuffixTreeCloneDetectionAlgorithm;
import org.sonar.duplications.index.CloneGroup;
import org.sonar.duplications.index.ClonePart;
import org.sonar.duplications.index.PackedMemoryCloneIndex;
import org.sonar.duplications.java.JavaStatementBuilder;
import org.sonar.duplications.java.JavaTokenProducer;

/** Local adapter; all tokenization, statement matching and clone detection use unmodified official Sonar code. */
public final class OfflineSonarCpd {
    private static final int JAVA_STATEMENTS = 10;
    private static final String RELEASE = "26.4.0.121862";
    private static final String COMMIT = "ab253503cc54df4bdfefd11eb783997d402b5147";

    record Source(String path, String text) {}
    record Prepared(Source source, int statements, List<Block> blocks) {}

    static List<Prepared> prepare(List<Source> sources, PackedMemoryCloneIndex index) {
        var prepared = new ArrayList<Prepared>();
        for (Source source : sources) {
            var tokens = JavaTokenProducer.build().chunk(new StringReader(source.text()));
            var statements = JavaStatementBuilder.build().chunk(tokens);
            var blocks = new BlockChunker(JAVA_STATEMENTS).chunk(source.path(), statements);
            blocks.forEach(index::insert);
            prepared.add(new Prepared(source, statements.size(), blocks));
        }
        return prepared;
    }

    static Map<String, Object> part(ClonePart part) {
        var result = new LinkedHashMap<String, Object>();
        result.put("file", part.getResourceId());
        result.put("startLine", part.getStartLine());
        result.put("endLine", part.getEndLine());
        result.put("startUnit", part.getUnitStart());
        return result;
    }

    static Map<String, Object> group(CloneGroup group) {
        var result = new LinkedHashMap<String, Object>();
        result.put("origin", part(group.getOriginPart()));
        result.put("cloneUnitLength", group.getCloneUnitLength());
        result.put("lengthInUnits", group.getLengthInUnits());
        result.put("parts", group.getCloneParts().stream().map(OfflineSonarCpd::part).toList());
        return result;
    }

    static String signature(CloneGroup group) {
        var parts = new TreeSet<String>();
        for (ClonePart part : group.getCloneParts()) {
            parts.add(part.getResourceId() + ":" + part.getUnitStart() + ":" + part.getStartLine() + ":" + part.getEndLine());
        }
        return group.getCloneUnitLength() + "|" + String.join("|", parts);
    }

    static List<CloneGroup> detect(List<Source> sources) {
        var index = new PackedMemoryCloneIndex();
        var prepared = prepare(sources, index);
        var all = new ArrayList<CloneGroup>();
        for (Prepared file : prepared) {
            all.addAll(SuffixTreeCloneDetectionAlgorithm.detect(index, file.blocks()));
        }
        return all;
    }

    static boolean hasCrossFile(List<CloneGroup> groups) {
        return groups.stream().anyMatch(group -> group.getCloneParts().stream().map(ClonePart::getResourceId).distinct().count() > 1);
    }

    static String statements(int count, String literalPrefix, boolean changeIdentifier) {
        var text = new StringBuilder();
        for (int i = 1; i <= count; i++) {
            text.append(changeIdentifier && i == 5 ? "differentCall" : "call" + i)
                    .append("(\"").append(literalPrefix).append(i).append("\");\n");
        }
        return text.toString();
    }

    static String javaFile(String className, String method, String statements) {
        return "class " + className + " {\nvoid " + method + "() {\n" + statements + "}\n}\n";
    }

    static Map<String, Object> controls() {
        var results = new LinkedHashMap<String, Object>();
        var nine = detect(List.of(
                new Source("NineA.java", javaFile("NineA", "first", statements(9, "A", false))),
                new Source("NineB.java", javaFile("NineB", "second", statements(9, "B", false)))));
        if (hasCrossFile(nine)) throw new AssertionError("Nine common statements must remain below Java threshold");
        results.put("nineCommonStatementsRejected", true);
        var ten = detect(List.of(
                new Source("TenA.java", javaFile("TenA", "first", statements(10, "same", false))),
                new Source("TenB.java", javaFile("TenB", "second", statements(10, "same", false)))));
        if (!hasCrossFile(ten)) throw new AssertionError("Ten common statements must detect cross-file duplication");
        results.put("tenCommonStatementsDetected", true);
        var normalized = detect(List.of(
                new Source("LiteralA.java", javaFile("LiteralA", "first", statements(10, "LEFT", false))),
                new Source("LiteralB.java", javaFile("LiteralB", "second", statements(10, "RIGHT", false)))));
        if (!hasCrossFile(normalized)) throw new AssertionError("Official literal normalization must detect cross-file duplication");
        results.put("differentStringLiteralsNormalized", true);
        var changed = detect(List.of(
                new Source("ChangedA.java", javaFile("ChangedA", "first", statements(10, "LEFT", false))),
                new Source("ChangedB.java", javaFile("ChangedB", "second", statements(10, "RIGHT", true)))));
        if (hasCrossFile(changed)) throw new AssertionError("Changed middle identifier must break ten-statement match");
        results.put("middleIdentifierChangeRejected", true);
        var whitespace = detect(List.of(
                new Source("WhitespaceA.java", javaFile("WhitespaceA", "first", statements(10, "A", false))),
                new Source("WhitespaceB.java", javaFile("WhitespaceB", "second", statements(10, "B", false).replace(";", "; /* comment */ ").replace("\n", " ")))));
        if (!hasCrossFile(whitespace)) throw new AssertionError("Whitespace/comments must not change duplication detection");
        results.put("whitespaceAndCommentsIgnored", true);
        results.put("tenStatementRawGroups", ten.stream().map(OfflineSonarCpd::group).toList());
        results.put("literalNormalizationRawGroups", normalized.stream().map(OfflineSonarCpd::group).toList());
        return results;
    }

    static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("baseDir inputList outputJson; inputList '-' means controls only");
        var report = new LinkedHashMap<String, Object>();
        report.put("adapter", "Official SonarQube duplication module compiled unmodified; official Java tokenizer/statement builder/block chunker/suffix-tree algorithm");
        report.put("release", RELEASE);
        report.put("officialCommit", COMMIT);
        report.put("javaRuntime", System.getProperty("java.runtime.version"));
        report.put("javaStatementBlockSize", JAVA_STATEMENTS);
        report.put("serverQualityGate", "not run; standalone official CPD core only");
        report.put("reportTruncation", "none; raw per-origin groups retained, unlike scanner report caps of 100 groups/100 references");
        report.put("controls", controls());
        var sources = new ArrayList<Source>();
        Path base = Path.of(args[0]).toAbsolutePath().normalize();
        if (!args[1].equals("-")) {
            for (String entry : Files.readAllLines(Path.of(args[1]), StandardCharsets.UTF_8)) {
                if (entry.isBlank()) continue;
                Path path = base.resolve(entry).normalize();
                if (!path.startsWith(base) || !Files.isRegularFile(path) || !entry.endsWith(".java")) throw new IllegalArgumentException("Invalid main input: " + entry);
                sources.add(new Source(entry.replace('\\', '/'), Files.readString(path, StandardCharsets.UTF_8)));
            }
        }
        var index = new PackedMemoryCloneIndex();
        var prepared = prepare(sources, index);
        var rows = new ArrayList<Map<String, Object>>();
        var unique = new LinkedHashMap<String, Map<String, Object>>();
        int rawGroupCount = 0;
        for (Prepared file : prepared) {
            Collection<CloneGroup> groups = SuffixTreeCloneDetectionAlgorithm.detect(index, file.blocks());
            var row = new LinkedHashMap<String, Object>();
            row.put("file", file.source().path());
            row.put("sha256", sha256(file.source().text().getBytes(StandardCharsets.UTF_8)));
            row.put("statements", file.statements());
            row.put("blocks", file.blocks().size());
            row.put("rawGroups", groups.stream().map(OfflineSonarCpd::group).toList());
            rows.add(row);
            rawGroupCount += groups.size();
            for (CloneGroup group : groups) unique.putIfAbsent(signature(group), group(group));
        }
        report.put("baseDir", base.toString());
        report.put("sourceFiles", sources.size());
        report.put("rawPerOriginGroupCount", rawGroupCount);
        report.put("uniqueExactEndpointGroupCount", unique.size());
        report.put("uniqueGroupDefinition", "Identical complete sorted endpoints and clone-unit length only; raw groups retained without merging overlapping ranges");
        report.put("files", rows);
        report.put("uniqueExactEndpointGroups", new ArrayList<>(unique.values()));
        Files.writeString(Path.of(args[2]), new GsonBuilder().setPrettyPrinting().create().toJson(report) + "\n", StandardCharsets.UTF_8);
        System.out.println("PASS controls=5 sourceFiles=" + sources.size() + " rawPerOriginGroups=" + rawGroupCount + " uniqueExactEndpointGroups=" + unique.size());
    }
}
