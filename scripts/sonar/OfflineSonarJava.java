import com.google.gson.GsonBuilder;
import com.google.gson.JsonParser;
import java.io.*;
import java.net.URI;
import java.nio.charset.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.stream.Stream;
import java.util.jar.JarFile;
import org.sonar.api.batch.fs.InputFile;
import org.sonar.api.batch.rule.ActiveRule;
import org.sonar.api.rule.RuleKey;
import org.sonarsource.sonarlint.core.analysis.api.*;
import org.sonarsource.sonarlint.core.analysis.container.global.GlobalAnalysisContainer;
import org.sonarsource.sonarlint.core.commons.api.SonarLanguage;
import org.sonarsource.sonarlint.core.commons.log.*;
import org.sonarsource.sonarlint.core.commons.progress.ProgressIndicator;
import org.sonarsource.sonarlint.core.commons.tracing.Trace;
import org.sonarsource.sonarlint.core.plugin.commons.*;

/** Local adapter to the exact installed SonarLint analysis engine; no server/client/backend. */
public class OfflineSonarJava {
    static String sha(Path path) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path)));
    }

    static Map<String, String> artifact(Path path) throws Exception {
        try (var jar = new JarFile(path.toFile())) {
            var attributes = jar.getManifest().getMainAttributes();
            Map<String, String> result = new TreeMap<>();
            result.put("path", path.toString());
            result.put("sha256", sha(path));
            result.put("implementationVersion", Objects.toString(attributes.getValue("Implementation-Version"), "unknown"));
            var component = jar.getEntry("META-INF/maven/org.sonarsource.sonarlint.core/sonarlint-analysis-engine/pom.properties");
            if (component != null) {
                Properties properties = new Properties();
                try (var input = jar.getInputStream(component)) { properties.load(input); }
                result.put("analysisEngineVersion", properties.getProperty("version"));
            }
            return result;
        }
    }

    static Map<String, String> ruleDefaults(ClassLoader loader, String check) throws Exception {
        Map<String, String> defaults = new TreeMap<>();
        for (var field : loader.loadClass("org.sonar.java.checks." + check).getDeclaredFields()) {
            for (var annotation : field.getDeclaredAnnotations()) {
                if (annotation.annotationType().getName().equals("org.sonar.check.RuleProperty")) {
                    defaults.put((String) annotation.annotationType().getMethod("key").invoke(annotation),
                            (String) annotation.annotationType().getMethod("defaultValue").invoke(annotation));
                }
            }
        }
        return defaults;
    }

    static String profile(Map<String, String> properties, String key, String fallback) {
        String value = properties.remove("offline.profile." + key);
        return value == null ? fallback : value;
    }

    static Map<String, String> ruleMetadata(Path plugin, String key) throws Exception {
        String resource = "org/sonar/l10n/java/rules/java/" + key + ".json";
        try (var jar = new JarFile(plugin.toFile()); var input = jar.getInputStream(jar.getJarEntry(resource))) {
            byte[] bytes = input.readAllBytes();
            var metadata = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
            if (!metadata.get("sqKey").getAsString().equals(key) || !metadata.get("scope").getAsString().equals("Main")) {
                throw new IllegalStateException("Unsupported installed rule identity/scope: " + key);
            }
            return Map.of("resource", resource, "sha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)),
                    "defaultSeverity", metadata.get("defaultSeverity").getAsString().toUpperCase(Locale.ROOT), "scope", "MAIN");
        }
    }

    static Map<String, Object> location(IssueLocation issue) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("file", issue.getInputFile() == null ? null : issue.getInputFile().relativePath());
        row.put("range", issue.getTextRange());
        row.put("message", issue.getMessage());
        return row;
    }

    record Rule(String key, Map<String, String> params, String severity) implements ActiveRule {
        public RuleKey ruleKey() { return RuleKey.of("java", key); }
        public String language() { return "java"; }
        public String param(String name) { return params.get(name); }
        public String internalKey() { return null; }
        public String templateRuleKey() { return null; }
        public String qpKey() { return "offline-explicit-three-rule-profile"; }
    }

    record Source(Path base, Path path, boolean isTest) implements ClientInputFile {
        public String getPath() { return path.toString(); }
        public Charset getCharset() { return StandardCharsets.UTF_8; }
        public SonarLanguage language() { return SonarLanguage.JAVA; }
        @SuppressWarnings("unchecked") public <G> G getClientObject() { return (G) path; }
        public InputStream inputStream() throws IOException { return Files.newInputStream(path); }
        public String contents() throws IOException { return Files.readString(path); }
        public String relativePath() { return base.relativize(path).toString().replace('\\', '/'); }
        public URI uri() { return path.toUri(); }
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 4) throw new IllegalArgumentException("extensionDir baseDir inputList outputJson [extra.properties]");
        Path extension = Path.of(args[0]).toAbsolutePath().normalize();
        Path base = Path.of(args[1]).toAbsolutePath().normalize();
        Path output = Path.of(args[3]).toAbsolutePath().normalize();
        Path work = output.getParent().resolve("work-" + output.getFileName().toString().replaceAll("[^A-Za-z0-9]", "_"));
        Files.createDirectories(work);
        List<ClientInputFile> files = new ArrayList<>();
        for (String supplied : Files.readAllLines(Path.of(args[2]))) {
            if (supplied.isBlank()) continue;
            Path path = base.resolve(supplied).normalize();
            if (!path.startsWith(base) || !Files.isRegularFile(path)) throw new IllegalArgumentException("Invalid input: " + supplied);
            files.add(new Source(base, path, path.toString().replace('\\', '/').contains("/src/test/")));
        }
        if (files.isEmpty() || files.stream().map(ClientInputFile::uri).distinct().count() != files.size()) {
            throw new IllegalArgumentException("Empty or duplicate input list");
        }
        Map<Path, String> inputHashes = new LinkedHashMap<>();
        for (ClientInputFile file : files) inputHashes.put(Path.of(file.uri()), sha(Path.of(file.uri())));
        Map<String, String> properties = new TreeMap<>();
        properties.put("sonar.java.source", "25");
        properties.put("sonar.java.jdkHome", System.getProperty("java.home"));
        properties.put("sonar.java.skipUnchanged", "false");
        if (args.length > 4) {
            Properties supplied = new Properties();
            try (var reader = Files.newBufferedReader(Path.of(args[4]))) { supplied.load(reader); }
            for (String name : supplied.stringPropertyNames()) properties.put(name, supplied.getProperty(name));
        }
        Map<String, Map<String, String>> metadata = new TreeMap<>();
        for (String key : List.of("S3776", "S1541", "S1192")) metadata.put(key, ruleMetadata(extension.resolve("analyzers/sonarjava.jar"), key));
        List<Rule> rules = List.of(
                new Rule("S3776", Map.of("Threshold", profile(properties, "cognitiveThreshold", "15")), metadata.get("S3776").get("defaultSeverity")),
                new Rule("S1541", Map.of("Threshold", profile(properties, "cyclomaticThreshold", "10")), metadata.get("S1541").get("defaultSeverity")),
                new Rule("S1192", Map.of("threshold", profile(properties, "literalThreshold", "3"), "minimalLength", "5", "excludePatterns", ""), metadata.get("S1192").get("defaultSeverity")));
        List<Map<String, Object>> issues = Collections.synchronizedList(new ArrayList<>());
        List<Map<String, String>> diagnostics = Collections.synchronizedList(new ArrayList<>());
        List<Map<String, Object>> progressEvents = Collections.synchronizedList(new ArrayList<>());
        SonarLintLogger.get().setTarget(new LogOutput() {
            @Override public void log(String message, Level level) {
                System.err.println(level + " " + message);
                diagnostics.add(Map.of("level", level.toString(), "message", message));
            }
            @Override public void log(String message, Level level, String stackTrace) {
                log(message + (stackTrace == null ? "" : "\n" + stackTrace), level);
            }
        });
        SonarLintLogger.get().setLevel(LogOutput.Level.DEBUG);
        ClientModuleFileSystem filesystem = new ClientModuleFileSystem() {
            public Stream<ClientInputFile> files() { return files.stream(); }
            public Stream<ClientInputFile> files(String language, InputFile.Type type) {
                return files.stream().filter(file -> (language == null || language.equals("java"))
                        && (type == null || file.isTest() == (type == InputFile.Type.TEST)));
            }
        };
        var pluginConfig = new PluginsLoader.Configuration(Set.of(extension.resolve("analyzers/sonarjava.jar")), Set.of(SonarLanguage.JAVA), false, Optional.empty());
        var pluginResult = new PluginsLoader().load(pluginConfig, Set.of());
        for (var check : pluginResult.getPluginCheckResultByKeys().entrySet()) {
            if (check.getValue().isSkipped()) throw new IllegalStateException("Plugin skipped: " + check.getKey() + " " + check.getValue().getSkipReason());
        }
        var loaded = pluginResult.getLoadedPlugins();
        if (!loaded.getAnalysisPluginInstancesByKeys().containsKey("java")) throw new IllegalStateException("Actual Java plugin not loaded");
        var pluginLoader = loaded.getAnalysisPluginInstancesByKeys().get("java").getClass().getClassLoader();
        var defaults = Map.of(
                "S3776", ruleDefaults(pluginLoader, "CognitiveComplexityMethodCheck"),
                "S1541", ruleDefaults(pluginLoader, "MethodComplexityCheck"),
                "S1192", ruleDefaults(pluginLoader, "StringLiteralDuplicatedCheck"));
        if (!defaults.get("S3776").equals(Map.of("Threshold", "15"))
                || !defaults.get("S1541").equals(Map.of("Threshold", "10"))
                || !defaults.get("S1192").equals(Map.of("threshold", "3", "minimalLength", "5", "excludePatterns", ""))) {
            throw new IllegalStateException("Installed rule metadata changed: " + defaults);
        }
        var config = AnalysisSchedulerConfiguration.builder().setWorkDir(work).setExtraProperties(properties)
                .setClientPid(ProcessHandle.current().pid()).setFileSystemProvider(key -> filesystem).build();
        var container = new GlobalAnalysisContainer(config, loaded);
        AnalysisResults results;
        try {
            container.startComponents();
            var analysis = AnalysisConfiguration.builder().setBaseDir(base).addInputFiles(files)
                    .putAllExtraProperties(properties).addActiveRules(rules).build();
            results = container.getModuleRegistry().getContainerFor("offline-java").analyze(analysis, issue -> {
                Map<String, Object> row = location(issue);
                row.put("rule", issue.getRuleKey().toString());
                row.put("severity", issue.getActiveRule().severity());
                row.put("flows", issue.flows().stream().map(flow -> flow.locations().stream().map(OfflineSonarJava::location).toList()).toList());
                row.put("quickFixes", issue.quickFixes().stream().map(fix -> Map.of("message", fix.message(), "edits",
                        fix.inputFileEdits().stream().map(edit -> Map.of("file", edit.target().relativePath(), "textEdits", edit.textEdits())).toList())).toList());
                row.put("overriddenImpacts", issue.getOverriddenImpacts());
                row.put("ruleDescriptionContextKey", issue.getRuleDescriptionContextKey().orElse(null));
                issues.add(row);
            }, new ProgressIndicator() {
                public void notifyProgress(String message, Integer progress) {
                    Map<String, Object> event = new LinkedHashMap<>();
                    event.put("message", message);
                    event.put("progress", progress);
                    progressEvents.add(event);
                }
                public boolean isCanceled() { return false; }
            }, Trace.begin("offline-java", "actual-sonarjava"));
        } finally {
            container.stopComponents();
            loaded.close();
        }
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("adapter", "Installed SonarLint core internal analysis containers; explicit local-only plugin load");
        report.put("javaRuntime", System.getProperty("java.runtime.version"));
        report.put("classpath", System.getProperty("java.class.path"));
        report.put("engineJarSha256", sha(extension.resolve("server/sonarlint-ls.jar")));
        report.put("pluginJarSha256", sha(extension.resolve("analyzers/sonarjava.jar")));
        report.put("engine", artifact(extension.resolve("server/sonarlint-ls.jar")));
        report.put("plugin", artifact(extension.resolve("analyzers/sonarjava.jar")));
        report.put("installedRuleDefaults", defaults);
        report.put("installedRuleMetadata", metadata);
        report.put("severityOrigin", "Default severity read from the exact installed plugin's rule JSON; no server profile is queried");
        report.put("selectedRuleScope", "MAIN only; TEST files are indexed/classified, not evaluated by these three main-source rules");
        report.put("cpd", "Unavailable: SonarLint uses NoOpNewCpdTokens; no duplicate-block clean claim");
        report.put("baseDir", base.toString());
        report.put("files", files.stream().map(ClientInputFile::relativePath).toList());
        report.put("mainInputCount", files.stream().filter(file -> !file.isTest()).count());
        report.put("testInputCount", files.stream().filter(ClientInputFile::isTest).count());
        List<Map<String, Object>> inputManifest = new ArrayList<>();
        for (ClientInputFile file : files) {
            Path path = Path.of(file.uri());
            if (!inputHashes.get(path).equals(sha(path))) throw new IllegalStateException("Input changed during analysis: " + file.relativePath());
            inputManifest.add(Map.of("file", file.relativePath(), "test", file.isTest(), "sha256", inputHashes.get(path)));
        }
        report.put("inputManifest", inputManifest);
        report.put("properties", properties);
        report.put("rules", rules);
        report.put("failedFiles", results.failedAnalysisFiles().stream().map(ClientInputFile::relativePath).toList());
        report.put("languageFileCount", results.languagePerFile().size());
        report.put("recognizedMainCount", results.languagePerFile().keySet().stream().filter(file -> !file.isTest()).count());
        report.put("recognizedTestCount", results.languagePerFile().keySet().stream().filter(ClientInputFile::isTest).count());
        report.put("recognizedFiles", results.languagePerFile().entrySet().stream().map(entry -> Map.of(
                "file", entry.getKey().relativePath(), "test", entry.getKey().isTest(), "language", entry.getValue().toString())).toList());
        report.put("analysisCoverageLimit", "Installed AnalysisResults exposes language recognition and failed files, not completed MAIN/TEST scan counts. File-by-file SonarLint sensor diagnostics/progress are retained without inventing completed counts; the selected rules apply to MAIN only.");
        report.put("issues", issues);
        report.put("diagnostics", diagnostics);
        report.put("progressEvents", progressEvents);
        Files.writeString(output, new GsonBuilder().setPrettyPrinting().create().toJson(report) + "\n");
        System.out.println("RESULT files=" + files.size() + " recognized=" + results.languagePerFile().size()
                + " failed=" + results.failedAnalysisFiles().size() + " issues=" + issues.size());
        if (!results.failedAnalysisFiles().isEmpty()) throw new IllegalStateException("Failed analysis files; inspect retained report");
        if (results.languagePerFile().size() != files.size()) throw new IllegalStateException("Not all inputs were recognized; inspect retained report");
        if (!results.languagePerFile().keySet().equals(new HashSet<>(files))
                || results.languagePerFile().values().stream().anyMatch(language -> language != SonarLanguage.JAVA)) {
            throw new IllegalStateException("Recognized Java input identities differ; inspect retained report");
        }
    }
}
