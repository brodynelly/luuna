//! M5 stack profiles: one synthetic fixture repository per advertised profile,
//! generated in a temporary directory, discovered with the real host probe.
//! Discovery never executes repository text, so each fixture's scripts carry a
//! marker command whose side effect must not appear. Capability annotations
//! are asserted against the probe itself, so the tests pass whether or not
//! `go`, `flutter`, a JDK or Xcode are installed on the host that runs them.
use luuna_discovery::{
    capabilities::{probe_host_cached, python_executable},
    discover, DiscoveryRequest, RepositoryInput,
};
use luuna_domain::{
    CapabilityStatus, Confidence, DirtyState, Discovery, HostCapabilities, ProposedCheck,
    RepositoryIdentity, RepositoryObservation,
};
use std::{fs, path::Path};

fn observation(path: &Path) -> RepositoryObservation {
    RepositoryObservation {
        local_path: path.display().to_string(),
        identity: RepositoryIdentity {
            remote: Some("https://example.invalid/fixture.git".into()),
            push_remote: None,
            root_commits: vec!["c".repeat(40)],
            shallow: false,
        },
        head_commit: "d".repeat(40),
        branch: Some("main".into()),
        remote_default_branch: None,
        local_branches: vec!["main".into()],
        dirty: DirtyState::default(),
        git_version: "git version 2.55.0".into(),
        observed_at: "2026-10-21T00:00:00.000Z".into(),
    }
}

fn discover_fixture(root: &Path, host: &HostCapabilities) -> Discovery {
    discover(DiscoveryRequest {
        id: "discovery-1".into(),
        project_id: "fixture".into(),
        project_name: "Fixture".into(),
        manifest_revision: 1,
        created_at: "2026-10-21T00:00:00.000Z".into(),
        repositories: vec![RepositoryInput {
            repository_id: "app".into(),
            root: root.to_path_buf(),
            observation: observation(root),
        }],
        host_capabilities: Some(host.clone()),
    })
    .unwrap()
}

fn check<'a>(discovery: &'a Discovery, id: &str) -> &'a ProposedCheck {
    discovery.repositories[0]
        .proposed_checks
        .iter()
        .find(|c| c.check.id == id)
        .unwrap_or_else(|| {
            panic!(
                "{id} not proposed; proposed: {:?}",
                discovery.repositories[0]
                    .proposed_checks
                    .iter()
                    .map(|c| c.check.id.as_str())
                    .collect::<Vec<_>>()
            )
        })
}

/// Every annotation agrees with the probe: `available` means no missing
/// tool, `missing` names tools the probe recorded missing, and each missing
/// tool has a question naming an install step. Nothing is dropped.
fn assert_annotation_matches_probe(discovery: &Discovery, host: &HostCapabilities) {
    assert_eq!(discovery.host_capabilities.as_ref(), Some(host));
    for proposed in &discovery.repositories[0].proposed_checks {
        match proposed.capability {
            Some(CapabilityStatus::Available) => {
                assert!(proposed.missing_tools.is_empty(), "{}", proposed.check.id)
            }
            Some(CapabilityStatus::Missing) => {
                assert!(!proposed.missing_tools.is_empty(), "{}", proposed.check.id);
                for tool in &proposed.missing_tools {
                    if !tool.starts_with("./") {
                        assert!(!host.available(tool), "{tool} is available on this host");
                    }
                    let question = discovery
                        .questions
                        .iter()
                        .find(|q| {
                            q.topic == "missing-tool" && q.detail.contains(&format!("`{tool}`"))
                        })
                        .unwrap_or_else(|| panic!("no question for {tool}"));
                    assert!(question.detail.contains(&proposed.check.id));
                    assert!(question.detail.contains("blocked"));
                }
            }
            None => panic!("{} was not annotated", proposed.check.id),
        }
    }
}

fn expect_capability(host: &HostCapabilities, proposed: &ProposedCheck, tools: &[&str]) {
    let expected = if tools.iter().all(|t| host.available(t)) {
        CapabilityStatus::Available
    } else {
        CapabilityStatus::Missing
    };
    assert_eq!(
        proposed.capability,
        Some(expected),
        "{}: {:?}",
        proposed.check.id,
        proposed.missing_tools
    );
}

#[test]
fn nextjs_typescript_profile_proposes_test_typecheck_and_build_from_scripts() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("executed");
    let package = serde_json::json!({
        "name": "web",
        "scripts": {
            "test": format!("touch {} && vitest run", marker.display()),
            "typecheck": "tsc --noEmit",
            "build": "next build",
            "lint": "next lint",
        },
        "dependencies": {"next": "15.0.0", "react": "19.0.0", "react-dom": "19.0.0"},
    });
    fs::write(dir.path().join("package.json"), package.to_string()).unwrap();
    fs::write(dir.path().join("package-lock.json"), "{}").unwrap();
    fs::write(dir.path().join("tsconfig.json"), "{}").unwrap();
    let host = probe_host_cached();
    let discovery = discover_fixture(dir.path(), &host);
    assert!(!marker.exists(), "discovery must never run repository text");
    let repo = &discovery.repositories[0];
    assert_eq!(repo.profiles, vec!["node", "typescript", "nextjs"]);
    assert!(repo
        .evidence
        .iter()
        .any(|e| e == "app:package.json#scripts.test runner = vitest"));
    let test = check(&discovery, "npm-test");
    assert_eq!(test.check.args, vec!["test"]);
    assert!(test.check.required);
    assert_eq!(test.confidence, Confidence::Observed);
    assert_eq!(
        check(&discovery, "npm-typecheck").check.args,
        vec!["run", "typecheck"]
    );
    assert_eq!(
        check(&discovery, "npm-build").check.args,
        vec!["run", "build"]
    );
    assert_eq!(
        check(&discovery, "npm-lint").check.args,
        vec!["run", "lint"]
    );
    for id in ["npm-test", "npm-typecheck", "npm-build", "npm-lint"] {
        expect_capability(&host, check(&discovery, id), &["node", "npm"]);
    }
    assert_annotation_matches_probe(&discovery, &host);
}

#[test]
fn react_and_node_profiles_name_their_runners() {
    let host = probe_host_cached();
    let react = tempfile::tempdir().unwrap();
    fs::write(
        react.path().join("package.json"),
        r#"{"scripts":{"test":"jest --ci","build":"vite build"},"dependencies":{"react":"19.0.0"}}"#,
    )
    .unwrap();
    fs::write(react.path().join("pnpm-lock.yaml"), "").unwrap();
    let discovery = discover_fixture(react.path(), &host);
    assert_eq!(discovery.repositories[0].profiles, vec!["node", "react"]);
    assert!(discovery.repositories[0]
        .evidence
        .iter()
        .any(|e| e.ends_with("runner = jest")));
    let test = check(&discovery, "pnpm-test");
    assert_eq!(test.check.executable, "pnpm");
    expect_capability(&host, test, &["node", "pnpm"]);
    assert_annotation_matches_probe(&discovery, &host);

    let node = tempfile::tempdir().unwrap();
    fs::write(
        node.path().join("package.json"),
        r#"{"name":"svc","scripts":{"test":"node --test"}}"#,
    )
    .unwrap();
    fs::write(node.path().join("package-lock.json"), "{}").unwrap();
    let discovery = discover_fixture(node.path(), &host);
    assert_eq!(discovery.repositories[0].profiles, vec!["node"]);
    assert!(discovery.repositories[0]
        .evidence
        .iter()
        .any(|e| e.ends_with("runner = node --test")));
    expect_capability(&host, check(&discovery, "npm-test"), &["node", "npm"]);
    assert_annotation_matches_probe(&discovery, &host);
}

#[test]
fn go_profile_proposes_test_and_vet() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("go.mod"),
        "module example.invalid/svc\n\ngo 1.22\n",
    )
    .unwrap();
    let host = probe_host_cached();
    let discovery = discover_fixture(dir.path(), &host);
    assert_eq!(discovery.repositories[0].profiles, vec!["go"]);
    let test = check(&discovery, "go-test");
    assert_eq!(test.check.args, vec!["test", "./..."]);
    assert!(test.check.required);
    let vet = check(&discovery, "go-vet");
    assert_eq!(vet.check.args, vec!["vet", "./..."]);
    assert!(!vet.check.required);
    expect_capability(&host, test, &["go"]);
    expect_capability(&host, vet, &["go"]);
    assert_annotation_matches_probe(&discovery, &host);
}

#[test]
fn python_profile_uses_pytest_when_configured_and_unittest_otherwise() {
    let host = probe_host_cached();
    let interpreter = python_executable(Some(&host));
    let configured = tempfile::tempdir().unwrap();
    fs::write(
        configured.path().join("pyproject.toml"),
        "[project]\nname = \"svc\"\n\n[tool.pytest.ini_options]\ntestpaths = [\"tests\"]\n\n[tool.ruff]\nline-length = 100\n\n[tool.mypy]\nstrict = true\n",
    )
    .unwrap();
    fs::create_dir(configured.path().join("tests")).unwrap();
    let discovery = discover_fixture(configured.path(), &host);
    assert_eq!(discovery.repositories[0].profiles, vec!["python"]);
    let pytest = check(&discovery, "pytest");
    assert_eq!(pytest.check.executable, interpreter);
    assert_eq!(pytest.check.args, vec!["-m", "pytest", "-q"]);
    assert!(pytest.check.required);
    expect_capability(&host, pytest, &[interpreter, "pytest"]);
    let ruff = check(&discovery, "ruff");
    assert_eq!(ruff.check.args, vec!["check", "."]);
    assert!(!ruff.check.required);
    assert_eq!(ruff.confidence, Confidence::Observed);
    expect_capability(&host, ruff, &[interpreter, "ruff"]);
    let mypy = check(&discovery, "mypy");
    assert!(!mypy.check.required);
    expect_capability(&host, mypy, &[interpreter, "mypy"]);
    assert!(discovery.repositories[0]
        .proposed_checks
        .iter()
        .all(|c| c.check.id != "unittest"));
    assert_annotation_matches_probe(&discovery, &host);

    let plain = tempfile::tempdir().unwrap();
    fs::write(
        plain.path().join("pyproject.toml"),
        "[project]\nname = \"svc\"\nversion = \"0.1.0\"\n",
    )
    .unwrap();
    fs::create_dir(plain.path().join("tests")).unwrap();
    fs::write(plain.path().join("tests").join("__init__.py"), "").unwrap();
    let discovery = discover_fixture(plain.path(), &host);
    let unittest = check(&discovery, "unittest");
    assert_eq!(unittest.check.executable, interpreter);
    assert_eq!(unittest.check.args, vec!["-m", "unittest", "-v"]);
    assert!(unittest.check.required);
    assert_eq!(unittest.check.capabilities, vec!["python"]);
    expect_capability(&host, unittest, &[interpreter]);
    assert!(discovery
        .questions
        .iter()
        .any(|q| q.topic == "python-tests" && q.detail.contains("unittest")));
    assert!(discovery.repositories[0]
        .proposed_checks
        .iter()
        .all(|c| c.check.id != "pytest" && c.check.id != "ruff" && c.check.id != "mypy"));
    assert_annotation_matches_probe(&discovery, &host);
}

#[test]
fn flutter_profile_proposes_test_and_analyze_with_host_capability() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("pubspec.yaml"),
        "name: app\nenvironment:\n  sdk: ^3.5.0\ndependencies:\n  flutter:\n    sdk: flutter\n",
    )
    .unwrap();
    let host = probe_host_cached();
    let discovery = discover_fixture(dir.path(), &host);
    assert_eq!(discovery.repositories[0].profiles, vec!["flutter"]);
    let test = check(&discovery, "flutter-test");
    assert_eq!(test.check.args, vec!["test"]);
    assert!(test.check.required);
    let analyze = check(&discovery, "flutter-analyze");
    assert_eq!(analyze.check.args, vec!["analyze"]);
    assert!(!analyze.check.required);
    expect_capability(&host, test, &["flutter"]);
    expect_capability(&host, analyze, &["flutter"]);
    if !host.available("flutter") {
        assert_eq!(test.missing_tools, vec!["flutter"]);
        assert!(discovery
            .questions
            .iter()
            .any(|q| q.topic == "missing-tool" && q.detail.contains("docs.flutter.dev")));
    }
    assert_annotation_matches_probe(&discovery, &host);
}

#[test]
fn android_profile_proposes_unit_tests_and_declares_device_tests() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("build.gradle.kts"),
        "plugins {\n    id(\"com.android.application\")\n}\nandroid {\n    namespace = \"example.app\"\n}\n",
    )
    .unwrap();
    fs::write(
        dir.path().join("settings.gradle.kts"),
        "rootProject.name = \"app\"\n",
    )
    .unwrap();
    fs::write(dir.path().join("gradlew"), "#!/bin/sh\nexit 0\n").unwrap();
    fs::write(dir.path().join("gradlew.bat"), "@echo off\r\nexit /b 0\r\n").unwrap();
    let host = probe_host_cached();
    let discovery = discover_fixture(dir.path(), &host);
    assert_eq!(discovery.repositories[0].profiles, vec!["android"]);
    let wrapper = if cfg!(windows) {
        "./gradlew.bat"
    } else {
        "./gradlew"
    };
    let unit = check(&discovery, "gradle-unit-test");
    assert_eq!(unit.check.executable, wrapper);
    assert_eq!(unit.check.args, vec!["testDebugUnitTest"]);
    assert!(unit.check.required);
    assert_eq!(unit.check.capabilities, vec!["jdk", "android-sdk"]);
    expect_capability(&host, unit, &["java", "android-sdk"]);
    let connected = check(&discovery, "gradle-connected-test");
    assert_eq!(connected.check.args, vec!["connectedAndroidTest"]);
    assert!(!connected.check.required);
    assert!(connected
        .check
        .capabilities
        .contains(&"android-device".to_owned()));
    expect_capability(&host, connected, &["java", "android-sdk", "adb"]);
    assert!(discovery
        .questions
        .iter()
        .any(|q| q.topic == "gradle-host" && q.detail.contains("android-device")));
    assert_annotation_matches_probe(&discovery, &host);
    // A wrapper that is absent is itself a missing tool, never a silent drop.
    let no_wrapper = tempfile::tempdir().unwrap();
    fs::write(
        no_wrapper.path().join("build.gradle"),
        "plugins { id 'com.android.application' }\n",
    )
    .unwrap();
    let discovery = discover_fixture(no_wrapper.path(), &host);
    assert!(discovery.repositories[0].proposed_checks.is_empty());
    assert!(discovery
        .questions
        .iter()
        .any(|q| q.topic == "gradle-wrapper"));
}

#[test]
fn ios_profile_proposes_xcodebuild_with_placeholders_and_blocks_off_macos() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("Demo.xcodeproj")).unwrap();
    let host = probe_host_cached();
    let discovery = discover_fixture(dir.path(), &host);
    assert_eq!(discovery.repositories[0].profiles, vec!["ios"]);
    let test = check(&discovery, "xcodebuild-test");
    assert_eq!(test.check.executable, "xcodebuild");
    assert_eq!(
        test.check.args,
        vec![
            "test",
            "-project",
            "Demo.xcodeproj",
            "-scheme",
            "Demo",
            "-destination",
            "platform=iOS Simulator,name=iPhone 16"
        ]
    );
    assert!(test.check.required);
    assert_eq!(test.check.capabilities, vec!["xcode"]);
    assert_eq!(test.confidence, Confidence::Inferred);
    for topic in ["ios-scheme", "ios-destination"] {
        assert!(
            discovery.questions.iter().any(|q| q.topic == topic),
            "{topic}"
        );
    }
    expect_capability(&host, test, &["xcodebuild"]);
    if !cfg!(target_os = "macos") {
        assert_eq!(test.capability, Some(CapabilityStatus::Missing));
        assert_eq!(test.missing_tools, vec!["xcodebuild"]);
        let probe = host.tool("xcodebuild").unwrap();
        assert!(probe.detail.as_deref().unwrap().contains("macOS"));
    }
    assert_annotation_matches_probe(&discovery, &host);
    // A workspace wins over the project it contains.
    let workspace = tempfile::tempdir().unwrap();
    fs::create_dir(workspace.path().join("Demo.xcodeproj")).unwrap();
    fs::create_dir(workspace.path().join("Demo.xcworkspace")).unwrap();
    let discovery = discover_fixture(workspace.path(), &host);
    assert_eq!(
        check(&discovery, "xcodebuild-test").check.args[1..3],
        ["-workspace", "Demo.xcworkspace"]
    );
}

#[test]
fn rust_profile_is_annotated_and_discoveries_without_a_probe_stay_unannotated() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
    fs::write(dir.path().join("Cargo.lock"), "").unwrap();
    let host = probe_host_cached();
    let discovery = discover_fixture(dir.path(), &host);
    let test = check(&discovery, "cargo-test");
    expect_capability(&host, test, &["rustc", "cargo"]);
    expect_capability(
        &host,
        check(&discovery, "cargo-clippy"),
        &["rustc", "cargo", "cargo-clippy"],
    );
    assert_annotation_matches_probe(&discovery, &host);
    let unprobed = discover(DiscoveryRequest {
        id: "discovery-2".into(),
        project_id: "fixture".into(),
        project_name: "Fixture".into(),
        manifest_revision: 1,
        created_at: "2026-10-21T00:00:00.000Z".into(),
        repositories: vec![RepositoryInput {
            repository_id: "app".into(),
            root: dir.path().to_path_buf(),
            observation: observation(dir.path()),
        }],
        host_capabilities: None,
    })
    .unwrap();
    assert!(unprobed.host_capabilities.is_none());
    assert!(unprobed.repositories[0]
        .proposed_checks
        .iter()
        .all(|c| c.capability.is_none()));
    // A recorded discovery without the M5 fields still decodes.
    let mut legacy = serde_json::to_value(&unprobed).unwrap();
    legacy.as_object_mut().unwrap().remove("host_capabilities");
    for proposed in legacy["repositories"][0]["proposed_checks"]
        .as_array_mut()
        .unwrap()
    {
        proposed.as_object_mut().unwrap().remove("capability");
        proposed.as_object_mut().unwrap().remove("missing_tools");
    }
    let decoded: Discovery = serde_json::from_value(legacy).unwrap();
    assert_eq!(decoded, unprobed);
}
