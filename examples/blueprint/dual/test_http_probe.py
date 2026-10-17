from contextlib import contextmanager
import http.server
import os
import threading
import unittest
from unittest.mock import patch

import launch
import smoke


class Running:
    def poll(self):
        return None


@contextmanager
def server(status=200, redirect=None):
    requests = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def answer(self):
            requests.append({"path": self.path, "token": self.headers.get("X-Session-Id")})
            self.send_response(status)
            if redirect:
                self.send_header("Location", redirect)
            self.end_headers()
            self.wfile.write(b"{}")

        do_GET = answer
        do_POST = answer

        def log_message(self, *_):
            pass

    with http.server.HTTPServer(("127.0.0.1", 0), Handler) as instance:
        thread = threading.Thread(target=instance.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{instance.server_port}", requests
        finally:
            instance.shutdown()
            thread.join()


class DirectProbeTests(unittest.TestCase):
    def test_redirect_tokens_never_reach_third_origin(self):
        with server() as (third, third_requests):
            with server(302, third + "/capture") as (a, a_requests), server(302, third + "/capture") as (b, b_requests):
                for origin, token, body in ((a, "sample-a-token", None), (b, "sample-b-token", {"message": "sample"})):
                    with self.assertRaisesRegex(RuntimeError, "redirects are refused.*302"):
                        smoke.call(origin + "/api/memory", body=body, token=token)
                self.assertEqual(a_requests, [{"path": "/api/memory", "token": "sample-a-token"}])
                self.assertEqual(b_requests, [{"path": "/api/memory", "token": "sample-b-token"}])
                self.assertEqual(third_requests, [])

    def test_readiness_refuses_redirect_instead_of_accepting_other_server(self):
        with server() as (other, other_requests):
            with server(302, other + "/healthy") as (origin, origin_requests):
                with self.assertRaisesRegex(RuntimeError, "HTTP 302"):
                    launch.await_ready(origin + "/api/health", Running(), timeout=2)
                self.assertEqual(len(origin_requests), 1)
                self.assertEqual(other_requests, [])

    def test_ambient_proxy_receives_neither_requests_nor_tokens(self):
        with server() as (origin, direct_requests), server() as (proxy, proxy_requests):
            environment = {"http_proxy": proxy, "HTTP_PROXY": proxy, "https_proxy": proxy,
                           "HTTPS_PROXY": proxy, "all_proxy": proxy, "ALL_PROXY": proxy,
                           "no_proxy": "", "NO_PROXY": ""}
            with patch.dict(os.environ, environment, clear=True), patch("urllib.request.proxy_bypass", return_value=False):
                status, _ = smoke.call(origin + "/api/memory", token="sample-direct-token")
                launch.await_ready(origin + "/api/health", Running(), timeout=2)
            self.assertEqual(status, 200)
            self.assertEqual(direct_requests, [{"path": "/api/memory", "token": "sample-direct-token"},
                                              {"path": "/api/health", "token": None}])
            self.assertEqual(proxy_requests, [])


if __name__ == "__main__":
    unittest.main()
