import importlib.util
import http.server
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("dual_launch", Path(__file__).with_name("launch.py"))
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)


class IsolationTests(unittest.TestCase):
    def test_parent_secrets_do_not_reach_api_or_frontend(self):
        parent = {"PATH": "/sample/bin", "AGENT_COOKIE_KEY": "parent-secret", "AGENT_COOKIE_KEY_B": "sibling-secret",
                  "ANTHROPIC_API_KEY": "parent-model-secret", "PYTHONPATH": "/other/clone"}
        with patch.dict(os.environ, parent, clear=True):
            a = launch.child_environment({"AGENT_COOKIE_KEY": "a-secret"})
            b = launch.child_environment({"AGENT_COOKIE_KEY": "b-secret"})
            web = launch.child_environment({"AGENT_COOKIE_KEY": "ignored"}, frontend=True, api_port=8001)
        self.assertEqual(a["AGENT_COOKIE_KEY"], "a-secret")
        self.assertEqual(b["AGENT_COOKIE_KEY"], "b-secret")
        self.assertNotIn("b-secret", a.values())
        self.assertNotIn("a-secret", b.values())
        for env in (a, b, web):
            self.assertNotIn("AGENT_COOKIE_KEY_B", env)
            self.assertNotIn("ANTHROPIC_API_KEY", env)
            self.assertNotIn("PYTHONPATH", env)
        self.assertNotIn("AGENT_COOKIE_KEY", web)
        self.assertEqual(web["NEXT_PUBLIC_API_URL"], "http://127.0.0.1:8001")

    def test_same_or_nested_clone_is_rejected(self):
        a = Path("/tmp/sample-a")
        for b in (a, a / "nested"):
            with self.assertRaisesRegex(ValueError, "distinct"):
                launch.validate_layout([a, b], [8000, 3000, 8001, 3001], [None, None])

    def test_duplicate_ports_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "four ports"):
            launch.validate_layout([Path("/tmp/a"), Path("/tmp/b")], [8000, 3000, 8000, 3001], [None, None])

    def test_shared_environment_file_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "separate environment"):
            launch.validate_layout([Path("/tmp/a"), Path("/tmp/b")], [8000, 3000, 8001, 3001], [Path("/tmp/same.env")]*2)

    def test_symlinked_data_and_implicit_env_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            a, b = [Path(root).resolve() / name for name in "ab"]
            for clone in (a, b):
                (clone / "examples/retail").mkdir(parents=True)
            (a / "examples/retail/data").mkdir()
            (b / "examples/retail/data").symlink_to(a / "examples/retail/data", target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "Shared or external"):
                launch.validate_layout([a, b], [8000, 3000, 8001, 3001], [None, None])
            (b / "examples/retail/data").unlink()
            (b / ".env").write_text("AGENT_COOKIE_KEY=sample\n")
            with self.assertRaisesRegex(ValueError, "Implicit dotenv"):
                launch.validate_layout([a, b], [8000, 3000, 8001, 3001], [None, None])

    def test_occupied_port_is_rejected_and_not_reused(self):
        with socket.socket() as holder:
            holder.bind(("127.0.0.1", 0))
            holder.listen()
            port = holder.getsockname()[1]
            with self.assertRaisesRegex(ValueError, "occupied"):
                launch.check_ports([port])

    def test_workspace_keys_must_be_distinct_and_complete(self):
        for values in ([{"AGENT_COOKIE_KEY": "same"}]*2, [{"AGENT_COOKIE_KEY": "a"}, {}]):
            with self.assertRaisesRegex(ValueError, "distinct workspace keys"):
                launch.validate_keys(values)
        self.assertEqual(launch.validate_keys([{}, {}]), [None, None])
        self.assertEqual(launch.validate_keys([{"AGENT_COOKIE_KEY": "a"}, {"AGENT_COOKIE_KEY": "b"}]), ["a", "b"])

    def test_unknown_environment_names_cannot_change_process_config(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "sample.env"
            path.write_text("PYTHONPATH=/wrong/clone\n")
            with self.assertRaisesRegex(ValueError, "environment name"):
                launch.credentials(path)
            path.write_text("AGENT_COOKIE_KEY='sample key'\nANTHROPIC_API_KEY=sample-model\n")
            self.assertEqual(launch.credentials(path)["AGENT_COOKIE_KEY"], "sample key")

    def test_readiness_500_fails_instead_of_repeating_failed_compilation(self):
        calls = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append(self.path)
                self.send_response(500)
                self.end_headers()

            def log_message(self, *_):
                pass

        class Running:
            def poll(self):
                return None

        with http.server.HTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with self.assertRaisesRegex(RuntimeError, "HTTP 500"):
                    launch.await_ready(f"http://127.0.0.1:{server.server_port}/", Running(), timeout=2)
            finally:
                server.shutdown()
                thread.join()
        self.assertEqual(calls, ["/"])


if __name__ == "__main__":
    unittest.main()
