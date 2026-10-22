use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[test]
fn nonterminal_and_help_need_no_token() {
    let binary = env!("CARGO_BIN_EXE_luuna-tui");
    let help = std::process::Command::new(binary)
        .arg("--help")
        .env_remove("LUUNA_API_TOKEN")
        .output()
        .unwrap();
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("Rust terminal"));
    let plain = std::process::Command::new(binary)
        .env_remove("LUUNA_API_TOKEN")
        .output()
        .unwrap();
    assert_eq!(plain.status.code(), Some(2));
    assert!(!plain.stdout.contains(&27));
}

#[test]
fn real_pty_keyboard_resize_and_terminal_cleanup() {
    for (cols, rows, quit, token_present) in [
        (80, 24, b"q".as_slice(), true),
        (40, 12, b"\x03".as_slice(), true),
        (80, 24, b"".as_slice(), true),
        (80, 24, b"".as_slice(), false),
    ] {
        let control = tempfile::tempdir().unwrap();
        let marker = control.path().join("shutdown");
        let stopped = control.path().join("bridge-stopped");
        let wrapper = control.path().join("bridge.mjs");
        std::fs::write(
            &wrapper,
            r#"
            import { writeFileSync } from 'node:fs';
            import { pathToFileURL } from 'node:url';
            const { serveBridge } = await import(pathToFileURL(process.env.LUUNA_TEST_BRIDGE).href);
            await serveBridge();
            writeFileSync(process.env.LUUNA_TEST_BRIDGE_STOPPED, 'stopped');
        "#,
        )
        .unwrap();
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Real PTY required for terminal audit");
        let mut command = CommandBuilder::new(env!("CARGO_BIN_EXE_luuna-tui"));
        command.arg("--bridge");
        command.arg(&wrapper);
        if let Some(node) = std::env::var_os("LUUNA_TEST_NODE") {
            command.arg("--node");
            command.arg(node);
        }
        command.env(
            "LUUNA_API_TOKEN",
            if token_present {
                "terminal-fixture-private-token"
            } else {
                ""
            },
        );
        command.env("LUUNA_URL", "http://127.0.0.1:1");
        command.env("LUUNA_TUI_SHUTDOWN_FILE", &marker);
        command.env("LUUNA_TEST_BRIDGE", luuna_tui::bridge::default_bridge());
        command.env("LUUNA_TEST_BRIDGE_STOPPED", &stopped);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let captured = Arc::new(Mutex::new(Vec::new()));
        let output = captured.clone();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let reader_thread = std::thread::spawn(move || {
            let mut bytes = [0; 4096];
            while let Ok(n) = reader.read(&mut bytes) {
                if n == 0 {
                    break;
                }
                let mut output = output.lock().unwrap();
                if output.len() < 2 * 1024 * 1024 {
                    output.extend_from_slice(&bytes[..n]);
                }
            }
        });
        let mut writer = pair.master.take_writer().unwrap();
        // portable-pty creates ConPTY with INHERIT_CURSOR. A headless terminal host must
        // answer the initial cursor-position request before ConPTY releases client output.
        #[cfg(windows)]
        {
            writer.write_all(b"\x1b[1;1R").unwrap();
            writer.flush().unwrap();
        }
        let start = Instant::now();
        let mut last_catalog_key = Instant::now();
        loop {
            let text = String::from_utf8_lossy(&captured.lock().unwrap()).into_owned();
            // Ratatui updates only changed cells: the title's initial 0 is replaced by
            // a cursor-addressed 61, so raw output need not contain one contiguous title.
            if token_present && text.contains("start-session") && text.contains("doctor")
                || !token_present && text.contains("Service token (hidden)")
            {
                break;
            }
            // The workbench now lands on Home. The unreachable fixture service settles
            // its read before F2 is admitted; drive the real function key to the catalog.
            if text.contains("workspace health")
                && last_catalog_key.elapsed() > Duration::from_millis(150)
            {
                writer.write_all(b"\x1bOQ").unwrap();
                writer.flush().unwrap();
                last_catalog_key = Instant::now();
            }
            if start.elapsed() > Duration::from_secs(12) {
                let _ = child.kill();
                panic!(
                    "Catalog did not render in real PTY: {}",
                    luuna_tui::protocol::safe_text(&text)
                );
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        writer.write_all(b"\x1b[B\x1b[A").unwrap();
        writer.flush().unwrap();
        pair.master
            .resize(PtySize {
                rows: 12,
                cols: 40,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        if quit.is_empty() {
            std::fs::write(&marker, "").unwrap();
        } else {
            writer.write_all(quit).unwrap();
            writer.flush().unwrap();
        }
        let start = Instant::now();
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            if start.elapsed() > Duration::from_secs(8) {
                child.kill().unwrap();
                panic!("TUI did not exit after quit");
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        drop(writer);
        drop(pair.master);
        reader_thread.join().unwrap();
        let text = String::from_utf8_lossy(&captured.lock().unwrap()).into_owned();
        assert!(!text.contains("terminal-fixture-private-token"));
        assert!(text.contains("\x1b[?1049h"), "alternate screen entered");
        assert!(text.contains("\x1b[?1049l"), "alternate screen left");
        assert!(text.contains("\x1b[?25h"), "cursor restored");
        assert_eq!(
            stopped.exists(),
            token_present,
            "the owned bridge completes shutdown; hidden-token cancellation never starts it"
        );
    }
}
