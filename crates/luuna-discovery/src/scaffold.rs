//! Approved new-project scaffolding proposals (M5, R04, A05).
//!
//! A proposal is a deterministic, hashed description of what scaffolding
//! would write and run: the files (embedded templates, no network), the exact
//! baseline recipes, declared generator or network steps the developer must
//! confirm separately, the host tools the profile needs, and open questions.
//! It writes nothing. The runtime executes a proposal only against its exact
//! hash, after the developer confirms it, and runs the baseline through the
//! supervised executor so tests exist and pass before any feature work.
use crate::capabilities::{install_hint, python_executable, ANDROID_SDK_TOOL};
use luuna_domain::{
    hash_value, valid_project_id, CapabilityStatus, DiscoveryQuestion, DomainError,
    HostCapabilities, ManifestCheck, ToolProbe,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

pub const SCAFFOLD_SCHEMA_VERSION: &str = "luuna-scaffold-v1";

/// Every profile scaffolding advertises, in the order clients list them.
pub const PROFILES: [&str; 10] = [
    "node",
    "node-typescript",
    "react",
    "nextjs",
    "python",
    "go",
    "rust",
    "flutter",
    "android",
    "ios",
];

#[derive(Debug, Error)]
pub enum ScaffoldError {
    #[error("unknown scaffold profile `{profile}`; supported profiles: {}", PROFILES.join(", "))]
    UnknownProfile { profile: String },
    #[error("project name must match ^[a-z][a-z0-9-]{{0,63}}$ (it names the directory, package and project)")]
    InvalidName,
    #[error("parent directory must be an absolute path")]
    RelativeParent,
    #[error("{0}")]
    Domain(#[from] DomainError),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScaffoldFile {
    /// Path relative to the project root, with `/` separators.
    pub path: String,
    pub contents: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScaffoldStatus {
    /// The runtime may execute it after confirmation.
    Ready,
    /// Execution is refused; `blocked_reason` says what is missing.
    Blocked,
}

/// A command scaffolding would run besides the baseline: a platform generator
/// (`flutter create`) or a dependency installation (`npm install`). A step
/// marked `network` is run only when the developer confirms network access.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScaffoldStep {
    pub id: String,
    pub executable: String,
    pub args: Vec<String>,
    pub capabilities: Vec<String>,
    pub network: bool,
    pub description: String,
}

/// What `POST /api/v1/projects/scaffold/propose` returns. The hash covers
/// every field but `hash`, so a confirmation names exactly this content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScaffoldProposal {
    pub schema_version: String,
    pub profile: String,
    pub name: String,
    pub parent_dir: String,
    pub target_dir: String,
    pub status: ScaffoldStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
    /// Written verbatim, in order, before the first commit.
    pub files: Vec<ScaffoldFile>,
    /// A platform generator that creates the project instead of `files`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generator: Option<ScaffoldStep>,
    /// Dependency preparation run after the commit and before the baseline.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preparation: Vec<ScaffoldStep>,
    /// Human-readable network steps the developer confirms with `confirm_network`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub network_steps: Vec<String>,
    /// The exact recipes a discovery of the scaffolded repository proposes;
    /// the first required one is run as the real scaffold baseline.
    pub baseline: Vec<ManifestCheck>,
    /// Probe results for the tools this profile's baseline needs.
    pub required_tools: Vec<ToolProbe>,
    pub questions: Vec<DiscoveryQuestion>,
    /// Known limits of the template the developer accepts with the hash, such
    /// as a recipe the profile cannot establish offline. Absent when empty, so
    /// proposals without notes keep their earlier hashes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
    /// `luuna-json-v1` hash of the proposal with this field empty.
    pub hash: String,
}

impl ScaffoldProposal {
    pub fn computed_hash(&self) -> Result<String, DomainError> {
        let mut unhashed = self.clone();
        unhashed.hash = String::new();
        hash_value(&serde_json::to_value(&unhashed)?)
    }

    /// The recipe scaffolding runs as the baseline: the first required one.
    pub fn baseline_check(&self) -> Option<&ManifestCheck> {
        self.baseline.iter().find(|c| c.required)
    }
}

fn check(
    id: &str,
    executable: &str,
    args: &[&str],
    required: bool,
    timeout_seconds: u64,
    capabilities: &[&str],
) -> ManifestCheck {
    ManifestCheck {
        id: id.into(),
        executable: executable.into(),
        args: args.iter().map(|a| (*a).to_owned()).collect(),
        required,
        timeout_seconds,
        capabilities: capabilities.iter().map(|c| (*c).to_owned()).collect(),
        cwd: ".".into(),
    }
}

fn file(path: &str, contents: impl Into<String>) -> ScaffoldFile {
    ScaffoldFile {
        path: path.into(),
        contents: contents.into(),
    }
}

fn question(topic: &str, detail: impl Into<String>) -> DiscoveryQuestion {
    DiscoveryQuestion {
        repository_id: Some("app".into()),
        topic: topic.into(),
        detail: detail.into(),
    }
}

fn probe_of(host: &HostCapabilities, tool: &str) -> ToolProbe {
    host.tool(tool).cloned().unwrap_or_else(|| ToolProbe {
        tool: tool.into(),
        status: CapabilityStatus::Missing,
        version: None,
        detail: Some("not probed".into()),
    })
}

/// Tools the profile cannot do without; a missing one blocks the proposal.
fn missing(required: &[ToolProbe]) -> Vec<&ToolProbe> {
    required
        .iter()
        .filter(|t| t.status == CapabilityStatus::Missing)
        .collect()
}

fn blocked_reason(profile: &str, missing: &[&ToolProbe]) -> String {
    let names: Vec<String> = missing
        .iter()
        .map(|t| {
            format!(
                "`{}` ({}; {})",
                t.tool,
                t.detail.as_deref().unwrap_or("not found on PATH"),
                install_hint(&t.tool)
            )
        })
        .collect();
    format!(
        "the {profile} profile needs {} on this host; the proposal is blocked rather than reported as a passing scaffold",
        names.join(", ")
    )
}

/// Build the proposal for `profile`. Pure: nothing is written or executed.
pub fn propose(
    profile: &str,
    name: &str,
    parent_dir: &Path,
    host: &HostCapabilities,
) -> Result<ScaffoldProposal, ScaffoldError> {
    if !valid_project_id(name) {
        return Err(ScaffoldError::InvalidName);
    }
    if !parent_dir.is_absolute() {
        return Err(ScaffoldError::RelativeParent);
    }
    let target = parent_dir.join(name);
    let mut proposal = ScaffoldProposal {
        schema_version: SCAFFOLD_SCHEMA_VERSION.into(),
        profile: profile.into(),
        name: name.into(),
        parent_dir: parent_dir.display().to_string(),
        target_dir: target.display().to_string(),
        status: ScaffoldStatus::Ready,
        blocked_reason: None,
        files: Vec::new(),
        generator: None,
        preparation: Vec::new(),
        network_steps: Vec::new(),
        baseline: Vec::new(),
        required_tools: Vec::new(),
        questions: Vec::new(),
        notes: Vec::new(),
        hash: String::new(),
    };
    match profile {
        "node" => node(&mut proposal, host, false),
        "node-typescript" => node(&mut proposal, host, true),
        "react" => react(&mut proposal, host),
        "nextjs" => nextjs(&mut proposal, host),
        "python" => python(&mut proposal, host),
        "go" => go(&mut proposal, host),
        "rust" => rust(&mut proposal, host),
        "flutter" => flutter(&mut proposal, host),
        "android" => android(&mut proposal, host),
        "ios" => ios(&mut proposal, host),
        other => {
            return Err(ScaffoldError::UnknownProfile {
                profile: other.into(),
            })
        }
    }
    let lacking = missing(&proposal.required_tools);
    if !lacking.is_empty() && proposal.status == ScaffoldStatus::Ready {
        proposal.status = ScaffoldStatus::Blocked;
        proposal.blocked_reason = Some(blocked_reason(profile, &lacking));
    }
    if proposal.generator.is_none()
        && proposal.files.is_empty()
        && proposal.status == ScaffoldStatus::Ready
    {
        proposal.status = ScaffoldStatus::Blocked;
        proposal.blocked_reason = Some("the profile has no template and no generator".into());
    }
    proposal.hash = proposal.computed_hash()?;
    Ok(proposal)
}

const GITIGNORE_NODE: &str = "node_modules/\ndist/\n";

fn readme(name: &str, profile: &str, baseline: &str) -> String {
    format!(
        "# {name}\n\nScaffolded by Luuna ({profile} profile). The baseline check is `{baseline}`; it must pass before feature work is planned.\n"
    )
}

fn node(proposal: &mut ScaffoldProposal, host: &HostCapabilities, typescript: bool) {
    let name = proposal.name.clone();
    let mut package = serde_json::json!({
        "name": name,
        "version": "0.1.0",
        "private": true,
        "type": "module",
        "scripts": { "test": "node --test" },
    });
    if typescript {
        // Node strips TypeScript types itself from 22.18 / 23.6 on; no
        // compiler is installed, so the template needs no network.
        package["engines"] = serde_json::json!({ "node": ">=22.18" });
    }
    let package_json = format!(
        "{}\n",
        serde_json::to_string_pretty(&package).expect("JSON")
    );
    proposal.files.push(file("package.json", package_json));
    proposal.files.push(file(".gitignore", GITIGNORE_NODE));
    if typescript {
        proposal.files.push(file(
            "tsconfig.json",
            "{\n  \"compilerOptions\": {\n    \"target\": \"es2022\",\n    \"module\": \"nodenext\",\n    \"moduleResolution\": \"nodenext\",\n    \"strict\": true,\n    \"noEmit\": true,\n    \"allowImportingTsExtensions\": true,\n    \"verbatimModuleSyntax\": true,\n    \"erasableSyntaxOnly\": true,\n    \"skipLibCheck\": true\n  },\n  \"include\": [\"src\", \"tests\"]\n}\n",
        ));
        proposal.files.push(file(
            "src/index.ts",
            "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
        ));
        proposal.files.push(file(
            "tests/index.test.ts",
            "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/index.ts';\n\ntest('greet names the caller', () => {\n  assert.equal(greet('Luuna'), 'Hello, Luuna!');\n});\n",
        ));
        proposal.questions.push(question(
            "typescript-typecheck",
            "the template relies on Node's built-in type stripping (Node 22.18+), so no compiler is installed; to add a `typecheck` recipe (`tsc --noEmit`), run `npm install --save-dev typescript` (network) and add the script to package.json, then run discovery again",
        ));
        // ADR 0019: the TypeScript template relies on Node's built-in type
        // stripping and needs no network; the price is that nothing checks types.
        proposal.notes.push(
            "typecheck gap: the TypeScript template relies on Node's built-in type stripping, so the baseline runs the tests without checking types; no `typecheck` recipe exists until `typescript` is installed and a `typecheck` script is added".into(),
        );
    } else {
        proposal.files.push(file(
            "src/index.mjs",
            "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n",
        ));
        proposal.files.push(file(
            "tests/index.test.mjs",
            "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/index.mjs';\n\ntest('greet names the caller', () => {\n  assert.equal(greet('Luuna'), 'Hello, Luuna!');\n});\n",
        ));
    }
    proposal.files.push(file(
        "README.md",
        readme(&name, &proposal.profile, "npm test (node --test)"),
    ));
    proposal.baseline.push(check(
        "npm-test",
        "npm",
        &["test"],
        true,
        900,
        &["node", "npm", "test"],
    ));
    proposal.required_tools = vec![probe_of(host, "node"), probe_of(host, "npm")];
}

fn react(proposal: &mut ScaffoldProposal, host: &HostCapabilities) {
    let name = proposal.name.clone();
    let package = serde_json::json!({
        "name": name,
        "version": "0.1.0",
        "private": true,
        "type": "module",
        "scripts": {
            "dev": "vite",
            "build": "vite build",
            "test": "vitest run",
        },
        "dependencies": { "react": "^19.1.0", "react-dom": "^19.1.0" },
        "devDependencies": {
            "@vitejs/plugin-react": "^4.4.0",
            "vite": "^6.3.0",
            "vitest": "^3.1.0",
        },
    });
    proposal.files.push(file(
        "package.json",
        format!(
            "{}\n",
            serde_json::to_string_pretty(&package).expect("JSON")
        ),
    ));
    proposal.files.push(file(".gitignore", GITIGNORE_NODE));
    proposal.files.push(file(
        "vite.config.js",
        "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  test: { environment: 'node' },\n});\n",
    ));
    proposal.files.push(file(
        "index.html",
        "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>App</title>\n  </head>\n  <body>\n    <div id=\"root\"></div>\n    <script type=\"module\" src=\"/src/main.jsx\"></script>\n  </body>\n</html>\n",
    ));
    proposal.files.push(file(
        "src/App.jsx",
        "export function App({ name = 'Luuna' }) {\n  return <h1>Hello, {name}!</h1>;\n}\n",
    ));
    proposal.files.push(file(
        "src/main.jsx",
        "import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App.jsx';\n\ncreateRoot(document.getElementById('root')).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n",
    ));
    proposal.files.push(file(
        "tests/App.test.jsx",
        "import { test, expect } from 'vitest';\nimport { renderToString } from 'react-dom/server';\nimport { App } from '../src/App.jsx';\n\ntest('App greets', () => {\n  expect(renderToString(<App name=\"Luuna\" />)).toContain('Hello, Luuna!');\n});\n",
    ));
    proposal.files.push(file(
        "README.md",
        readme(&name, "react", "npm test (vitest run)"),
    ));
    proposal.preparation.push(ScaffoldStep {
        id: "npm-install".into(),
        executable: "npm".into(),
        args: vec!["install".into(), "--no-audit".into(), "--no-fund".into()],
        capabilities: vec!["node".into(), "npm".into(), "network".into()],
        network: true,
        description:
            "install react, react-dom, vite, @vitejs/plugin-react and vitest from the npm registry"
                .into(),
    });
    proposal.network_steps.push(
        "`npm install` downloads React, Vite and Vitest from the npm registry; without it the baseline `npm test` is blocked (vitest is not installed)".into(),
    );
    proposal.baseline.push(check(
        "npm-test",
        "npm",
        &["test"],
        true,
        900,
        &["node", "npm", "test"],
    ));
    proposal.baseline.push(check(
        "npm-build",
        "npm",
        &["run", "build"],
        false,
        900,
        &["node", "npm", "build"],
    ));
    proposal.required_tools = vec![probe_of(host, "node"), probe_of(host, "npm")];
    proposal.questions.push(question(
        "react-dependencies",
        "the React template cannot run its tests without installed packages; confirm the declared `npm install` network step, or install the dependencies yourself and run a baseline afterwards",
    ));
}

/// Next.js (App Router, TypeScript) from a written-out minimal template rather
/// than `create-next-app`, so the proposal is complete and offline. Like React
/// it declares `npm install` as its network step: `next`, `react` and `vitest`
/// are not installed, so the baseline is blocked until the developer confirms
/// that step, and the scaffold says so instead of reporting a pass.
fn nextjs(proposal: &mut ScaffoldProposal, host: &HostCapabilities) {
    let name = proposal.name.clone();
    let package = serde_json::json!({
        "name": name,
        "version": "0.1.0",
        "private": true,
        "scripts": {
            "dev": "next dev",
            "build": "next build",
            "start": "next start",
            "test": "vitest run",
            "typecheck": "tsc --noEmit",
        },
        "dependencies": { "next": "^15.3.0", "react": "^19.1.0", "react-dom": "^19.1.0" },
        "devDependencies": {
            "@types/node": "^22.15.0",
            "@types/react": "^19.1.0",
            "@types/react-dom": "^19.1.0",
            "typescript": "^5.8.0",
            "vitest": "^3.1.0",
        },
    });
    proposal.files.push(file(
        "package.json",
        format!(
            "{}\n",
            serde_json::to_string_pretty(&package).expect("JSON")
        ),
    ));
    proposal.files.push(file(
        ".gitignore",
        "node_modules/\n.next/\nout/\nnext-env.d.ts\n",
    ));
    proposal.files.push(file(
        "next.config.mjs",
        "/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nexport default nextConfig;\n",
    ));
    proposal.files.push(file(
        "tsconfig.json",
        "{\n  \"compilerOptions\": {\n    \"target\": \"es2022\",\n    \"lib\": [\"dom\", \"dom.iterable\", \"esnext\"],\n    \"module\": \"esnext\",\n    \"moduleResolution\": \"bundler\",\n    \"jsx\": \"preserve\",\n    \"strict\": true,\n    \"noEmit\": true,\n    \"esModuleInterop\": true,\n    \"isolatedModules\": true,\n    \"resolveJsonModule\": true,\n    \"allowJs\": true,\n    \"incremental\": true,\n    \"skipLibCheck\": true,\n    \"plugins\": [{ \"name\": \"next\" }]\n  },\n  \"include\": [\"next-env.d.ts\", \"**/*.ts\", \"**/*.tsx\"],\n  \"exclude\": [\"node_modules\"]\n}\n",
    ));
    proposal.files.push(file(
        "vitest.config.mts",
        "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  esbuild: { jsx: 'automatic' },\n  test: { environment: 'node', include: ['tests/**/*.test.tsx'] },\n});\n",
    ));
    proposal.files.push(file(
        "app/layout.tsx",
        "import type { ReactNode } from 'react';\n\nexport const metadata = { title: 'App' };\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang=\"en\">\n      <body>{children}</body>\n    </html>\n  );\n}\n",
    ));
    proposal.files.push(file(
        "app/page.tsx",
        "export function Greeting({ name = 'Luuna' }: { name?: string }) {\n  return <h1>Hello, {name}!</h1>;\n}\n\nexport default function Home() {\n  return (\n    <main>\n      <Greeting />\n    </main>\n  );\n}\n",
    ));
    proposal.files.push(file(
        "tests/page.test.tsx",
        "import { test, expect } from 'vitest';\nimport { renderToString } from 'react-dom/server';\nimport Home, { Greeting } from '../app/page';\n\ntest('the home page greets', () => {\n  expect(renderToString(<Home />)).toContain('Hello, Luuna!');\n  expect(renderToString(<Greeting name=\"Next\" />)).toContain('Hello, Next!');\n});\n",
    ));
    proposal.files.push(file(
        "README.md",
        readme(&name, "nextjs", "npm test (vitest run)"),
    ));
    proposal.preparation.push(ScaffoldStep {
        id: "npm-install".into(),
        executable: "npm".into(),
        args: vec!["install".into(), "--no-audit".into(), "--no-fund".into()],
        capabilities: vec!["node".into(), "npm".into(), "network".into()],
        network: true,
        description:
            "install next, react, react-dom, typescript, the React type packages and vitest from the npm registry"
                .into(),
    });
    proposal.network_steps.push(
        "`npm install` downloads Next.js, React, TypeScript and Vitest from the npm registry; without it the baseline `npm test` is blocked (vitest is not installed) and `next build` and `tsc --noEmit` cannot run either".into(),
    );
    proposal.baseline.push(check(
        "npm-test",
        "npm",
        &["test"],
        true,
        900,
        &["node", "npm", "test"],
    ));
    proposal.baseline.push(check(
        "npm-typecheck",
        "npm",
        &["run", "typecheck"],
        false,
        900,
        &["node", "npm", "typecheck"],
    ));
    proposal.baseline.push(check(
        "npm-build",
        "npm",
        &["run", "build"],
        false,
        900,
        &["node", "npm", "build"],
    ));
    proposal.required_tools = vec![probe_of(host, "node"), probe_of(host, "npm")];
    proposal.questions.push(question(
        "nextjs-dependencies",
        "the Next.js template cannot run its tests, typecheck or build without installed packages; confirm the declared `npm install` network step, or install the dependencies yourself and run a baseline afterwards",
    ));
    proposal.notes.push(
        "the template is a written-out minimal App Router project, not `create-next-app`; `next build` writes `.next/` and `next-env.d.ts`, which `.gitignore` excludes so the baseline leaves the checkout clean".into(),
    );
}

fn python(proposal: &mut ScaffoldProposal, host: &HostCapabilities) {
    let name = proposal.name.clone();
    let package = name.replace('-', "_");
    let interpreter = python_executable(Some(host));
    proposal.files.push(file(
        "pyproject.toml",
        format!(
            "[project]\nname = \"{name}\"\nversion = \"0.1.0\"\ndescription = \"Scaffolded by Luuna\"\nrequires-python = \">=3.10\"\n\n[tool.unittest]\n# `{interpreter} -m unittest -v` discovers tests/test_*.py from the project root.\n"
        ),
    ));
    proposal
        .files
        .push(file(".gitignore", "__pycache__/\n*.pyc\n.venv/\n"));
    proposal.files.push(file(
        &format!("{package}/__init__.py"),
        "\"\"\"Scaffolded package.\"\"\"\n\n\ndef greet(name: str) -> str:\n    return f\"Hello, {name}!\"\n",
    ));
    proposal.files.push(file("tests/__init__.py", ""));
    proposal.files.push(file(
        "tests/test_greet.py",
        format!(
            "import unittest\n\nfrom {package} import greet\n\n\nclass GreetTest(unittest.TestCase):\n    def test_greet_names_the_caller(self):\n        self.assertEqual(greet(\"Luuna\"), \"Hello, Luuna!\")\n\n\nif __name__ == \"__main__\":\n    unittest.main()\n"
        ),
    ));
    proposal.files.push(file(
        "README.md",
        readme(&name, "python", &format!("{interpreter} -m unittest -v")),
    ));
    proposal.baseline.push(check(
        "unittest",
        interpreter,
        &["-m", "unittest", "-v"],
        true,
        1800,
        &["python"],
    ));
    proposal.required_tools = vec![probe_of(host, interpreter)];
}

fn go(proposal: &mut ScaffoldProposal, host: &HostCapabilities) {
    let name = proposal.name.clone();
    proposal.files.push(file(
        "go.mod",
        format!("module example.com/{name}\n\ngo 1.22\n"),
    ));
    proposal.files.push(file(
        "main.go",
        "package main\n\nimport \"fmt\"\n\n// Greet names the caller.\nfunc Greet(name string) string {\n\treturn fmt.Sprintf(\"Hello, %s!\", name)\n}\n\nfunc main() {\n\tfmt.Println(Greet(\"Luuna\"))\n}\n",
    ));
    proposal.files.push(file(
        "main_test.go",
        "package main\n\nimport \"testing\"\n\nfunc TestGreet(t *testing.T) {\n\tif got := Greet(\"Luuna\"); got != \"Hello, Luuna!\" {\n\t\tt.Fatalf(\"Greet = %q\", got)\n\t}\n}\n",
    ));
    proposal.files.push(file(".gitignore", "/bin/\n"));
    proposal
        .files
        .push(file("README.md", readme(&name, "go", "go test ./...")));
    proposal.baseline.push(check(
        "go-test",
        "go",
        &["test", "./..."],
        true,
        1800,
        &["go"],
    ));
    proposal.baseline.push(check(
        "go-vet",
        "go",
        &["vet", "./..."],
        false,
        900,
        &["go"],
    ));
    proposal.required_tools = vec![probe_of(host, "go")];
}

fn rust(proposal: &mut ScaffoldProposal, host: &HostCapabilities) {
    let name = proposal.name.clone();
    proposal.files.push(file(
        "Cargo.toml",
        format!(
            "[package]\nname = \"{name}\"\nversion = \"0.1.0\"\nedition = \"2021\"\npublish = false\n\n[dependencies]\n"
        ),
    ));
    // A dependency-free lockfile lets `cargo test --locked` run offline.
    proposal.files.push(file(
        "Cargo.lock",
        format!(
            "# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = \"{name}\"\nversion = \"0.1.0\"\n"
        ),
    ));
    proposal.files.push(file(".gitignore", "/target\n"));
    proposal.files.push(file(
        "src/lib.rs",
        "//! Scaffolded crate.\n\n/// Names the caller.\npub fn greet(name: &str) -> String {\n    format!(\"Hello, {name}!\")\n}\n\n#[cfg(test)]\nmod tests {\n    use super::greet;\n\n    #[test]\n    fn greet_names_the_caller() {\n        assert_eq!(greet(\"Luuna\"), \"Hello, Luuna!\");\n    }\n}\n",
    ));
    proposal.files.push(file(
        "README.md",
        readme(&name, "rust", "cargo test --locked"),
    ));
    proposal.baseline.push(check(
        "cargo-test",
        "cargo",
        &["test", "--locked"],
        true,
        1800,
        &["rust", "cargo"],
    ));
    proposal.baseline.push(check(
        "cargo-clippy",
        "cargo",
        &[
            "clippy",
            "--locked",
            "--all-targets",
            "--",
            "-D",
            "warnings",
        ],
        false,
        1800,
        &["rust", "cargo", "clippy"],
    ));
    proposal.required_tools = vec![probe_of(host, "cargo"), probe_of(host, "rustc")];
}

fn flutter(proposal: &mut ScaffoldProposal, host: &HostCapabilities) {
    let name = proposal.name.clone();
    proposal.generator = Some(ScaffoldStep {
        id: "flutter-create".into(),
        executable: "flutter".into(),
        args: vec![
            "create".into(),
            "--project-name".into(),
            name.replace('-', "_"),
            "--empty".into(),
            name.clone(),
        ],
        capabilities: vec!["flutter".into(), "network".into()],
        network: true,
        description: "the Flutter SDK generates the project (`flutter create`), then resolves packages from pub.dev".into(),
    });
    proposal.network_steps.push(
        "`flutter create` runs `flutter pub get`, which fetches packages from pub.dev unless they are cached".into(),
    );
    proposal.baseline.push(check(
        "flutter-test",
        "flutter",
        &["test"],
        true,
        1800,
        &["flutter"],
    ));
    proposal.baseline.push(check(
        "flutter-analyze",
        "flutter",
        &["analyze"],
        false,
        900,
        &["flutter"],
    ));
    proposal.required_tools = vec![probe_of(host, "flutter"), probe_of(host, "dart")];
    proposal.questions.push(question(
        "flutter-platforms",
        "`flutter create --empty` generates every platform runner it can; device, emulator and Apple checks are not part of the baseline and block explicitly on an incapable host",
    ));
}

fn android(proposal: &mut ScaffoldProposal, host: &HostCapabilities) {
    let name = proposal.name.clone();
    proposal.status = ScaffoldStatus::Blocked;
    proposal.blocked_reason = Some(format!(
        "native Android projects are created with the Android Studio project template; Luuna has no supported command-line generator for them. Create `{name}` in Android Studio, then register it with POST /api/v1/projects: discovery proposes the Gradle wrapper recipes below and asks about the JDK, Android SDK and device capabilities{}",
        match missing(&[probe_of(host, "java"), probe_of(host, ANDROID_SDK_TOOL)]).len() {
            0 => String::new(),
            _ => "; this host also lacks a JDK and/or the Android SDK".to_owned(),
        }
    ));
    let wrapper = if cfg!(windows) {
        "./gradlew.bat"
    } else {
        "./gradlew"
    };
    proposal.baseline.push(check(
        "gradle-unit-test",
        wrapper,
        &["testDebugUnitTest"],
        true,
        3600,
        &["jdk", "android-sdk"],
    ));
    proposal.baseline.push(check(
        "gradle-connected-test",
        wrapper,
        &["connectedAndroidTest"],
        false,
        3600,
        &["jdk", "android-sdk", "android-device"],
    ));
    proposal.required_tools = vec![
        probe_of(host, "java"),
        probe_of(host, ANDROID_SDK_TOOL),
        probe_of(host, "adb"),
    ];
    proposal.questions.push(question(
        "android-generator",
        "use Android Studio > New Project (Empty Activity) with the Gradle wrapper, commit it, then register and discover it",
    ));
}

fn ios(proposal: &mut ScaffoldProposal, host: &HostCapabilities) {
    let name = proposal.name.clone();
    let mac = cfg!(target_os = "macos");
    proposal.status = ScaffoldStatus::Blocked;
    proposal.blocked_reason = Some(if mac {
        format!(
            "native iOS projects are created with Xcode's project templates (File > New > Project); Luuna has no supported command-line generator for them. Create `{name}` in Xcode, then register it with POST /api/v1/projects and answer the scheme and destination questions discovery raises"
        )
    } else {
        format!(
            "native iOS projects require macOS with Xcode: this host is {} and has no `xcodebuild`; create `{name}` in Xcode on a Mac, register it there, and run its required checks on that Mac",
            std::env::consts::OS
        )
    });
    proposal.baseline.push(check(
        "xcodebuild-test",
        "xcodebuild",
        &[
            "test",
            "-scheme",
            &name,
            "-destination",
            "platform=iOS Simulator,name=iPhone 16",
        ],
        true,
        3600,
        &["xcode"],
    ));
    proposal.required_tools = vec![probe_of(host, "xcodebuild")];
    proposal.questions.push(question(
        "ios-scheme",
        format!("the `xcodebuild test` recipe assumes a scheme named `{name}`; replace it with the shared scheme Xcode created"),
    ));
    proposal.questions.push(question(
        "ios-destination",
        "the recipe assumes the destination `platform=iOS Simulator,name=iPhone 16`; set it to a simulator installed on the Mac that runs the checks",
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capabilities::probe_host_cached;

    fn host(available: &[&str]) -> HostCapabilities {
        HostCapabilities {
            probed_at: "2026-10-21T00:00:00.000Z".into(),
            os: "test".into(),
            arch: "test".into(),
            tools: [
                "node",
                "npm",
                "cargo",
                "rustc",
                "go",
                "python",
                "python3",
                "flutter",
                "dart",
                "java",
                "adb",
                "xcodebuild",
                ANDROID_SDK_TOOL,
            ]
            .into_iter()
            .map(|tool| ToolProbe {
                tool: tool.into(),
                status: if available.contains(&tool) {
                    CapabilityStatus::Available
                } else {
                    CapabilityStatus::Missing
                },
                version: None,
                detail: None,
            })
            .collect(),
        }
    }

    fn parent() -> std::path::PathBuf {
        if cfg!(windows) {
            "C:\\projects".into()
        } else {
            "/projects".into()
        }
    }

    #[test]
    fn proposals_are_deterministic_hashed_and_write_nothing() {
        let host = host(&["node", "npm", "cargo", "rustc", "go", "python", "python3"]);
        for profile in PROFILES {
            let a = propose(profile, "demo-app", &parent(), &host).unwrap();
            let b = propose(profile, "demo-app", &parent(), &host).unwrap();
            assert_eq!(a, b, "{profile}");
            assert_eq!(a.hash, a.computed_hash().unwrap());
            assert!(a.hash.starts_with("sha256:"));
            assert!(a.baseline_check().is_some(), "{profile}");
            assert!(!parent().join("demo-app").exists());
            for file in &a.files {
                assert!(!file.path.starts_with('/') && !file.path.contains(".."));
            }
        }
        let renamed = propose("node", "other", &parent(), &host).unwrap();
        assert_ne!(
            renamed.hash,
            propose("node", "demo-app", &parent(), &host).unwrap().hash
        );
        assert!(matches!(
            propose("perl", "x", &parent(), &host),
            Err(ScaffoldError::UnknownProfile { .. })
        ));
        assert!(matches!(
            propose("node", "Bad Name", &parent(), &host),
            Err(ScaffoldError::InvalidName)
        ));
    }

    #[test]
    fn template_profiles_are_ready_offline_and_generator_profiles_block_honestly() {
        let capable = host(&["node", "npm", "cargo", "rustc", "go", "python", "python3"]);
        for profile in ["node", "node-typescript", "python", "go", "rust"] {
            let proposal = propose(profile, "demo", &parent(), &capable).unwrap();
            assert_eq!(proposal.status, ScaffoldStatus::Ready, "{profile}");
            assert!(proposal.network_steps.is_empty(), "{profile}");
            assert!(proposal.generator.is_none());
            assert!(!proposal.files.is_empty());
        }
        for profile in ["react", "nextjs"] {
            let proposal = propose(profile, "demo", &parent(), &capable).unwrap();
            assert_eq!(proposal.status, ScaffoldStatus::Ready, "{profile}");
            assert!(proposal
                .preparation
                .iter()
                .any(|s| s.network && s.id == "npm-install"));
            assert!(!proposal.network_steps.is_empty());
            assert!(proposal.generator.is_none());
            assert_eq!(proposal.baseline_check().unwrap().id, "npm-test");
        }
        let nextjs = propose("nextjs", "demo", &parent(), &capable).unwrap();
        for path in [
            "package.json",
            "next.config.mjs",
            "tsconfig.json",
            "app/page.tsx",
            "app/layout.tsx",
            "tests/page.test.tsx",
        ] {
            assert!(nextjs.files.iter().any(|f| f.path == path), "{path}");
        }
        assert!(nextjs
            .baseline
            .iter()
            .any(|c| c.id == "npm-typecheck" && !c.required));
        assert!(nextjs.notes.iter().any(|n| n.contains("create-next-app")));
        assert_eq!(
            propose("nextjs", "demo", &parent(), &host(&[]))
                .unwrap()
                .status,
            ScaffoldStatus::Blocked
        );
        // ADR 0019's typecheck gap is stated on the proposal the developer hashes.
        let typescript = propose("node-typescript", "demo", &parent(), &capable).unwrap();
        assert!(typescript
            .notes
            .iter()
            .any(|n| n.contains("type stripping") && n.contains("typecheck")));
        let plain = propose("node", "demo", &parent(), &capable).unwrap();
        assert!(plain.notes.is_empty());
        assert!(!serde_json::to_string(&plain).unwrap().contains("\"notes\""));
        let none = host(&[]);
        let node = propose("node", "demo", &parent(), &none).unwrap();
        assert_eq!(node.status, ScaffoldStatus::Blocked);
        assert!(node.blocked_reason.as_deref().unwrap().contains("`node`"));
        let flutter_missing = propose("flutter", "demo", &parent(), &none).unwrap();
        assert_eq!(flutter_missing.status, ScaffoldStatus::Blocked);
        assert!(flutter_missing
            .blocked_reason
            .as_deref()
            .unwrap()
            .contains("flutter"));
        let flutter_present =
            propose("flutter", "demo", &parent(), &host(&["flutter", "dart"])).unwrap();
        assert_eq!(flutter_present.status, ScaffoldStatus::Ready);
        assert_eq!(
            flutter_present.generator.as_ref().unwrap().executable,
            "flutter"
        );
        for profile in ["android", "ios"] {
            let proposal = propose(
                profile,
                "demo",
                &parent(),
                &host(&["java", "adb", "xcodebuild", ANDROID_SDK_TOOL]),
            )
            .unwrap();
            assert_eq!(proposal.status, ScaffoldStatus::Blocked, "{profile}");
            assert!(proposal.generator.is_none());
            assert!(proposal.baseline_check().is_some());
        }
        let ios = propose("ios", "demo", &parent(), &none).unwrap();
        assert!(ios.baseline[0].capabilities.contains(&"xcode".to_owned()));
        assert!(ios.questions.iter().any(|q| q.topic == "ios-scheme"));
        let android = propose("android", "demo", &parent(), &none).unwrap();
        assert!(android.baseline[1]
            .capabilities
            .contains(&"android-device".to_owned()));
        // The baseline recipes are valid manifest checks.
        for profile in PROFILES {
            let proposal = propose(profile, "demo", &parent(), &capable).unwrap();
            let manifest = luuna_domain::ProjectManifest {
                schema_version: luuna_domain::SCHEMA_VERSION.into(),
                id: "demo".into(),
                name: "demo".into(),
                revision: 1,
                repositories: vec![luuna_domain::RepositoryManifest {
                    id: "app".into(),
                    remote: "local:app".into(),
                    default_branch: "main".into(),
                    profiles: vec![profile.replace('-', "")],
                    execution: luuna_domain::ExecutionProfile::Native,
                    checks: proposal.baseline.clone(),
                }],
                relationships: vec![],
                policy: luuna_domain::ProjectPolicy::v1(1, 1, 2),
            };
            manifest
                .validate()
                .unwrap_or_else(|e| panic!("{profile}: {e}"));
        }
    }

    #[test]
    fn proposals_on_this_host_agree_with_its_probe() {
        let host = probe_host_cached();
        for profile in ["flutter", "node", "go", "rust", "python"] {
            let proposal = propose(profile, "demo", &parent(), &host).unwrap();
            let lacking = proposal
                .required_tools
                .iter()
                .any(|t| t.status == CapabilityStatus::Missing);
            assert_eq!(
                proposal.status == ScaffoldStatus::Blocked,
                lacking,
                "{profile}: {:?}",
                proposal.required_tools
            );
        }
    }
}
